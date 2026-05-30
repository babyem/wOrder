// api/dinkassa-run.js — trigger the dinkassa GitHub Action from inside wOrder.
// Admin JWT required. Dispatches the workflow_dispatch event with an optional date.
//
// Env: GH_DISPATCH_TOKEN (PAT with Actions: read/write on the repo),
//      optional GITHUB_REPO (default "babyem/wOrder"), GH_WORKFLOW_FILE (default file).

import { getUserFromJwt } from "./_lib/supabaseAdmin.js";

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await getUserFromJwt(getBearer(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return res.status(500).json({ error: "GH_DISPATCH_TOKEN saknas i miljövariabler" });
  const repo = process.env.GITHUB_REPO || "babyem/wOrder";
  const workflow = process.env.GH_WORKFLOW_FILE || "dinkassa-fortnox.yml";

  const { date } = req.body || {};
  const inputs = {};
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date måste vara YYYY-MM-DD" });
    inputs.date = date;
  }

  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "wOrder",
      },
      body: JSON.stringify({ ref: "main", inputs }),
    });
    if (r.status === 204) return res.status(200).json({ triggered: true, date: date || "yesterday" });
    const t = await r.text();
    return res.status(500).json({ error: `GitHub dispatch ${r.status}: ${t.slice(0, 200)}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
