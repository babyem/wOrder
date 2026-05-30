// api/dinkassa-book.js — receives dinkassa Z-reports (scraped by the GitHub Action,
// which can run a real browser) and books them to Fortnox. Auth: CRON_SECRET bearer.
//
// Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", machines: [{ id, name, zReports: [...] }] }
//   (legacy: { businessDate, machines } — treated as from=to=businessDate)
//
// Each Z-report becomes one Fortnox voucher dated by its own ReportDateTime, so a date
// range books one verification per kassa per day. Idempotent per (kassa, day).

import { sbSelect, sbInsert, getUserFromJwt } from "./_lib/supabaseAdmin.js";
import { zReportsToSiePayload } from "./_lib/dinkassa.js";
import { buildVouchersFromSie, getCompanyAccessToken, createVoucher } from "./_lib/fortnox.js";

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.CRON_SECRET || getBearer(req) !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { from, to, businessDate, machines } = req.body || {};
  const rangeFrom = from || businessDate;
  const rangeTo = to || businessDate || from;
  if (!Array.isArray(machines) || !rangeFrom) {
    return res.status(400).json({ error: "machines[] + from (eller businessDate) krävs" });
  }

  try {
    const maps = await sbSelect("fortnox_shop_map", "select=*&source=eq.dinkassa");
    const mapById = new Map((maps || []).map(m => [m.qopla_shop_id, m]));
    const posted = await sbSelect(
      "fortnox_postings",
      `select=qopla_shop_id,business_date,status&business_date=gte.${rangeFrom}&business_date=lte.${rangeTo}`,
    );
    const okSet = new Set((posted || []).filter(p => p.status === "ok").map(p => `${p.qopla_shop_id}|${p.business_date}`));
    const tokenCache = new Map();

    const results = [];
    for (const machine of machines) {
      const shopId = machine.id;
      const shopName = machine.name || shopId;

      // Ensure the kassa shows up in the mapping UI (insert once; never overwrite config).
      let m = mapById.get(shopId);
      if (!m) {
        try {
          const rows = await sbInsert("fortnox_shop_map", {
            qopla_shop_id: shopId, qopla_shop_name: shopName, source: "dinkassa", enabled: true, company_id: null,
          });
          m = (rows && rows[0]) || { company_id: null, enabled: true };
          mapById.set(shopId, m);
        } catch { m = { company_id: null, enabled: true }; }
      }

      if (!m.company_id) { results.push({ shop: shopName, status: "unmapped", message: "Koppla kassan till ett bolag i /admin/fortnox" }); continue; }
      if (m.enabled === false) { results.push({ shop: shopName, status: "skipped", message: "pausad" }); continue; }

      const payload = zReportsToSiePayload(machine.zReports || []);
      const { vouchers, warnings } = buildVouchersFromSie(payload, { shopName, costCenterOverride: m.cost_center || null });
      if (!vouchers.length) {
        results.push({ shop: shopName, status: "skipped", message: warnings.length ? warnings.join("; ") : "Inga verifikationer" });
        continue;
      }

      let token = tokenCache.get(m.company_id);
      if (!token) {
        const t = await sbSelect("fortnox_tokens", `select=*&company_id=eq.${m.company_id}`);
        if (!t || !t[0]) { results.push({ shop: shopName, status: "error", message: "Bolaget saknar Fortnox-token" }); continue; }
        token = t[0]; tokenCache.set(m.company_id, token);
      }

      // One voucher per day in the range.
      for (const v of vouchers) {
        const date = v.TransactionDate;
        if (okSet.has(`${shopId}|${date}`)) { results.push({ shop: shopName, date, status: "skipped", message: "redan bokfört" }); continue; }
        try {
          const accessToken = await getCompanyAccessToken(token);
          const created = await createVoucher(accessToken, v);
          const num = `${created.VoucherSeries}${created.VoucherNumber}`;
          await record(shopId, date, m.company_id, num, "ok", "OK");
          okSet.add(`${shopId}|${date}`);
          results.push({ shop: shopName, date, status: "ok", voucher: num });
        } catch (e) {
          await record(shopId, date, m.company_id, null, "error", e.message);
          results.push({ shop: shopName, date, status: "error", message: e.message });
        }
      }
    }
    return res.status(200).json({ from: rangeFrom, to: rangeTo, results, ranAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function record(shopId, businessDate, companyId, voucherNumber, status, message) {
  try {
    await sbInsert("fortnox_postings", {
      qopla_shop_id: shopId, business_date: businessDate, company_id: companyId,
      voucher_series: "F", voucher_number: voucherNumber, status,
      message: message ? String(message).slice(0, 500) : null, created_at: new Date().toISOString(),
    }, { onConflict: "qopla_shop_id,business_date" });
  } catch { /* logging must not break the run */ }
}
