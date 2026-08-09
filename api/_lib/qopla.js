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
let SESSIONS_CACHE = null; // { sessions: [...], errors: [...], expiresAt }
const QR_TOKEN_CACHE = new Map(); // key=shopId -> { token, expiresAt }
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 min safe under Qopla's ttlTimeoutMs

export function bustSession() { SESSIONS_CACHE = null; }

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

// Alla konfigurerade Qopla-inloggningar.
//   Bolag 1:   QOPLA_EMAIL / QOPLA_PASSWORD (+ QOPLA_LABEL)
//   Bolag 2+:  QOPLA_EMAIL_2 / QOPLA_PASSWORD_2 … upp till _10
//   Alternativ: QOPLA_ACCOUNTS = [{"email":"…","password":"…","label":"Bolag B"}, …]
// Ordningen är stabil: QOPLA_EMAIL först (getSession() = det bolaget).
export function getQoplaAccounts() {
  const accounts = [];
  const seen = new Set();
  const add = (email, password, label) => {
    if (!email || !password || seen.has(email)) return;
    seen.add(email);
    accounts.push({ email, password, label: label || null });
  };

  const suffixes = ["", ...Array.from({ length: 9 }, (_, i) => `_${i + 2}`)];
  for (const s of suffixes) {
    add(process.env[`QOPLA_EMAIL${s}`], process.env[`QOPLA_PASSWORD${s}`], process.env[`QOPLA_LABEL${s}`]);
  }

  if (process.env.QOPLA_ACCOUNTS) {
    let parsed;
    try {
      parsed = JSON.parse(process.env.QOPLA_ACCOUNTS);
    } catch {
      throw new Error("QOPLA_ACCOUNTS är inte giltig JSON");
    }
    for (const a of parsed || []) {
      if (!a?.email || !a?.password) throw new Error("QOPLA_ACCOUNTS: varje post kräver email och password");
      add(a.email, a.password, a.label);
    }
  }

  return accounts;
}

async function buildSession(account) {
  const login = await loginRaw(account.email, account.password);
  const shops = await getShopsRaw(login.companyId, login.token);
  return {
    token: login.token,
    companyId: login.companyId,
    shops,
    label: account.label || null,
    ttlTimeoutMs: login.ttlTimeoutMs,
  };
}

// Alla bolag. Ett bolag som failar (fel lösen, Qopla nere) stoppar inte de andra —
// felet returneras i .errors och övriga bolag levereras ändå.
export async function getSessions() {
  const now = Date.now();
  if (SESSIONS_CACHE && SESSIONS_CACHE.expiresAt > now) return SESSIONS_CACHE;

  const accounts = getQoplaAccounts();
  if (accounts.length === 0) {
    throw new Error("QOPLA_EMAIL / QOPLA_PASSWORD saknas i miljövariabler");
  }

  const results = await Promise.all(accounts.map(async a => {
    try { return { session: await buildSession(a) }; }
    catch (err) { return { error: { account: a.label || a.email, message: err.message } }; }
  }));

  const sessions = results.map(r => r.session).filter(Boolean);
  const errors = results.map(r => r.error).filter(Boolean);
  if (sessions.length === 0) {
    throw new Error(errors.map(e => `${e.account}: ${e.message}`).join(" | "));
  }

  const ttl = Math.min(
    SESSION_TTL_MS,
    ...sessions.map(s => s.ttlTimeoutMs || SESSION_TTL_MS)
  );
  // Kortare cache om något bolag failade — försök igen snart
  const cacheMs = errors.length > 0 ? Math.min(ttl, 60_000) : ttl;
  SESSIONS_CACHE = { sessions, errors, expiresAt: now + cacheMs - 30_000 };
  return SESSIONS_CACHE;
}

// Första bolaget — bakåtkompatibelt för fortnox-sync och monthly-report.
export async function getSession() {
  const { sessions } = await getSessions();
  return sessions[0];
}

// Alla restauranger från alla bolag, var och en med sitt eget token/companyId.
export async function getAllShops() {
  const { sessions, errors } = await getSessions();
  const shops = [];
  for (const s of sessions) {
    for (const shop of s.shops) {
      shops.push({
        id: shop.id,
        name: shop.name,
        companyId: s.companyId,
        token: s.token,
        company: s.label || s.companyId,
      });
    }
  }
  return { shops, errors };
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
