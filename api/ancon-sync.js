// api/ancon-sync.js — server-side Ancon (Woso Emporia) → Fortnox, like Qopla.
// Logs into ancon, lists Z-reports for a date range, stores daily sales, and books each
// day's SIE as a Fortnox voucher (series F). Idempotent per (shop, day), chronological.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to today). Auth: CRON_SECRET bearer
// (cron) or a logged-in admin JWT (UI "Kör Woso Emporia").

import { sbSelect, sbInsert, getUserFromJwt } from "./_lib/supabaseAdmin.js";
import { getDailyTotals, getSIE } from "./_lib/ancon.js";
import { parseSie4 } from "./_lib/sie.js";
import { buildVouchersFromSie, getCompanyAccessToken, createVoucher } from "./_lib/fortnox.js";

const SHOP_ID = `ancon:${process.env.ANCON_TENANT || "IgE"}`;
const SHOP_NAME = "Woso Emporia";

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}
function stockholmDateStr(daysAgo = 0) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!daysAgo) return today;
  const [y, m, d] = today.split("-").map(Number);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.UTC(y, m - 1, d - daysAgo)));
}
async function authorize(req) {
  const bearer = getBearer(req);
  if (!bearer) return false;
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return true;
  return !!(await getUserFromJwt(bearer));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  if (!(await authorize(req))) return res.status(401).json({ error: "Unauthorized" });

  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = req.query.from && ymd.test(req.query.from) ? req.query.from : stockholmDateStr(req.query.day === "yesterday" ? 1 : 0);
  const to = req.query.to && ymd.test(req.query.to) && req.query.to >= from ? req.query.to : from;

  try {
    const totals = await getDailyTotals({ from, to }); // [{ id, date, sales }]

    // Ensure the säljställe shows up in the mapping UI (insert once, never overwrite).
    let mapRow = (await sbSelect("fortnox_shop_map", `select=*&qopla_shop_id=eq.${encodeURIComponent(SHOP_ID)}`))[0];
    if (!mapRow) {
      try {
        const rows = await sbInsert("fortnox_shop_map", { qopla_shop_id: SHOP_ID, qopla_shop_name: SHOP_NAME, source: "ancon", enabled: true, company_id: null });
        mapRow = (rows && rows[0]) || { company_id: null, enabled: true };
      } catch { mapRow = { company_id: null, enabled: true }; }
    }

    // Store daily sales (for widget/reports), independent of booking.
    for (const t of totals) {
      try {
        await sbInsert("pos_daily_sales", {
          qopla_shop_id: SHOP_ID, business_date: t.date, shop_name: SHOP_NAME, source: "ancon",
          sales: Math.round(Number(t.sales || 0) * 100) / 100, updated_at: new Date().toISOString(),
        }, { onConflict: "qopla_shop_id,business_date" });
      } catch { /* sales storage must not break booking */ }
    }

    const results = [];
    if (!mapRow.company_id) {
      return res.status(200).json({ from, to, salesDays: totals.length, results: [{ shop: SHOP_NAME, status: "unmapped", message: "Koppla Woso Emporia till ett bolag i /admin/fortnox" }] });
    }
    if (mapRow.enabled === false) {
      return res.status(200).json({ from, to, salesDays: totals.length, results: [{ shop: SHOP_NAME, status: "skipped", message: "pausad" }] });
    }

    const tokenRow = (await sbSelect("fortnox_tokens", `select=*&company_id=eq.${mapRow.company_id}`))[0];
    if (!tokenRow) {
      return res.status(200).json({ from, to, results: [{ shop: SHOP_NAME, status: "error", message: "Bolaget saknar Fortnox-token" }] });
    }
    const posted = await sbSelect("fortnox_postings", `select=business_date,status&qopla_shop_id=eq.${encodeURIComponent(SHOP_ID)}&business_date=gte.${from}&business_date=lte.${to}`);
    const okSet = new Set((posted || []).filter(p => p.status === "ok").map(p => p.business_date));

    let accessToken = null;
    for (const day of totals) { // already chronological
      const base = { shop: SHOP_NAME, date: day.date };
      if (okSet.has(day.date)) { results.push({ ...base, status: "skipped", message: "redan bokfört" }); continue; }
      try {
        const sieText = await getSIE(day.id);
        const payload = parseSie4(sieText);
        const { vouchers, skipped } = buildVouchersFromSie(payload, { shopName: SHOP_NAME, costCenterOverride: mapRow.cost_center || null });
        for (const s of skipped || []) { await record(day.date, mapRow.company_id, null, "error", s.reason); results.push({ ...base, status: "error", message: s.reason }); }
        if (!vouchers.length) { if (!(skipped || []).length) { await record(day.date, mapRow.company_id, null, "skipped", "Inga verifikationer"); results.push({ ...base, status: "skipped", message: "Inga verifikationer" }); } continue; }
        if (!accessToken) accessToken = await getCompanyAccessToken(tokenRow);
        const nums = [];
        for (const v of vouchers) { const c = await createVoucher(accessToken, v); nums.push(`${c.VoucherSeries}${c.VoucherNumber}`); }
        await record(day.date, mapRow.company_id, nums.join(", "), "ok", "OK");
        results.push({ ...base, status: "ok", voucherNumbers: nums });
      } catch (e) {
        await record(day.date, mapRow.company_id, null, "error", e.message);
        results.push({ ...base, status: "error", message: e.message });
      }
    }
    return res.status(200).json({ from, to, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function record(businessDate, companyId, voucherNumber, status, message) {
  try {
    await sbInsert("fortnox_postings", {
      qopla_shop_id: SHOP_ID, business_date: businessDate, company_id: companyId,
      voucher_series: "F", voucher_number: voucherNumber, status,
      message: message ? String(message).slice(0, 500) : null, created_at: new Date().toISOString(),
    }, { onConflict: "qopla_shop_id,business_date" });
  } catch { /* logging must not break the run */ }
}
