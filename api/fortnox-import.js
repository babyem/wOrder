// api/fortnox-import.js — POST a SIE4 (.se) file's text + a target Fortnox company;
// parses it and books each verification as a Fortnox voucher (series "F").
// Free fallback for POS systems we can't auto-pull (e.g. dinkassa). Admin JWT required.
//
// Body: { sie: "<.se file text>", companyId: "<fortnox_companies.id>", source?: "filename" }

import { sbSelect, sbInsert, getUserFromJwt } from "./_lib/supabaseAdmin.js";
import { parseSie4 } from "./_lib/sie.js";
import { buildVouchersFromSie, getCompanyAccessToken, createVoucher } from "./_lib/fortnox.js";

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await getUserFromJwt(getBearer(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { sie, companyId, source } = req.body || {};
  if (!sie || !companyId) return res.status(400).json({ error: "sie + companyId krävs" });

  try {
    const tokens = await sbSelect("fortnox_tokens", `select=*&company_id=eq.${companyId}`);
    const tokenRow = (tokens || [])[0];
    if (!tokenRow) return res.status(400).json({ error: "Bolaget saknar Fortnox-token (Anslut bolaget först)" });

    const payload = parseSie4(sie);
    const { vouchers, warnings } = buildVouchersFromSie(payload, { shopName: source || "SIE-import" });
    if (!vouchers.length) {
      return res.status(200).json({ posted: 0, results: [], warnings, message: "Inga verifikationer hittades i filen" });
    }

    const accessToken = await getCompanyAccessToken(tokenRow);
    const results = [];
    for (const v of vouchers) {
      try {
        const created = await createVoucher(accessToken, v);
        const num = `${created.VoucherSeries}${created.VoucherNumber}`;
        results.push({ date: v.TransactionDate, voucher: num, status: "ok" });
        await record(companyId, v.TransactionDate, num, "ok", source);
      } catch (e) {
        results.push({ date: v.TransactionDate, status: "error", message: e.message });
        await record(companyId, v.TransactionDate, null, "error", e.message);
      }
    }
    return res.status(200).json({ posted: results.filter(r => r.status === "ok").length, results, warnings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function record(companyId, businessDate, voucherNumber, status, message) {
  try {
    await sbInsert("fortnox_postings", {
      qopla_shop_id: `sie-upload:${companyId}`,
      business_date: businessDate,
      company_id: companyId,
      voucher_series: "F",
      voucher_number: voucherNumber,
      status,
      message: message ? String(message).slice(0, 500) : "SIE-uppladdning",
      created_at: new Date().toISOString(),
    }, { onConflict: "qopla_shop_id,business_date" });
  } catch { /* ignore logging errors */ }
}
