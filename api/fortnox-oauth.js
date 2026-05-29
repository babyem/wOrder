// api/fortnox-oauth.js — Fortnox OAuth2 connect flow per company (bolag).
//
// Three branches on one endpoint (also the registered redirect_uri):
//   ?init=1&company_id=<uuid>  (admin JWT) → returns { url } to send the admin to Fortnox.
//   ?code=...&state=...        (Fortnox redirect) → exchange code, store tokens, redirect to UI.
//   ?status=1                  (admin JWT) → { connected: { [companyId]: true } } (no secrets).
//
// The `state` is HMAC-signed and time-limited, so only a logged-in admin can start a
// binding and a tampered/stale callback is rejected (prevents binding a stranger's
// Fortnox to one of our company rows).
//
// Env: FORTNOX_CLIENT_ID, FORTNOX_CLIENT_SECRET, FORTNOX_REDIRECT_URI (must match the
//      URI registered in the Fortnox developer portal), optional FORTNOX_SCOPES,
//      FORTNOX_STATE_SECRET (falls back to CRON_SECRET).

import crypto from "node:crypto";
import { sbSelect, getUserFromJwt } from "./_lib/supabaseAdmin.js";
import { exchangeAuthCode, storeCompanyTokens } from "./_lib/fortnox.js";

const AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min to complete consent
const b64url = (s) => Buffer.from(s).toString("base64url");

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function stateSecret() {
  return process.env.FORTNOX_STATE_SECRET || process.env.CRON_SECRET || process.env.FORTNOX_CLIENT_SECRET || "";
}

function signState(companyId, expMs) {
  const payload = b64url(JSON.stringify({ c: companyId, e: expMs }));
  const mac = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verifyState(state) {
  if (!state || !state.includes(".")) return null;
  const [payload, mac] = state.split(".");
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data; try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (!data.c || !data.e || Date.now() > data.e) return null;
  return data.c;
}

function redirectUri(req) {
  if (process.env.FORTNOX_REDIRECT_URI) return process.env.FORTNOX_REDIRECT_URI;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/fortnox-oauth`;
}

function redirectToUi(res, status, msg) {
  const params = new URLSearchParams({ fortnox: status });
  if (msg) params.set("msg", String(msg).slice(0, 160));
  res.writeHead(302, { Location: `/admin/fortnox?${params.toString()}` });
  res.end();
}

export default async function handler(req, res) {
  try {
    // --- status: which companies have a token (booleans only) ---
    if (req.query.status === "1") {
      const user = await getUserFromJwt(getBearer(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const rows = await sbSelect("fortnox_tokens", "select=company_id");
      const connected = {};
      for (const r of rows || []) connected[r.company_id] = true;
      return res.status(200).json({ connected });
    }

    // --- init: build a signed authorize URL for a logged-in admin ---
    if (req.query.init === "1") {
      const user = await getUserFromJwt(getBearer(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const companyId = req.query.company_id;
      if (!companyId) return res.status(400).json({ error: "company_id krävs" });
      const clientId = process.env.FORTNOX_CLIENT_ID;
      if (!clientId) return res.status(500).json({ error: "FORTNOX_CLIENT_ID saknas" });

      const url = new URL(AUTH_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri(req));
      url.searchParams.set("scope", process.env.FORTNOX_SCOPES || "bookkeeping costcenter");
      url.searchParams.set("state", signState(companyId, Date.now() + STATE_TTL_MS));
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("response_type", "code");
      return res.status(200).json({ url: url.toString() });
    }

    // --- callback: Fortnox redirected here with code + state ---
    if (req.query.code || req.query.error) {
      if (req.query.error) return redirectToUi(res, "err", req.query.error_description || req.query.error);
      const companyId = verifyState(req.query.state);
      if (!companyId) return redirectToUi(res, "err", "Ogiltig eller utgången state");
      const tokens = await exchangeAuthCode(req.query.code, redirectUri(req));
      if (!tokens.refresh_token) return redirectToUi(res, "err", "Inget refresh_token i svaret");
      await storeCompanyTokens(companyId, tokens);
      return redirectToUi(res, "ok");
    }

    return res.status(400).json({ error: "Okänd förfrågan" });
  } catch (err) {
    if (req.query.code) return redirectToUi(res, "err", err.message);
    return res.status(500).json({ error: err.message });
  }
}
