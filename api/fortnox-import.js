// api/fortnox-import.js — POST a SIE4 (.se) file's text + a target Fortnox company;
// parses it and books each verification as a Fortnox voucher (series "F").
// Free fallback for POS without an API (e.g. dinkassa). Admin JWT required.
//
// Body: { sie: "<.se file text>", companyId: "<fortnox_companies.id>", source?: "filename" }
//
// Idempotent: each verification is keyed by a content hash (date + rows), so re-uploading
// the same file skips already-booked verifications — but different kassor / days still book.

import crypto from "node:crypto";
import { sbSelect, sbInsert, getUserFromJwt } from "./_lib/supabaseAdmin.js";
import { parseSie4 } from "./_lib/sie.js";
import { buildVouchersFromSie, getCompanyAccessToken, createVoucher } from "./_lib/fortnox.js";

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

// Stable content hash of a voucher (date + sorted rows) — identical data => identical hash.
function voucherHash(v) {
  const rows = (v.VoucherRows || [])
    .map(r => `${r.Account}:${r.Debit}:${r.Credit}:${r.CostCenter || ""}`)
    .sort()
    .join("|");
  return crypto.createHash("sha1").update(`${v.TransactionDate}|${rows}`).digest("hex").slice(0, 16);
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
    const { vouchers, warnings, skipped: dropped } = buildVouchersFromSie(payload, { shopName: source || "SIE-import" });

    const results = [];
    // Surface verifications that couldn't be booked (e.g. unbalanced) as errors.
    for (const s of dropped || []) {
      await record(`sie:${companyId}:unbalanced:${s.date}`, s.date, companyId, null, "error", s.reason);
      results.push({ date: s.date, status: "error", message: s.reason });
    }

    if (!vouchers.length) {
      return res.status(200).json({
        posted: 0, skipped: 0, results, warnings,
        message: results.length ? "Obalanserade/ej bokförbara verifikationer — se Senaste körningar" : "Inga verifikationer hittades i filen",
      });
    }

    // Already-imported verifications for this company (content-hash keyed).
    const existing = await sbSelect(
      "fortnox_postings",
      `select=qopla_shop_id,business_date,status&status=eq.ok&qopla_shop_id=like.sie:${companyId}:*`,
    );
    const okSet = new Set((existing || []).map(p => `${p.qopla_shop_id}|${p.business_date}`));

    const accessToken = await getCompanyAccessToken(tokenRow);
    for (const v of vouchers) {
      const shopKey = `sie:${companyId}:${voucherHash(v)}`;
      const date = v.TransactionDate;
      if (okSet.has(`${shopKey}|${date}`)) {
        results.push({ date, status: "skipped", message: "redan importerad" });
        continue;
      }
      try {
        const created = await createVoucher(accessToken, v);
        const num = `${created.VoucherSeries}${created.VoucherNumber}`;
        await record(shopKey, date, companyId, num, "ok", source);
        okSet.add(`${shopKey}|${date}`);
        results.push({ date, voucher: num, status: "ok" });
      } catch (e) {
        await record(shopKey, date, companyId, null, "error", e.message);
        results.push({ date, status: "error", message: e.message });
      }
    }
    return res.status(200).json({
      posted: results.filter(r => r.status === "ok").length,
      skipped: results.filter(r => r.status === "skipped").length,
      results, warnings,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function record(shopKey, businessDate, companyId, voucherNumber, status, message) {
  try {
    await sbInsert("fortnox_postings", {
      qopla_shop_id: shopKey,
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
