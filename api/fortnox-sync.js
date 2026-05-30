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

import { getSession, dayRangeISO, fetchSiePayload, stockholmHourNow } from "./_lib/qopla.js";
import { sbSelect, sbInsert, sbUpdate, getUserFromJwt } from "./_lib/supabaseAdmin.js";
import { buildVouchersFromSie, getCompanyAccessToken, createVoucher, getVoucher } from "./_lib/fortnox.js";

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

function addDay(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.UTC(y, m - 1, d + 1)));
}

// Inclusive list of YYYY-MM-DD from `from` to `to` (capped at 366 days).
function dateList(from, to) {
  const out = [];
  let cur = from;
  while (cur <= to && out.length < 366) { out.push(cur); cur = addDay(cur); }
  return out;
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

  // Date selection: ?from=&to= (range, manual) takes precedence; else ?day=yesterday/today.
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = req.query.from && ymd.test(req.query.from) ? req.query.from : null;
  const to = req.query.to && ymd.test(req.query.to) ? req.query.to : from;
  let dates;
  if (from) {
    dates = to >= from ? dateList(from, to) : [from];
  } else {
    // No explicit dates: the nightly cron books today, gated to 23:00 Stockholm.
    if (!force && stockholmHourNow() !== 23) {
      return res.status(200).json({ skipped: true, reason: "not 23:00 Europe/Stockholm" });
    }
    dates = [stockholmDateStr(req.query.day === "yesterday" ? 1 : 0)];
  }

  try {
    // Load config + secrets (service role; tokens table is anon-denied).
    const [maps, companies, tokens, postedRows] = await Promise.all([
      sbSelect("fortnox_shop_map", "select=*&enabled=eq.true"),
      sbSelect("fortnox_companies", "select=id,name"),
      sbSelect("fortnox_tokens", "select=*"),
      sbSelect("fortnox_postings", `select=qopla_shop_id,business_date,status&business_date=gte.${dates[0]}&business_date=lte.${dates[dates.length - 1]}`),
    ]);

    const companyName = new Map((companies || []).map(c => [c.id, c.name]));
    const tokenByCompany = new Map((tokens || []).map(t => [t.company_id, t]));
    const okSet = new Set((postedRows || []).filter(p => p.status === "ok").map(p => `${p.qopla_shop_id}|${p.business_date}`));

    // Optional shop filter (?shops=id1,id2) — run only selected restaurants.
    const shopFilter = req.query.shops
      ? new Set(String(req.query.shops).split(",").map(s => s.trim()).filter(Boolean))
      : null;

    // Qopla shops only — dinkassa rows are booked by the GitHub Action (login is browser-bound).
    const targets = (maps || []).filter(m =>
      m.company_id && m.source !== "dinkassa" && (!shopFilter || shopFilter.has(m.qopla_shop_id)));
    if (!targets.length) {
      return res.status(200).json({ ranAt: new Date().toISOString(), dates, results: [], note: "Inga matchande Qopla-mappningar" });
    }

    // Qopla session is created lazily.
    let qoplaToken = null;
    const getQoplaToken = async () => {
      if (!qoplaToken) qoplaToken = (await getSession()).token;
      return qoplaToken;
    };

    const dateSet = new Set(dates);
    const rangeStart = dayRangeISO(dates[0]).startDate;
    const rangeEnd = dayRangeISO(dates[dates.length - 1]).endDate;

    const results = [];
    for (const m of targets) {
      const shopId = m.qopla_shop_id;
      const shopName = m.qopla_shop_name || shopId;
      const tokenRow = tokenByCompany.get(m.company_id);
      if (!tokenRow) {
        results.push({ shop: shopName, shopId, status: "error", message: `Ingen Fortnox-token för bolaget "${companyName.get(m.company_id) || m.company_id}"` });
        continue;
      }

      // ONE Qopla call for the whole range; Qopla returns one verification per day.
      let byDate;
      try {
        const payload = await fetchSiePayload({ token: await getQoplaToken(), shopId, startDate: rangeStart, endDate: rangeEnd });
        const { vouchers } = buildVouchersFromSie(payload, { shopName, costCenterOverride: m.cost_center || null });
        byDate = new Map();
        for (const v of vouchers) {
          if (!dateSet.has(v.TransactionDate)) continue;
          const arr = byDate.get(v.TransactionDate) || [];
          arr.push(v);
          byDate.set(v.TransactionDate, arr);
        }
      } catch (err) {
        results.push({ shop: shopName, shopId, status: "error", message: err.message });
        continue;
      }

      // Book per day from the cached result.
      let accessToken = null;
      for (const date of dates) {
        const base = { shop: shopName, shopId, date };
        if (okSet.has(`${shopId}|${date}`)) { results.push({ ...base, status: "skipped", message: "redan bokfört" }); continue; }
        const dayVouchers = byDate.get(date) || [];
        if (!dayVouchers.length) {
          await record(shopId, date, m.company_id, null, "skipped", "Inga verifikationer");
          results.push({ ...base, status: "skipped", message: "Inga verifikationer" });
          continue;
        }
        try {
          if (!accessToken) accessToken = await getCompanyAccessToken(tokenRow);
          const voucherNumbers = [];
          for (const v of dayVouchers) {
            const created = await createVoucher(accessToken, v);
            voucherNumbers.push(`${created.VoucherSeries}${created.VoucherNumber}`);
          }
          await record(shopId, date, m.company_id, null, "ok", "OK", voucherNumbers);
          okSet.add(`${shopId}|${date}`);
          results.push({ ...base, status: "ok", voucherNumbers });
        } catch (err) {
          await record(shopId, date, m.company_id, null, "error", err.message);
          results.push({ ...base, status: "error", message: err.message });
        }
      }
    }

    return res.status(200).json({ ranAt: new Date().toISOString(), dates, results });
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
