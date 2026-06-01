// api/monthly-report.js — Vercel serverless function
//
// Föregående månads (eller ?month=YYYY-MM) omsättning per butik, sammanslaget från
// Qopla-overview + Supabase-tabellen pos_daily_sales (samma logik som admin-rapporten).
//
// Skyddad med REPORT_API_TOKEN (?token=… eller Authorization: Bearer <token>).
//
// Lägen:
//   GET /api/monthly-report?token=XXX                    → JSON, föregående månad
//   GET /api/monthly-report?token=XXX&month=2026-05      → JSON, specifik månad
//   GET /api/monthly-report?token=XXX&action=send&dry=1  → visa vilka mejl som SKULLE skickas
//   GET /api/monthly-report?token=XXX&action=send        → skicka rapport-mejl via Resend
//
// För action=send krävs RESEND_API_KEY i miljövariabler (samma nyckel som send-email).

import { getSession, fetchOverviewRaw, dayRangeISO } from "./_lib/qopla.js";
import { sbSelect } from "./_lib/supabaseAdmin.js";

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
    // Visningsnamn i mejlet (override av Qopla:s namn)
    names: {
      "61cc937c0746cf344f514c64": "Lets Grab",
    },
  },
];

// ---------- Datum ----------
function stockholmYearMonth() {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [year, month] = s.split("-").map(Number);
  return { year, month };
}

function monthBounds(year, month) {
  const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { firstDay, lastDay };
}

function previousMonth() {
  const { year, month } = stockholmYearMonth();
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// ---------- Datakällor ----------
async function qoplaShopSales({ startISO, endISO }) {
  const { companyId, token, shops } = await getSession();
  return Promise.all(
    shops.map(async (shop) => {
      try {
        const data = await fetchOverviewRaw({
          companyId, token, shopId: shop.id, startDate: startISO, endDate: endISO,
        });
        const report = data.aggregatedReport || {};
        let gross = 0, orders = 0, net = 0;
        for (const ch of Object.values(report)) {
          gross += ch.totalSum || 0;
          orders += ch.quantityOfOrders || 0;
          const stats = ch && ch.saleStatsPerHour;
          if (stats && typeof stats === "object") {
            for (const v of Object.values(stats)) net += v.totalNet || 0;
          }
        }
        return { shopId: shop.id, shopName: shop.name, salesGross: gross, salesNet: net, orders, source: "qopla" };
      } catch {
        return { shopId: shop.id, shopName: shop.name, salesGross: 0, salesNet: 0, orders: 0, source: "qopla" };
      }
    })
  );
}

// Synk-butiker (ancon/dinkassa) ligger i pos_daily_sales, inte i Qopla-overview.
async function posShopSales({ firstDay, lastDay }) {
  const query =
    `select=qopla_shop_id,shop_name,source,sales,orders,business_date` +
    `&business_date=gte.${firstDay}&business_date=lte.${lastDay}`;
  let data;
  try {
    data = await sbSelect("pos_daily_sales", query);
  } catch {
    return [];
  }
  const map = new Map();
  for (const r of data || []) {
    let e = map.get(r.qopla_shop_id);
    if (!e) {
      e = {
        shopId: r.qopla_shop_id,
        shopName: r.shop_name || r.qopla_shop_id,
        salesGross: 0,
        salesNet: null, // netto lagras inte i pos_daily_sales
        orders: 0,
        source: r.source || "pos",
      };
      map.set(r.qopla_shop_id, e);
    }
    e.salesGross += Number(r.sales) || 0;
    e.orders += Number(r.orders) || 0;
  }
  return [...map.values()];
}

async function computeReport(year, month) {
  const { firstDay, lastDay } = monthBounds(year, month);
  const startISO = dayRangeISO(firstDay).startDate;
  const endISO = dayRangeISO(lastDay).endDate;

  const [qopla, pos] = await Promise.all([
    qoplaShopSales({ startISO, endISO }),
    posShopSales({ firstDay, lastDay }),
  ]);

  const byId = new Map();
  for (const s of qopla) byId.set(s.shopId, s);
  for (const s of pos) if (!byId.has(s.shopId)) byId.set(s.shopId, s);

  const shops = [...byId.values()]
    .filter((s) => (s.salesGross || 0) > 0 || (s.orders || 0) > 0)
    .sort((a, b) => (b.salesGross || 0) - (a.salesGross || 0))
    .map((s) => ({
      shopId: s.shopId,
      shopName: s.shopName,
      salesGross: Math.round(s.salesGross || 0), // inkl moms
      salesNet: s.salesNet == null ? null : Math.round(s.salesNet), // exkl moms (null för pos)
      orders: s.orders,
      source: s.source,
    }));

  const total = shops.reduce(
    (acc, s) => ({
      salesGross: acc.salesGross + (s.salesGross || 0),
      salesNet: acc.salesNet + (s.salesNet || 0),
      orders: acc.orders + (s.orders || 0),
    }),
    { salesGross: 0, salesNet: 0, orders: 0 }
  );

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    period: { start: firstDay, end: lastDay, startISO, endISO },
    shops,
    total,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- E-post ----------
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

function planEmails(report) {
  const [yy, mm] = report.month.split("-").map(Number);
  const monthLabel = `${MONTHS_SV[mm - 1]} ${yy}`;
  const byId = new Map(report.shops.map((s) => [s.shopId, s]));
  const planned = [];
  for (const dest of EMAIL_DESTINATIONS) {
    const rows = dest.shops
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((s) => ({ ...s, shopName: (dest.names && dest.names[s.shopId]) || s.shopName }));
    if (rows.length === 0) continue;
    if (dest.separate) {
      for (const row of rows) {
        planned.push({
          center: dest.center, to: dest.to, from: dest.from,
          subject: `Omsättning ${monthLabel} – ${row.shopName}`,
          text: buildBody(monthLabel, [row]),
          shops: [row.shopName],
        });
      }
    } else {
      planned.push({
        center: dest.center, to: dest.to, from: dest.from,
        subject: `Omsättning ${monthLabel} – ${dest.center}`,
        text: buildBody(monthLabel, rows),
        shops: rows.map((r) => r.shopName),
      });
    }
  }
  return { monthLabel, planned };
}

async function sendViaResend({ apiKey, from, to, subject, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || JSON.stringify(data?.error || data) || `Resend ${res.status}`);
  return data.id;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // Auth
  const expected = process.env.REPORT_API_TOKEN;
  if (!expected) return res.status(500).json({ error: "REPORT_API_TOKEN saknas i miljövariabler" });
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = req.query.token || bearer;
  if (provided !== expected) return res.status(401).json({ error: "Ogiltig eller saknad token" });

  // Månad
  let year, month;
  if (req.query.month) {
    const m = /^(\d{4})-(\d{2})$/.exec(req.query.month);
    if (!m) return res.status(400).json({ error: "month måste vara YYYY-MM" });
    year = Number(m[1]);
    month = Number(m[2]);
    if (month < 1 || month > 12) return res.status(400).json({ error: "month måste vara YYYY-MM (01–12)" });
  } else {
    ({ year, month } = previousMonth());
  }

  try {
    const report = await computeReport(year, month);

    // ----- action=send: skicka (eller dry-run) rapport-mejl -----
    if (req.query.action === "send") {
      const dry = req.query.dry === "1" || req.query.dry === "true";
      const apiKey = process.env.RESEND_API_KEY;
      const { monthLabel, planned } = planEmails(report);

      if (dry) {
        return res.status(200).json({ dryRun: true, month: report.month, monthLabel, emails: planned });
      }
      if (!apiKey) return res.status(500).json({ error: "RESEND_API_KEY saknas i miljövariabler" });

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
        month: report.month, monthLabel,
        sent: results.filter((r) => r.status === "sent").length,
        failed: results.filter((r) => r.status === "error").length,
        results,
      });
    }

    // ----- default: returnera JSON -----
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
