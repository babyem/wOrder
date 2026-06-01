// api/monthly-report-send.js — Vercel serverless function
//
// Hämtar föregående månads (eller ?month=YYYY-MM) omsättning via /api/monthly-report
// och skickar rapport-mejl per köpcentrum via Resend (samma tjänst som send-email).
//
// Skyddad med REPORT_API_TOKEN (?token=… eller Authorization: Bearer).
// Kräver RESEND_API_KEY i miljövariabler (kopiera från Supabase → Edge Functions → Secrets).
//
//   GET /api/monthly-report-send?token=XXX&dry=1            → visar vad som SKULLE skickas
//   GET /api/monthly-report-send?token=XXX                  → skickar på riktigt (föregående månad)
//   GET /api/monthly-report-send?token=XXX&month=2026-05    → specifik månad

const MONTHS_SV = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

// E-postdestinationer per köpcentrum. shops = shopId som ska ingå.
// separate=true → ett mejl per butik; annars ett mejl med alla butikerna.
const EMAIL_DESTINATIONS = [
  {
    center: "Triangeln",
    to: "cv@woso.se",
    from: "rapport@woso.se",
    separate: true,
    shops: [
      "61cc937c0746cf344f514c64", // LETS GRAB
      "6862a617a667dd4ac3c5885d", // Woso Triangeln
    ],
  },
];

function kr(n) {
  return Math.round(n).toLocaleString("sv-SE");
}

function buildBody(monthLabel, rows) {
  const lines = [`Hej,`, ``, `Omsättning för ${monthLabel}:`, ``];
  for (const r of rows) {
    lines.push(r.shopName);
    lines.push(`${kr(r.salesNet)} (exkl moms)`);
    lines.push(`${kr(r.salesGross)} (inkl moms)`);
    lines.push(``);
  }
  lines.push(`Vänliga hälsningar`);
  return lines.join("\n");
}

async function sendViaResend({ apiKey, from, to, subject, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `Resend ${res.status}`);
  return data.id;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // ---- Auth ----
  const expected = process.env.REPORT_API_TOKEN;
  if (!expected) return res.status(500).json({ error: "REPORT_API_TOKEN saknas i miljövariabler" });
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = req.query.token || bearer;
  if (provided !== expected) return res.status(401).json({ error: "Ogiltig eller saknad token" });

  const dry = req.query.dry === "1" || req.query.dry === "true";
  const apiKey = process.env.RESEND_API_KEY;
  if (!dry && !apiKey) return res.status(500).json({ error: "RESEND_API_KEY saknas i miljövariabler" });

  // ---- Hämta månadens siffror från vår egen endpoint ----
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers.host;
  const monthParam = req.query.month ? `&month=${encodeURIComponent(req.query.month)}` : "";
  const url = `${proto}://${host}/api/monthly-report?token=${encodeURIComponent(expected)}${monthParam}`;

  let report;
  try {
    const r = await fetch(url);
    report = await r.json();
    if (!r.ok) throw new Error(report?.error || `monthly-report ${r.status}`);
  } catch (err) {
    return res.status(502).json({ error: `Kunde inte hämta omsättning: ${err.message}` });
  }

  const [yy, mm] = report.month.split("-").map(Number);
  const monthLabel = `${MONTHS_SV[mm - 1]} ${yy}`;
  const byId = new Map(report.shops.map((s) => [s.shopId, s]));

  const planned = []; // { center, to, from, subject, text, shops:[names] }
  for (const dest of EMAIL_DESTINATIONS) {
    const rows = dest.shops.map((id) => byId.get(id)).filter(Boolean);
    if (rows.length === 0) continue;

    if (dest.separate) {
      for (const row of rows) {
        planned.push({
          center: dest.center,
          to: dest.to,
          from: dest.from,
          subject: `Omsättning ${monthLabel} – ${row.shopName}`,
          text: buildBody(monthLabel, [row]),
          shops: [row.shopName],
        });
      }
    } else {
      planned.push({
        center: dest.center,
        to: dest.to,
        from: dest.from,
        subject: `Omsättning ${monthLabel} – ${dest.center}`,
        text: buildBody(monthLabel, rows),
        shops: rows.map((r) => r.shopName),
      });
    }
  }

  if (dry) {
    return res.status(200).json({
      dryRun: true,
      month: report.month,
      monthLabel,
      emails: planned,
    });
  }

  // ---- Skicka på riktigt ----
  const results = [];
  for (const p of planned) {
    try {
      const id = await sendViaResend({ apiKey, from: p.from, to: p.to, subject: p.subject, text: p.text });
      results.push({ to: p.to, subject: p.subject, status: "sent", id });
    } catch (err) {
      results.push({ to: p.to, subject: p.subject, status: "error", error: err.message });
    }
  }

  const allOk = results.every((r) => r.status === "sent");
  return res.status(allOk ? 200 : 207).json({
    month: report.month,
    monthLabel,
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "error").length,
    results,
  });
}
