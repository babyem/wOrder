// api/_lib/dinkassa.js — dinkassa.se (ES Kassasystem) client for the Chao restaurant.
//
// Reverse-engineered from the dinkassa web app (no public report API):
//   Login:    POST /api/session/Authenticate  body {Username,Password} -> {Id (=SessionId), ExpiresDateTime}
//   Machines: GET  /api/machine                -> {Items:[{Id,Name}]}   (the kassor)
//   Z-report: GET  /api/reports/download-z-report-by-date/json?machineId=&startDate=&endDate=
//             -> {ZReports:[{ZReport,ReportDateTime,Accounts:[{Number,Amount}]}]}
//   Sales:    POST /api/reports/get-report-result/EHK_SalesOverview body {Parameters:[...]}
// All authed calls send headers SessionId + IntegratorId. Z-report Account.Amount uses the
// same sign convention as Qopla SIE (>0 debit, <0 credit), so buildVouchersFromSie reuses it.
//
// Env: DINKASSA_USERNAME, DINKASSA_PASSWORD, optional DINKASSA_INTEGRATOR_ID.

const BASE = "https://dinkassa.se/api";
const INTEGRATOR_ID = process.env.DINKASSA_INTEGRATOR_ID || "cc7c4035-ce21-40a6-95e2-a39a641a1c27";

let SESSION = null; // { sessionId, expiresAt }

// Strip whitespace and a single layer of matching surrounding quotes — common paste
// artifacts in env values that otherwise cause "Invalid credentials".
function cleanEnv(v) {
  return (v || "").trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
}

async function authenticate() {
  const Username = cleanEnv(process.env.DINKASSA_USERNAME);
  const Password = cleanEnv(process.env.DINKASSA_PASSWORD);
  if (!Username || !Password) throw new Error("DINKASSA_USERNAME / DINKASSA_PASSWORD saknas i miljövariabler");
  const res = await fetch(`${BASE}/session/Authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", IntegratorId: INTEGRATOR_ID },
    body: JSON.stringify({ Username, Password }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok || !json.Id) throw new Error(`dinkassa auth ${res.status}: ${text.slice(0, 160)}`);
  const expiresAt = json.ExpiresDateTime ? new Date(json.ExpiresDateTime).getTime() : Date.now() + 30 * 60 * 1000;
  return { sessionId: json.Id, expiresAt };
}

export function bustSession() { SESSION = null; }

async function getSessionId() {
  const now = Date.now();
  if (SESSION && SESSION.expiresAt > now + 60_000) return SESSION.sessionId;
  SESSION = await authenticate();
  return SESSION.sessionId;
}

function authHeaders(sessionId) {
  return { Accept: "application/json", SessionId: sessionId, IntegratorId: INTEGRATOR_ID };
}

// List the account's kassor (cash registers).
export async function listMachines() {
  const sid = await getSessionId();
  const res = await fetch(`${BASE}/machine`, { headers: authHeaders(sid) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) throw new Error(`dinkassa machines ${res.status}: ${text.slice(0, 160)}`);
  return (json.Items || []).map(m => ({ id: m.Id, name: m.Name }));
}

// Fetch Z-reports for one machine over a date range (dates as YYYY-MM-DD).
export async function fetchZReports({ machineId, startDate, endDate }) {
  const sid = await getSessionId();
  const url = `${BASE}/reports/download-z-report-by-date/json?machineId=${encodeURIComponent(machineId)}&startDate=${startDate}&endDate=${endDate}`;
  const res = await fetch(url, { headers: authHeaders(sid) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) {
    if (/session|auth|unauthor/i.test(text)) bustSession();
    throw new Error(`dinkassa z-report ${res.status}: ${text.slice(0, 160)}`);
  }
  return json.ZReports || [];
}

// Convert dinkassa ZReports → the same payload shape Qopla's createSIEFileByDate produces,
// so buildVouchersFromSie() works unchanged. One Z-report = one verification.
export function zReportsToSiePayload(zReports) {
  return {
    referenceReportId: (zReports[0] && zReports[0].ZReport) || null,
    verifications: (zReports || []).map(z => ({
      date: (z.ReportDateTime || "").slice(0, 10),
      name: z.ZReport || "Z",
      sieTransactions: (z.Accounts || []).map(a => ({
        sieAccountNumber: a.Number,
        amount: a.Amount,
        costCenter: null,
      })),
    })),
  };
}

// Sales overview (per period). Returns the raw Items array.
export async function fetchSalesOverview({ startDate, endDate, periodType = "Day" }) {
  const sid = await getSessionId();
  const res = await fetch(`${BASE}/reports/get-report-result/EHK_SalesOverview`, {
    method: "POST",
    headers: { ...authHeaders(sid), "Content-Type": "application/json" },
    body: JSON.stringify({
      Parameters: [
        { Name: "Period-typ", Value: periodType },
        { Name: "Fr.o.m.-datum", Value: startDate },
        { Name: "T.o.m.-datum", Value: endDate },
      ],
    }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) throw new Error(`dinkassa overview ${res.status}: ${text.slice(0, 160)}`);
  return json.Items || [];
}
