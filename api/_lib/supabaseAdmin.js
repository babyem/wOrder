// api/_lib/supabaseAdmin.js — server-only Supabase access via the service-role key.
// Used by api/fortnox-sync.js to read the secret fortnox_tokens table (anon-denied)
// and to validate the logged-in admin's JWT for the manual "Kör nu" trigger.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function requireConfig() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY saknas i miljövariabler");
  }
}

async function rest(method, path, { body, prefer } = {}) {
  requireConfig();
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = (json && json.message) || text || `Supabase ${res.status}`;
    throw new Error(`Supabase ${method} ${path}: ${msg}`);
  }
  return json;
}

// SELECT rows. `query` is a raw PostgREST query string, e.g. "select=*&enabled=eq.true".
export function sbSelect(table, query = "select=*") {
  return rest("GET", `${table}?${query}`);
}

// INSERT (optionally upsert on a unique constraint via on_conflict).
export function sbInsert(table, row, { onConflict } = {}) {
  const path = onConflict ? `${table}?on_conflict=${onConflict}` : table;
  const prefer = onConflict
    ? "resolution=merge-duplicates,return=representation"
    : "return=representation";
  return rest("POST", path, { body: Array.isArray(row) ? row : [row], prefer });
}

// PATCH rows matching `query` (raw PostgREST filter, e.g. "company_id=eq.<uuid>").
export function sbUpdate(table, query, patch) {
  return rest("PATCH", `${table}?${query}`, { body: patch, prefer: "return=representation" });
}

// Validate a user access-token (from the browser session) → returns the user or null.
export async function getUserFromJwt(jwt) {
  if (!jwt || !SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}
