// api/dinkassa-book.js — receives dinkassa Z-reports (scraped by the GitHub Action,
// which can run a real browser) and books them to Fortnox. Auth: CRON_SECRET bearer.
//
// Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", machines: [{ id, name, zReports: [...] }] }
//   (legacy: { businessDate, machines } — treated as from=to=businessDate)
//
// Each Z-report becomes one Fortnox voucher dated by its own ReportDateTime. Days are
// booked in chronological order so voucher numbers follow the dates. Idempotent per
// (kassa, day).

import { sbSelect, sbInsert } from "./_lib/supabaseAdmin.js";
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

  const { from, to, businessDate, machines, salesDays } = req.body || {};
  const rangeFrom = from || businessDate;
  const rangeTo = to || businessDate || from;
  if (!Array.isArray(machines) || !rangeFrom) {
    return res.status(400).json({ error: "machines[] + from (eller businessDate) krävs" });
  }

  try {
    const [maps, tokens, posted] = await Promise.all([
      sbSelect("fortnox_shop_map", "select=*&source=eq.dinkassa"),
      sbSelect("fortnox_tokens", "select=*"),
      sbSelect("fortnox_postings", `select=qopla_shop_id,business_date,status&business_date=gte.${rangeFrom}&business_date=lte.${rangeTo}`),
    ]);
    const mapById = new Map((maps || []).map(m => [m.qopla_shop_id, m]));
    const tokenByCompany = new Map((tokens || []).map(t => [t.company_id, t]));
    const okSet = new Set((posted || []).filter(p => p.status === "ok").map(p => `${p.qopla_shop_id}|${p.business_date}`));

    // Store combined Chao daily sales from the overview (real figures incl. orders),
    // independent of mapping/booking, so the widget/reports can show Chao.
    for (const d of Array.isArray(salesDays) ? salesDays : []) {
      if (!d || !d.date) continue;
      try {
        await sbInsert("pos_daily_sales", {
          qopla_shop_id: "dinkassa-chao", business_date: d.date, shop_name: "Chao", source: "dinkassa",
          sales: Math.round(Number(d.sales || 0) * 100) / 100,
          orders: d.orders != null ? Math.round(Number(d.orders)) : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "qopla_shop_id,business_date" });
      } catch { /* sales storage must not break booking */ }
    }

    const results = [];
    const pending = []; // { shopId, shopName, companyId, tokenRow, date, vouchers }

    // Phase 1: per machine — seed mapping row, validate, collect un-booked days.
    for (const machine of machines) {
      const shopId = machine.id;
      const shopName = machine.name || shopId;

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

      const tokenRow = tokenByCompany.get(m.company_id);
      if (!tokenRow) { results.push({ shop: shopName, status: "error", message: "Bolaget saknar Fortnox-token" }); continue; }

      const payload = zReportsToSiePayload(machine.zReports || []);
      const { vouchers, skipped: dropped } = buildVouchersFromSie(payload, { shopName, costCenterOverride: m.cost_center || null });
      // Surface verifications that couldn't be booked (e.g. unbalanced) as errors.
      for (const s of dropped || []) {
        if (okSet.has(`${shopId}|${s.date}`)) continue;
        await record(shopId, s.date, m.company_id, null, "error", s.reason);
        results.push({ shop: shopName, date: s.date, status: "error", message: s.reason });
      }
      if (!vouchers.length) {
        if (!(dropped || []).length) results.push({ shop: shopName, status: "skipped", message: "Inga verifikationer" });
        continue;
      }

      const byDate = new Map();
      for (const v of vouchers) {
        const arr = byDate.get(v.TransactionDate) || [];
        arr.push(v);
        byDate.set(v.TransactionDate, arr);
      }
      for (const [date, dayVouchers] of byDate) {
        if (okSet.has(`${shopId}|${date}`)) { results.push({ shop: shopName, date, status: "skipped", message: "redan bokfört" }); continue; }
        pending.push({ shopId, shopName, companyId: m.company_id, tokenRow, date, vouchers: dayVouchers });
      }
    }

    // Phase 2: book chronologically so voucher numbers follow the dates.
    pending.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.shopName.localeCompare(b.shopName)));
    const accessByCompany = new Map();
    for (const p of pending) {
      const base = { shop: p.shopName, date: p.date };
      try {
        let accessToken = accessByCompany.get(p.companyId);
        if (!accessToken) { accessToken = await getCompanyAccessToken(p.tokenRow); accessByCompany.set(p.companyId, accessToken); }
        const voucherNumbers = [];
        for (const v of p.vouchers) {
          const created = await createVoucher(accessToken, v);
          voucherNumbers.push(`${created.VoucherSeries}${created.VoucherNumber}`);
        }
        await record(p.shopId, p.date, p.companyId, voucherNumbers.join(", "), "ok", "OK");
        results.push({ ...base, status: "ok", voucherNumbers });
      } catch (e) {
        await record(p.shopId, p.date, p.companyId, null, "error", e.message);
        results.push({ ...base, status: "error", message: e.message });
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
