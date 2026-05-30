// api/dinkassa-book.js — receives dinkassa Z-reports (scraped by the GitHub Action,
// which can run a real browser) and books them to Fortnox. Auth: CRON_SECRET bearer.
//
// Body: { businessDate: "YYYY-MM-DD", machines: [{ id, name, zReports: [...] }] }
//
// Per machine: ensures a fortnox_shop_map row exists (so it shows in the mapping UI),
// then — if mapped to a company and enabled and not already booked today — turns the
// Z-reports into Fortnox vouchers (series F) via the shared helpers.

import { sbSelect, sbInsert, sbUpdate } from "./_lib/supabaseAdmin.js";
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

  const { businessDate, machines } = req.body || {};
  if (!businessDate || !Array.isArray(machines)) {
    return res.status(400).json({ error: "businessDate + machines[] krävs" });
  }

  try {
    const maps = await sbSelect("fortnox_shop_map", "select=*&source=eq.dinkassa");
    const mapById = new Map((maps || []).map(m => [m.qopla_shop_id, m]));
    const posted = await sbSelect("fortnox_postings", `select=qopla_shop_id,status&business_date=eq.${businessDate}`);
    const alreadyOk = new Set((posted || []).filter(p => p.status === "ok").map(p => p.qopla_shop_id));
    const tokenCache = new Map();

    const results = [];
    for (const machine of machines) {
      const shopId = machine.id;
      const base = { shop: machine.name || shopId, shopId };

      // Ensure the kassa shows up in the mapping UI (insert once; never overwrite config).
      let m = mapById.get(shopId);
      if (!m) {
        try {
          const rows = await sbInsert("fortnox_shop_map", {
            qopla_shop_id: shopId, qopla_shop_name: machine.name || shopId, source: "dinkassa", enabled: true, company_id: null,
          });
          m = (rows && rows[0]) || { company_id: null, enabled: true };
          mapById.set(shopId, m);
        } catch { m = { company_id: null, enabled: true }; }
      }

      if (!m.company_id) { results.push({ ...base, status: "unmapped", message: "Koppla kassan till ett bolag i /admin/fortnox" }); continue; }
      if (m.enabled === false) { results.push({ ...base, status: "skipped", message: "pausad" }); continue; }
      if (alreadyOk.has(shopId)) { results.push({ ...base, status: "skipped", message: "redan bokfört" }); continue; }

      try {
        const payload = zReportsToSiePayload(machine.zReports || []);
        const { vouchers, warnings } = buildVouchersFromSie(payload, {
          shopName: machine.name || shopId,
          costCenterOverride: m.cost_center || null,
        });
        if (!vouchers.length) {
          const msg = warnings.length ? warnings.join("; ") : "Inga verifikationer";
          await record(shopId, businessDate, m.company_id, null, "skipped", msg);
          results.push({ ...base, status: "skipped", message: msg });
          continue;
        }
        let token = tokenCache.get(m.company_id);
        if (!token) {
          const t = await sbSelect("fortnox_tokens", `select=*&company_id=eq.${m.company_id}`);
          if (!t || !t[0]) { results.push({ ...base, status: "error", message: "Bolaget saknar Fortnox-token" }); continue; }
          token = t[0]; tokenCache.set(m.company_id, token);
        }
        const accessToken = await getCompanyAccessToken(token);
        const voucherNumbers = [];
        for (const v of vouchers) {
          const created = await createVoucher(accessToken, v);
          voucherNumbers.push(`${created.VoucherSeries}${created.VoucherNumber}`);
        }
        await record(shopId, businessDate, m.company_id, voucherNumbers.join(", "), "ok", warnings.length ? warnings.join("; ") : "OK");
        results.push({ ...base, status: "ok", voucherNumbers });
      } catch (e) {
        await record(shopId, businessDate, m.company_id, null, "error", e.message);
        results.push({ ...base, status: "error", message: e.message });
      }
    }
    return res.status(200).json({ businessDate, results, ranAt: new Date().toISOString() });
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
