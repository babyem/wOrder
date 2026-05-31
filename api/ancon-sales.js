// api/ancon-sales.js — receives today's intraday ancon sales scraped by the GitHub
// Action (a real browser renders the Försäljningsöversikt report) and stores it in
// pos_daily_sales so the widget/reports show Woso Emporia for today. Auth: CRON_SECRET.
//
// Body: { date: "YYYY-MM-DD", sales: number, orders?: number }

import { sbInsert } from "./_lib/supabaseAdmin.js";

const SHOP_ID = `ancon:${process.env.ANCON_TENANT || "IgE"}`;
const SHOP_NAME = "Woso Emporia";

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.CRON_SECRET || getBearer(req) !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { date, sales, orders } = req.body || {};
  if (!date || sales == null) return res.status(400).json({ error: "date + sales krävs" });
  try {
    await sbInsert("pos_daily_sales", {
      qopla_shop_id: SHOP_ID, business_date: date, shop_name: SHOP_NAME, source: "ancon",
      sales: Math.round(Number(sales) * 100) / 100,
      orders: orders != null ? Math.round(Number(orders)) : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "qopla_shop_id,business_date" });
    return res.status(200).json({ ok: true, date, sales });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
