// api/_lib/fortnox.js — Fortnox OAuth2 + Vouchers API client.
// Token refresh ROTATES the refresh token (old one is invalidated), so the new
// one is persisted to fortnox_tokens immediately, before any voucher call.

import { sbUpdate, sbInsert } from "./supabaseAdmin.js";

const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se/3";

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Refresh grant. Returns { access_token, refresh_token (NEW), expires_in, ... }.
export async function refreshAccessToken(refreshToken) {
  const id = process.env.FORTNOX_CLIENT_ID;
  const secret = process.env.FORTNOX_CLIENT_SECRET;
  if (!id || !secret) throw new Error("FORTNOX_CLIENT_ID / FORTNOX_CLIENT_SECRET saknas i miljövariabler");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) {
    throw new Error(`Fortnox token refresh ${res.status}: ${json.error_description || json.error || text.slice(0, 200)}`);
  }
  return json;
}

// Returns a valid access token for the company, refreshing + persisting if needed.
// `tokenRow` = a row from fortnox_tokens; it is mutated in place so the caller can
// reuse the same row for several voucher posts within one run.
export async function getCompanyAccessToken(tokenRow) {
  const now = Date.now();
  const exp = tokenRow.access_token_expires_at ? new Date(tokenRow.access_token_expires_at).getTime() : 0;
  if (tokenRow.access_token && exp > now + 60_000) {
    return tokenRow.access_token;
  }
  const refreshed = await refreshAccessToken(tokenRow.refresh_token);
  const expiresAt = new Date(now + (refreshed.expires_in || 3600) * 1000).toISOString();
  const newRefresh = refreshed.refresh_token || tokenRow.refresh_token;
  // Persist rotated tokens BEFORE using the access token — a crash after a voucher
  // post but before persisting would otherwise lose the rotated refresh token (lockout).
  await sbUpdate("fortnox_tokens", `company_id=eq.${tokenRow.company_id}`, {
    refresh_token: newRefresh,
    access_token: refreshed.access_token,
    access_token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  tokenRow.refresh_token = newRefresh;
  tokenRow.access_token = refreshed.access_token;
  tokenRow.access_token_expires_at = expiresAt;
  return refreshed.access_token;
}

// POST one voucher. Returns the created Voucher { VoucherSeries, VoucherNumber, ... }.
export async function createVoucher(accessToken, voucher) {
  const res = await fetch(`${API_BASE}/vouchers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Voucher: voucher }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) {
    const info = json && json.ErrorInformation;
    const msg = (info && (info.message || info.Message)) || (json && json.message) || text.slice(0, 300);
    throw new Error(`Fortnox voucher ${res.status}: ${msg}`);
  }
  return json.Voucher;
}

// Exchange an authorization code (from the OAuth consent redirect) for tokens.
export async function exchangeAuthCode(code, redirectUri) {
  const id = process.env.FORTNOX_CLIENT_ID;
  const secret = process.env.FORTNOX_CLIENT_SECRET;
  if (!id || !secret) throw new Error("FORTNOX_CLIENT_ID / FORTNOX_CLIENT_SECRET saknas i miljövariabler");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) {
    throw new Error(`Fortnox code exchange ${res.status}: ${json.error_description || json.error || text.slice(0, 200)}`);
  }
  return json;
}

// Persist tokens for a company (upsert on company_id).
export async function storeCompanyTokens(companyId, tokens) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  await sbInsert("fortnox_tokens", {
    company_id: companyId,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token || null,
    access_token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_id" });
}

// Map a Qopla createSIEFileByDate payload → Fortnox vouchers (one per verification).
// SIE sign convention: amount > 0 = debit, amount < 0 = credit.
export function buildVouchersFromSie(payload, { shopName, costCenterOverride, series = "F" } = {}) {
  const vouchers = [];
  const warnings = [];
  for (const v of (payload && payload.verifications) || []) {
    const date = (v.date || "").slice(0, 10); // YYYY-MM-DD
    const rows = [];
    let sumDebit = 0, sumCredit = 0;
    for (const t of v.sieTransactions || []) {
      const amount = Number(t.amount || 0);
      if (!amount) continue;
      const row = { Account: parseInt(t.sieAccountNumber, 10) };
      if (amount >= 0) { row.Debit = round2(amount); row.Credit = 0; sumDebit += row.Debit; }
      else { row.Debit = 0; row.Credit = round2(-amount); sumCredit += row.Credit; }
      const cc = costCenterOverride || t.costCenter;
      if (cc) row.CostCenter = String(cc);
      rows.push(row);
    }
    if (!rows.length) continue;
    if (Math.abs(round2(sumDebit - sumCredit)) > 0.01) {
      warnings.push(`Obalanserad verifikation ${date} (${shopName}): debet ${sumDebit.toFixed(2)} ≠ kredit ${sumCredit.toFixed(2)}`);
      continue; // never post an unbalanced voucher
    }
    vouchers.push({
      VoucherSeries: series,
      TransactionDate: date,
      Description: `${shopName || "Qopla"} ${date}`.slice(0, 100),
      VoucherRows: rows,
    });
  }
  return { vouchers, warnings, referenceReportId: (payload && payload.referenceReportId) || null };
}
