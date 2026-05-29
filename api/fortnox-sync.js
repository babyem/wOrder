// api/fortnox-sync.js — nightly Qopla → Fortnox auto-booking (Vercel serverless).
//
// Triggered by Vercel Cron (two UTC entries; see vercel.json) and gated to run only
// at 23:00 Europe/Stockholm, so exactly one fires per day year-round despite DST.
// Also callable manually from the admin UI ("Kör nu") with ?force=1 and the user JWT.
//
// For every enabled fortnox_shop_map row it fetches today's SIE verifications from
// Qopla, turns them into Fortnox vouchers (series "F") and posts them, recording the
// result in fortnox_postings (which also guards against double-posting).
//
// Env: FORTNOX_CLIENT_ID, FORTNOX_CLIENT_SECRET, CRON_SECRET, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, QOPLA_EMAIL, QOPLA_PASSWORD.

import { getSession, getDateRange, fetchSiePayload, stockholmHourNow } from "./_lib/qopla.js";
import { sbSelect, sbInsert, sbUpdate, getUserFromJwt } from "./_lib/supabaseAdmin.js";
import { buildVouchersFromSie, getCompanyAccessToken, createVoucher, getVoucher } from "./_lib/fortnox.js";
import { fetchZReports, zReportsToSiePayload } from "./_lib/dinkassa.js";

// Split a stored voucher token like "F327" into { series: "F", number: "327" }.
function parseVoucher(token) {
  const m = /^([A-Za-zÅÄÖåäö]+)\s*(\d+)$/.exec(String(token).trim());
  return m ? { series: m[1], number: m[2] } : null;
}

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

// YYYY-MM-DD for "today" (or N days ago) in Europe/Stockholm.
function stockholmDateStr(daysAgo = 0) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  if (!daysAgo) return today;
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d - daysAgo));
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(base);
}

async function authorize(req) {
  const bearer = getBearer(req);
  if (!bearer) return false;
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return true;
  const user = await getUserFromJwt(bearer);
  return !!user;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  if (!(await authorize(req))) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Reconcile: re-check posted vouchers against Fortnox; flag ones deleted there.
  if (req.query.action === "reconcile") {
    return await reconcile(res);
  }

  const force = req.query.force === "1" || req.query.force === "true";
  const daysAgo = req.query.day === "yesterday" ? 1 : 0;

  // Time gate: only run at 23:00 Stockholm unless manually forced.
  if (!force && stockholmHourNow() !== 23) {
    return res.status(200).json({ skipped: true, reason: "not 23:00 Europe/Stockholm" });
  }

  try {
    const businessDate = stockholmDateStr(daysAgo);
    const { startDate, endDate } = getDateRange(daysAgo);

    // Load config + secrets (service role; tokens table is anon-denied).
    const [maps, companies, tokens, postedRows] = await Promise.all([
      sbSelect("fortnox_shop_map", "select=*&enabled=eq.true"),
      sbSelect("fortnox_companies", "select=id,name"),
      sbSelect("fortnox_tokens", "select=*"),
      sbSelect("fortnox_postings", `select=qopla_shop_id,status&business_date=eq.${businessDate}`),
    ]);

    const companyName = new Map((companies || []).map(c => [c.id, c.name]));
    const tokenByCompany = new Map((tokens || []).map(t => [t.company_id, t]));
    const alreadyOk = new Set((postedRows || []).filter(p => p.status === "ok").map(p => p.qopla_shop_id));

    const targets = (maps || []).filter(m => m.company_id);
    if (!targets.length) {
      return res.status(200).json({ ranAt: new Date().toISOString(), businessDate, results: [], note: "Inga aktiva butik→bolag-mappningar" });
    }

    // Qopla session is created lazily — only if a Qopla-sourced shop is mapped.
    let qoplaToken = null;
    const getQoplaToken = async () => {
      if (!qoplaToken) qoplaToken = (await getSession()).token;
      return qoplaToken;
    };

    const results = [];
    for (const m of targets) {
      const shopId = m.qopla_shop_id;
      const shopName = m.qopla_shop_name || shopId;
      const base = { shop: shopName, shopId };

      if (alreadyOk.has(shopId)) {
        results.push({ ...base, status: "skipped", message: "redan bokfört idag" });
        continue;
      }

      const tokenRow = tokenByCompany.get(m.company_id);
      if (!tokenRow) {
        const msg = `Ingen Fortnox-token för bolaget "${companyName.get(m.company_id) || m.company_id}"`;
        await record(shopId, businessDate, m.company_id, null, "error", msg);
        results.push({ ...base, status: "error", message: msg });
        continue;
      }

      try {
        let payload;
        if (m.source === "dinkassa") {
          const z = await fetchZReports({ machineId: shopId, startDate: businessDate, endDate: businessDate });
          payload = zReportsToSiePayload(z);
        } else {
          payload = await fetchSiePayload({ token: await getQoplaToken(), shopId, startDate, endDate });
        }
        const { vouchers, warnings, referenceReportId } = buildVouchersFromSie(payload, {
          shopName,
          costCenterOverride: m.cost_center || null,
        });

        if (!vouchers.length) {
          const msg = warnings.length ? warnings.join("; ") : "Inga verifikationer att bokföra";
          await record(shopId, businessDate, m.company_id, referenceReportId, "skipped", msg);
          results.push({ ...base, status: "skipped", message: msg });
          continue;
        }

        const accessToken = await getCompanyAccessToken(tokenRow);
        const voucherNumbers = [];
        for (const v of vouchers) {
          const created = await createVoucher(accessToken, v);
          voucherNumbers.push(`${created.VoucherSeries}${created.VoucherNumber}`);
        }

        const msg = warnings.length ? `OK (varningar: ${warnings.join("; ")})` : "OK";
        await record(shopId, businessDate, m.company_id, referenceReportId, "ok", msg, voucherNumbers);
        results.push({ ...base, status: "ok", voucherNumbers, warnings });
      } catch (err) {
        await record(shopId, businessDate, m.company_id, null, "error", err.message);
        results.push({ ...base, status: "error", message: err.message });
      }
    }

    return res.status(200).json({ ranAt: new Date().toISOString(), businessDate, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Upsert one posting row (idempotency key: qopla_shop_id + business_date).
async function record(shopId, businessDate, companyId, referenceReportId, status, message, voucherNumbers) {
  try {
    await sbInsert("fortnox_postings", {
      qopla_shop_id: shopId,
      business_date: businessDate,
      reference_report_id: referenceReportId || null,
      company_id: companyId || null,
      voucher_series: "F",
      voucher_number: voucherNumbers && voucherNumbers.length ? voucherNumbers.join(", ") : null,
      status,
      message: message ? String(message).slice(0, 500) : null,
      created_at: new Date().toISOString(),
    }, { onConflict: "qopla_shop_id,business_date" });
  } catch {
    // Logging must never break the run.
  }
}

// Re-check the most recent successfully-posted vouchers against Fortnox. Any voucher
// that no longer exists there (deleted in the Fortnox UI) is marked 'deleted' so the
// admin list reflects reality. Capped to the latest 100 to stay under rate limits.
async function reconcile(res) {
  const rows = await sbSelect(
    "fortnox_postings",
    "select=*&status=eq.ok&voucher_number=not.is.null&order=created_at.desc&limit=100",
  );
  const tokens = await sbSelect("fortnox_tokens", "select=*");
  const tokenByCompany = new Map((tokens || []).map(t => [t.company_id, t]));

  const changed = [];
  for (const p of rows || []) {
    const tokenRow = tokenByCompany.get(p.company_id);
    if (!tokenRow) continue;
    try {
      const accessToken = await getCompanyAccessToken(tokenRow);
      const missing = [];
      for (const tok of String(p.voucher_number).split(",").map(s => s.trim()).filter(Boolean)) {
        const pv = parseVoucher(tok);
        if (!pv) continue;
        const r = await getVoucher(accessToken, pv.series, pv.number, p.business_date);
        if (!r.found) missing.push(tok);
      }
      if (missing.length) {
        await sbUpdate("fortnox_postings", `id=eq.${p.id}`, {
          status: "deleted",
          message: `Borttagen i Fortnox: ${missing.join(", ")}`,
        });
        changed.push({ shop: p.qopla_shop_id, voucher: p.voucher_number, businessDate: p.business_date });
      }
    } catch {
      // Transient error (auth/network/rate limit) — leave the row unchanged.
    }
  }
  return res.status(200).json({ reconciledAt: new Date().toISOString(), changed });
}
