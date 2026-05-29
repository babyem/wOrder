// api/dinkassa.js — Vercel serverless function exposing dinkassa data to the app.
//   ?action=machines        -> { machines: [{id,name}] }   (kassor, for the mapping UI)
//   ?action=sales           -> { sales: [{shopId,restaurant,sales,orders,currency}], items }
//       optional ?date=yesterday, or ?start=YYYY-MM-DD&end=YYYY-MM-DD
// Credentials live server-side (DINKASSA_USERNAME/PASSWORD); see api/_lib/dinkassa.js.

import { listMachines, fetchSalesOverview, bustSession } from "./_lib/dinkassa.js";

function stockholmDateStr(daysAgo = 0) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  if (!daysAgo) return today;
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d - daysAgo));
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(base);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const action = req.query.action || "sales";

    if (action === "machines") {
      const machines = await listMachines();
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json({ machines, fetchedAt: new Date().toISOString() });
    }

    // sales overview (combined across kassor for the period)
    const daysAgo = req.query.date === "yesterday" ? 1 : 0;
    const start = req.query.start || stockholmDateStr(daysAgo);
    const end = req.query.end || start;
    const items = await fetchSalesOverview({ startDate: start, endDate: end });
    let sales = 0, orders = 0;
    for (const it of items) {
      sales += Number(it["**TOTAL**|BELOPP"] || 0);
      orders += Number(it["**TOTAL**|ANTAL KVITTON"] || 0);
    }
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      sales: [{ shopId: "dinkassa-chao", restaurant: "Chao", sales, orders, currency: "SEK" }],
      items,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (/session|auth/i.test(err.message)) bustSession();
    return res.status(500).json({ error: err.message });
  }
}
