// api/_lib/ancon.js — Ancon WBO (login2.ancon.se) client for Woso Emporia.
//
// Standard ASP.NET Identity: form login (anti-forgery token + cookie) yields an auth
// cookie that works server-side (unlike dinkassa). Then:
//   POST /{tenant}/ZReports/GetZReports  (DataTables)  -> list of Z-reports
//   POST /{tenant}/ZReports/GetSIE/{id}  (+ anti-forgery) -> { SIEFiles:[{Content: base64 SIE4}] }
//
// Env: ANCON_EMAIL, ANCON_PASSWORD, optional ANCON_TENANT (default "IgE").

const BASE = "https://login2.ancon.se";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const tenant = () => process.env.ANCON_TENANT || "IgE";

let SESSION = null; // { jar, token, expiresAt }

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
function addSetCookies(jar, res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const m = /^([^=]+)=([^;]*)/.exec(c);
    if (m && m[2] !== "") jar[m[1]] = m[2];
  }
  return jar;
}
function extractToken(html) {
  const m = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html);
  return m ? m[1] : null;
}

async function login() {
  const email = process.env.ANCON_EMAIL;
  const password = process.env.ANCON_PASSWORD;
  if (!email || !password) throw new Error("ANCON_EMAIL / ANCON_PASSWORD saknas i miljövariabler");

  const jar = {};
  // 1. GET login page → anti-forgery token + cookie.
  const r1 = await fetch(`${BASE}/Account/Login`, { headers: { "User-Agent": UA } });
  addSetCookies(jar, r1);
  const token1 = extractToken(await r1.text());
  if (!token1) throw new Error("ancon: kunde inte läsa login-token");

  // 2. POST credentials.
  const body = new URLSearchParams({ Email: email, Password: password, RememberMe: "false", __RequestVerificationToken: token1 });
  const r2 = await fetch(`${BASE}/Account/Login`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(jar), "User-Agent": UA },
    body: body.toString(),
  });
  addSetCookies(jar, r2);
  if (r2.status !== 302) throw new Error(`ancon login misslyckades (${r2.status}) — kontrollera ANCON_EMAIL/PASSWORD`);

  // 3. Load an authed page to get a token for subsequent POSTs (GetSIE needs it).
  const r3 = await fetch(`${BASE}/${tenant()}/ZReports`, { headers: { Cookie: cookieHeader(jar), "User-Agent": UA } });
  addSetCookies(jar, r3);
  const token = extractToken(await r3.text()) || token1;

  return { jar, token, expiresAt: Date.now() + 20 * 60 * 1000 };
}

export function bustSession() { SESSION = null; }

async function getSession() {
  if (SESSION && SESSION.expiresAt > Date.now()) return SESSION;
  SESSION = await login();
  return SESSION;
}

// DataTables form body for GetZReports (column layout from the live table).
function dtBody(length) {
  const cols = ["LasID", "ID", "AutoIncrementID", "MasterZNO", "ZNO", "PosName", "PosBaseID", "DateTime", "TotalPay", "TotalSaleNet", "TotalSaleGross", "TotalChangeSum", ""];
  const p = new URLSearchParams();
  p.set("draw", "1"); p.set("start", "0"); p.set("length", String(length));
  cols.forEach((c, i) => {
    p.set(`columns[${i}][data]`, c);
    p.set(`columns[${i}][searchable]`, "true");
    p.set(`columns[${i}][orderable]`, "true");
    p.set(`columns[${i}][search][value]`, "");
    p.set(`columns[${i}][search][regex]`, "false");
  });
  p.set("order[0][column]", "7"); p.set("order[0][dir]", "desc");
  p.set("search[value]", ""); p.set("search[regex]", "false");
  return p.toString();
}

// Most recent Z-reports (newest first). Caller filters by date / PosName.
export async function getZReports({ length = 800 } = {}) {
  const s = await getSession();
  const r = await fetch(`${BASE}/${tenant()}/ZReports/GetZReports`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(s.jar), "X-Requested-With": "XMLHttpRequest", "User-Agent": UA },
    body: dtBody(length),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { bustSession(); throw new Error("ancon GetZReports: ej JSON (utloggad?)"); }
  return j.data || [];
}

// SIE4 text for one Z-report (decoded from the base64 JSON payload).
export async function getSIE(id) {
  const s = await getSession();
  const r = await fetch(`${BASE}/${tenant()}/ZReports/GetSIE/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(s.jar), "X-Requested-With": "XMLHttpRequest", "User-Agent": UA },
    body: `__RequestVerificationToken=${encodeURIComponent(s.token)}`,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { bustSession(); throw new Error(`ancon GetSIE ${r.status}: ej JSON`); }
  const b64 = j.SIEFiles && j.SIEFiles[0] && j.SIEFiles[0].Content;
  if (!b64) throw new Error("ancon GetSIE: ingen SIE-fil i svaret");
  return Buffer.from(b64, "base64").toString("latin1");
}

// "Total Z" day rows within [from, to] (YYYY-MM-DD), oldest first.
// Returns [{ id, date, sales }]. Fetches only as many rows as needed to reach `from`
// (reports are newest-first), so a single recent day is fast.
export async function getDailyTotals({ from, to }) {
  const dayMs = 86400000;
  const daysBack = Math.max(0, Math.round((Date.now() - Date.parse(`${from}T12:00:00Z`)) / dayMs));
  const span = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1);
  const length = Math.min(1000, Math.max(20, (daysBack + span + 4) * 3)); // ~3 rows/day + buffer
  const rows = await getZReports({ length });
  return rows
    .filter(r => r.PosName === "Total Z")
    .map(r => ({ id: r.ID, date: String(r.DateTime || "").slice(0, 10), sales: Number(r.TotalSaleGross || 0) }))
    .filter(d => d.date >= from && d.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
