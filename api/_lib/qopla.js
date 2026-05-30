// api/_lib/qopla.js — shared Qopla client (login, session, SIE).
// Imported by api/qopla.js (public endpoint) and api/fortnox-sync.js (cron).
// Files prefixed with "_" are NOT treated as routes by Vercel.

const GRAPHQL_URL = "https://api.qopla.com/graphql";
const QREPORT_URL = "https://qreport.qopla.com";

export async function gql(query, variables, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`GraphQL parse error (${res.status}): ${text.slice(0, 200)}`);
  }
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export function getDateRange(daysAgo = 0) {
  const now = new Date();
  const stockholmDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  let [year, month, day] = stockholmDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day - daysAgo));
  year = base.getUTCFullYear(); month = base.getUTCMonth() + 1; day = base.getUTCDate();
  const testDate = new Date(`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T12:00:00`);
  const stockholmHour = parseInt(new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false,
  }).format(testDate));
  const offsetMs = (stockholmHour - testDate.getUTCHours()) * 3600 * 1000;
  const startDate = new Date(Date.UTC(year, month - 1, day) - offsetMs);
  const endDate = new Date(startDate.getTime() + 24 * 3600 * 1000 - 1);
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
}

// ISO start/end of a specific Europe/Stockholm calendar day ("YYYY-MM-DD").
export function dayRangeISO(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const stockholmHour = parseInt(new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false,
  }).format(noonUTC), 10);
  const offsetMs = (stockholmHour - 12) * 3600 * 1000;
  const startDate = new Date(Date.UTC(y, m - 1, d) - offsetMs);
  const endDate = new Date(startDate.getTime() + 24 * 3600 * 1000 - 1);
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
}

// Current hour-of-day (0–23) in Europe/Stockholm.
export function stockholmHourNow() {
  const h = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false,
  }).format(new Date());
  return parseInt(h, 10) % 24;
}

// ---------- Module-scope cache (per warm container) ----------
let SESSION_CACHE = null; // { token, companyId, shops, expiresAt }
const QR_TOKEN_CACHE = new Map(); // key=shopId -> { token, expiresAt }
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 min safe under Qopla's ttlTimeoutMs

export function bustSession() { SESSION_CACHE = null; }

async function loginRaw(email, password) {
  const data = await gql(
    `mutation login($credentials: CredentialsInput) {
      login(userCredentials: $credentials) { token companyId }
      ttlTimeoutMs
    }`,
    { credentials: { username: email, password } }
  );
  return { ...data.login, ttlTimeoutMs: data.ttlTimeoutMs };
}

async function getShopsRaw(companyId, token) {
  const data = await gql(
    `query getCompanyShops($companyId: String!) {
      getCompanyShops(companyId: $companyId) { id name }
    }`,
    { companyId }, token
  );
  return data.getCompanyShops;
}

export async function getSession() {
  const now = Date.now();
  if (SESSION_CACHE && SESSION_CACHE.expiresAt > now) {
    return SESSION_CACHE;
  }
  const email = process.env.QOPLA_EMAIL;
  const password = process.env.QOPLA_PASSWORD;
  if (!email || !password) {
    throw new Error("QOPLA_EMAIL / QOPLA_PASSWORD saknas i miljövariabler");
  }
  const login = await loginRaw(email, password);
  const shops = await getShopsRaw(login.companyId, login.token);
  const ttl = Math.min(login.ttlTimeoutMs || SESSION_TTL_MS, SESSION_TTL_MS);
  SESSION_CACHE = {
    token: login.token,
    companyId: login.companyId,
    shops,
    expiresAt: now + ttl - 30_000, // 30s safety margin
  };
  return SESSION_CACHE;
}

export async function getQReportToken(companyId, shopId, token) {
  const now = Date.now();
  const cached = QR_TOKEN_CACHE.get(shopId);
  if (cached && cached.expiresAt > now) return cached.token;
  const data = await gql(
    `query qReportToken($companyId: String, $shopIds: [String]) {
      getQReportToken(companyId: $companyId, shopIds: $shopIds)
    }`,
    { companyId, shopIds: [shopId] }, token
  );
  const qToken = data.getQReportToken;
  QR_TOKEN_CACHE.set(shopId, { token: qToken, expiresAt: now + SESSION_TTL_MS - 30_000 });
  return qToken;
}

export async function fetchOverviewRaw({ companyId, token, shopId, startDate, endDate }) {
  const qReportToken = await getQReportToken(companyId, shopId, token);
  const r = await fetch(`${QREPORT_URL}/overview`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=utf-8", Authorization: qReportToken },
    body: JSON.stringify({ shopIDs: [shopId], startDate, endDate }),
  });
  const text = await r.text();
  return text ? JSON.parse(text) : { aggregatedReport: {} };
}

// SIE-nedladdning — GraphQL mutation createSIEFileByDate.
// Returns the raw payload: { header, referenceReportId, verifications[] }.
const SIE_MUTATION = `mutation createSIEFileByDate($shopId: String, $startDate: String, $endDate: String) {
  createSIEFileByDate(shopId: $shopId, startDate: $startDate, endDate: $endDate) {
    header
    referenceReportId
    verifications {
      date
      name
      sieTransactions {
        sieAccountNumber
        amount
        costCenter
      }
    }
  }
}`;

export async function fetchSiePayload({ token, shopId, startDate, endDate }) {
  const data = await gql(SIE_MUTATION, { shopId, startDate, endDate }, token);
  return data.createSIEFileByDate;
}
