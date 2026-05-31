// api/ancon-live.js — fetch Woso Emporia's TODAY intraday sales server-side (~1-2s)
// from the ancon Försäljningsöversikt data endpoint and store them in pos_daily_sales.
// Synchronous: the widget/reports sync button calls this and gets today's figure back
// immediately (no GitHub Action / browser needed). Auth: admin JWT or CRON_SECRET.

import { sbInsert, getUserFromJwt } from "./_lib/supabaseAdmin.js";
import { getTodayLive } from "./_lib/ancon.js";

const SHOP_ID = `ancon:${process.env.ANCON_TENANT || "IgE"}`;
const SHOP_NAME = "Woso Emporia";

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).end();
  const bearer = getBearer(req);
  const isCron = process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;
  const user = isCron ? null : await getUserFromJwt(bearer);
  if (!isCron && !user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { date, sales, orders } = await getTodayLive();
    if (sales > 0) {
      await sbInsert("pos_daily_sales", {
        qopla_shop_id: SHOP_ID, business_date: date, shop_name: SHOP_NAME, source: "ancon",
        sales, orders, updated_at: new Date().toISOString(),
      }, { onConflict: "qopla_shop_id,business_date" });
    }
    return res.status(200).json({ ok: true, date, sales, orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
