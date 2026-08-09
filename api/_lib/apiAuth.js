// api/_lib/apiAuth.js — bearer-auth för endpoints som exponerar försäljningsdata.
// Accepterar inloggad admin (Supabase JWT) eller CRON_SECRET (cron/GitHub Action).

import { getUserFromJwt } from "./supabaseAdmin.js";

export function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export async function isAuthorized(req) {
  const bearer = getBearer(req);
  if (!bearer) return false;
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return true;
  return !!(await getUserFromJwt(bearer));
}

// Svarar 401 och returnerar false om anropet inte är behörigt.
export async function requireAuth(req, res) {
  if (await isAuthorized(req)) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}
