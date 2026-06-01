// api/qopla.js — Vercel serverless function
// Sätt QOPLA_EMAIL och QOPLA_PASSWORD i Vercel Dashboard → Settings → Environment Variables
// Delad Qopla-logik (login, session, SIE) ligger i api/_lib/qopla.js.

import {
  gql,
  getDateRange,
  getSession,
  fetchOverviewRaw,
  fetchSiePayload,
  bustSession,
} from "./_lib/qopla.js";

async function fetchShopOverview({ companyId, token, shop, startDate, endDate }) {
  const data = await fetchOverviewRaw({ companyId, token, shopId: shop.id, startDate, endDate });
  const report = data.aggregatedReport || {};
  let totalSum = 0, totalOrders = 0;
  const byChannel = {};
  for (const [channel, ch] of Object.entries(report)) {
    // Subtract refundsTotalSum so the figure matches Qopla dashboard "Försäljning inkl returer"
    const gross   = ch.totalSum || 0;
    const refunds = ch.refundsTotalSum || 0; // negative value, e.g. -554
    const net     = gross + refunds;
    totalSum   += net;
    totalOrders += ch.quantityOfOrders || 0;
    byChannel[channel] = { sales: net, orders: ch.quantityOfOrders || 0 };
  }
  return { totalSum, totalOrders, byChannel };
}

// Stockholm-timme (0–23) från unix-sekunder
function stockholmHourFromUnixSeconds(unixSec) {
  const d = new Date(unixSec * 1000);
  const h = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false,
  }).format(d);
  return parseInt(h, 10) % 24;
}

// Timme-försäljning: aggregatedReport[channel].saleStatsPerHour = { [hourUnix]: { total, totalNet } }
async function handleHourly({ companyId, token, shopId, startDate, endDate, includeVat = true }) {
  const data = await fetchOverviewRaw({ companyId, token, shopId, startDate, endDate });
  const report = data.aggregatedReport || {};

  // hour-of-day (0–23) -> { sales }
  const byHour = new Map();
  for (const ch of Object.values(report)) {
    const stats = ch && ch.saleStatsPerHour;
    if (!stats || typeof stats !== "object") continue;
    for (const [hourUnix, v] of Object.entries(stats)) {
      const amount = includeVat ? (v.total || 0) : (v.totalNet || 0);
      if (!amount) continue;
      const hour = stockholmHourFromUnixSeconds(parseInt(hourUnix, 10));
      byHour.set(hour, (byHour.get(hour) || 0) + amount);
    }
  }

  const hourly = [...byHour.entries()]
    .map(([hour, sales]) => ({ hour, sales, orders: 0 }))
    .sort((a, b) => a.hour - b.hour);

  return { hourly };
}

async function handleSales({ companyId, token, shops, daysAgo }) {
  const { startDate, endDate } = getDateRange(daysAgo);
  const sales = await Promise.all(shops.map(async shop => {
    try {
      const o = await fetchShopOverview({ companyId, token, shop, startDate, endDate });
      return { shopId: shop.id, restaurant: shop.name, sales: o.totalSum, orders: o.totalOrders, currency: "SEK" };
    } catch {
      return { shopId: shop.id, restaurant: shop.name, sales: 0, orders: 0, currency: "SEK" };
    }
  }));
  return { sales };
}

async function handleOverview({ companyId, token, shops, startDate, endDate }) {
  const overview = await Promise.all(shops.map(async shop => {
    try {
      const o = await fetchShopOverview({ companyId, token, shop, startDate, endDate });
      return {
        shopId: shop.id,
        shopName: shop.name,
        totalSales: o.totalSum,
        totalOrders: o.totalOrders,
        byChannel: o.byChannel,
      };
    } catch {
      return { shopId: shop.id, shopName: shop.name, totalSales: 0, totalOrders: 0, byChannel: {} };
    }
  }));
  return { overview };
}

const REPORTS_QUERY = `query getReports($shopId: String, $posId: String, $reportType: ReportType, $pageNumber: Int, $pageItems: Int) {
  numberOfReports(shopId: $shopId, posId: $posId, reportType: $reportType)
  getReports(shopId: $shopId, posId: $posId, reportType: $reportType, pageNumber: $pageNumber, pageItems: $pageItems) {
    ... on ZXReport {
      id
      reportNumber
      reportType
      createdAt
      startDate
      endDate
      shopId
      shopName
      posName
      totalSales
      totalNetSales
      grandTotalSales
      grandTotalNet
      sumSoldProducts
      sumReceipts
      tip
      categoryTotalSales { categoryName totalSales }
      paymentMethodAndAmounts { paymentMethod amount tip }
      vatRatesAndNetAmounts { vatRate amount refundedAmount }
      vatRateAmountWithRefunds { vatRate amount refundedAmount }
      refunds { receiptType count amount }
      discounts { receiptType count amount }
    }
  }
}`;

async function handleReports({ token, shops, reportType, pageNumber, pageItems, shopId }) {
  const targetShops = shopId
    ? shops.filter(s => s.id === shopId)
    : shops;

  const reports = await Promise.all(targetShops.map(async shop => {
    try {
      const data = await gql(
        REPORTS_QUERY,
        { shopId: shop.id, reportType, pageNumber, pageItems },
        token
      );
      return {
        shopId: shop.id,
        shopName: shop.name,
        totalCount: data.numberOfReports || 0,
        items: data.getReports || [],
      };
    } catch {
      return { shopId: shop.id, shopName: shop.name, totalCount: 0, items: [] };
    }
  }));
  return { reports };
}

function buildSieFile(payload) {
  const lines = [];
  lines.push((payload.header || "").replace(/\r?\n$/, ""));

  let verNum = 1;
  for (const v of payload.verifications || []) {
    const date = (v.date || "").replace(/-/g, "").slice(0, 8);
    const name = (v.name || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`#VER "A" "${verNum}" ${date} "${name}" ${date}`);
    lines.push("{");
    for (const t of v.sieTransactions || []) {
      const cc = t.costCenter ? `{"1" "${t.costCenter}"}` : "{}";
      const amt = Number(t.amount || 0).toFixed(2);
      lines.push(`\t#TRANS ${t.sieAccountNumber} ${cc} ${amt}`);
    }
    lines.push("}");
    verNum++;
  }
  return lines.join("\r\n") + "\r\n";
}

async function handleSie({ token, shopId, startDate, endDate, name, res }) {
  const payload = await fetchSiePayload({ token, shopId, startDate, endDate });
  if (!payload) {
    return res.status(500).json({ error: "createSIEFileByDate returnerade tomt" });
  }

  const text = buildSieFile(payload);
  const fileName = (name && /^[\w.\-]+$/.test(name))
    ? name
    : `rapport-${shopId}-${(startDate || "").slice(0, 10)}.se`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.status(200).send(text);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    const { token, companyId, shops } = await getSession();
    const action = req.query.action || "sales";

    if (action === "reports") {
      const reportType = (req.query.reportType || "X").toUpperCase();
      if (reportType !== "X" && reportType !== "Z") {
        return res.status(400).json({ error: "reportType måste vara X eller Z" });
      }
      const pageNumber = parseInt(req.query.page || "1", 10);
      const pageItems = parseInt(req.query.items || "10", 10);
      const shopId = req.query.shopId || null;
      const out = await handleReports({ token, shops, reportType, pageNumber, pageItems, shopId });
      res.setHeader("Cache-Control", reportType === "Z" ? "s-maxage=600" : "s-maxage=120");
      return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
    }

    if (action === "overview") {
      const start = req.query.start;
      const end = req.query.end;
      if (!start || !end) {
        return res.status(400).json({ error: "start och end (ISO) krävs" });
      }
      const out = await handleOverview({ companyId, token, shops, startDate: start, endDate: end });
      // Vercel edge cache + browser cache
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
    }

    if (action === "hourly") {
      const shopId = req.query.shopId;
      const start = req.query.start;
      const end = req.query.end;
      if (!shopId || !start || !end) {
        return res.status(400).json({ error: "shopId, start och end krävs" });
      }
      const includeVat = req.query.vat !== "false";
      const out = await handleHourly({ companyId, token, shopId, startDate: start, endDate: end, includeVat });
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
    }

    if (action === "sie") {
      const shopId = req.query.shopId;
      const start = req.query.start;
      const end = req.query.end;
      const name = req.query.name || null;
      if (!shopId || !start || !end) {
        return res.status(400).json({ error: "shopId, start och end krävs" });
      }
      return await handleSie({ token, shopId, startDate: start, endDate: end, name, res });
    }

    const daysAgo = req.query.date === "yesterday" ? 1 : 0;
    const out = await handleSales({ companyId, token, shops, daysAgo });
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
  } catch (err) {
    // Bust cache on auth errors so next request re-logins
    if (/token|auth|login/i.test(err.message)) bustSession();
    return res.status(500).json({ error: err.message });
  }
}
