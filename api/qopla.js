// api/qopla.js — Vercel serverless function
// Lägg denna fil i roten av wOrder-repot under api/qopla.js
// Sätt QOPLA_EMAIL och QOPLA_PASSWORD i Vercel Dashboard → Settings → Environment Variables

const GRAPHQL_URL = "https://api.qopla.com/graphql";
const QREPORT_URL = "https://qreport.qopla.com";

async function gql(query, variables, token) {
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

function getDateRange(daysAgo = 0) {
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

async function login(email, password) {
  const data = await gql(
    `mutation login($credentials: CredentialsInput) {
      login(userCredentials: $credentials) { token companyId }
      ttlTimeoutMs
    }`,
    { credentials: { username: email, password } }
  );
  return data.login;
}

async function getShops(companyId, token) {
  const data = await gql(
    `query getCompanyShops($companyId: String!) {
      getCompanyShops(companyId: $companyId) { id name }
    }`,
    { companyId }, token
  );
  return data.getCompanyShops;
}

async function getQReportToken(companyId, shopId, token) {
  const data = await gql(
    `query qReportToken($companyId: String, $shopIds: [String]) {
      getQReportToken(companyId: $companyId, shopIds: $shopIds)
    }`,
    { companyId, shopIds: [shopId] }, token
  );
  return data.getQReportToken;
}

async function fetchShopOverview({ companyId, token, shop, startDate, endDate }) {
  const qReportToken = await getQReportToken(companyId, shop.id, token);
  const r = await fetch(`${QREPORT_URL}/overview`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=utf-8", Authorization: qReportToken },
    body: JSON.stringify({ shopIDs: [shop.id], startDate, endDate }),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : { aggregatedReport: {} };
  const report = data.aggregatedReport || {};
  let totalSum = 0, totalOrders = 0;
  const byChannel = {};
  for (const [channel, ch] of Object.entries(report)) {
    totalSum += ch.totalSum || 0;
    totalOrders += ch.quantityOfOrders || 0;
    byChannel[channel] = { sales: ch.totalSum || 0, orders: ch.quantityOfOrders || 0 };
  }
  return { totalSum, totalOrders, byChannel };
}

async function handleSales({ companyId, token, daysAgo }) {
  const shops = await getShops(companyId, token);
  const { startDate, endDate } = getDateRange(daysAgo);

  const sales = [];
  for (const shop of shops) {
    const o = await fetchShopOverview({ companyId, token, shop, startDate, endDate });
    sales.push({ shopId: shop.id, restaurant: shop.name, sales: o.totalSum, orders: o.totalOrders, currency: "SEK" });
  }
  return { sales };
}

async function handleOverview({ companyId, token, startDate, endDate }) {
  const shops = await getShops(companyId, token);
  const perShop = [];
  for (const shop of shops) {
    try {
      const o = await fetchShopOverview({ companyId, token, shop, startDate, endDate });
      perShop.push({
        shopId: shop.id,
        shopName: shop.name,
        totalSales: o.totalSum,
        totalOrders: o.totalOrders,
        byChannel: o.byChannel,
      });
    } catch {
      perShop.push({ shopId: shop.id, shopName: shop.name, totalSales: 0, totalOrders: 0, byChannel: {} });
    }
  }
  return { overview: perShop };
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

async function handleReports({ companyId, token, reportType, pageNumber, pageItems, shopId }) {
  const shops = shopId
    ? [(await getShops(companyId, token)).find(s => s.id === shopId)].filter(Boolean)
    : await getShops(companyId, token);

  const perShop = [];
  for (const shop of shops) {
    const data = await gql(
      REPORTS_QUERY,
      { shopId: shop.id, reportType, pageNumber, pageItems },
      token
    );
    perShop.push({
      shopId: shop.id,
      shopName: shop.name,
      totalCount: data.numberOfReports || 0,
      items: data.getReports || [],
    });
  }
  return { reports: perShop };
}

// SIE-nedladdning — gissade endpoints, behöver verifieras mot Qopla
async function handleSie({ companyId, token, reportId, shopId, startDate, endDate, res }) {
  const qReportToken = await getQReportToken(companyId, shopId, token);

  // GET-candidates (URL only)
  const getCandidates = reportId
    ? [
        `${QREPORT_URL}/sie/${reportId}`,
        `${QREPORT_URL}/sie?reportId=${reportId}`,
        `${QREPORT_URL}/download/sie/${reportId}`,
        `${QREPORT_URL}/report/${reportId}/sie`,
      ]
    : [
        `${QREPORT_URL}/sie?shopId=${shopId}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
        `${QREPORT_URL}/sie/${shopId}?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      ];

  // POST-candidates (URL + body)
  const postBody = JSON.stringify({ shopIDs: [shopId], startDate, endDate, reportId });
  const postCandidates = [
    `${QREPORT_URL}/sie`,
    `${QREPORT_URL}/download/sie`,
    `${QREPORT_URL}/sie/export`,
  ];

  const tried = [];
  let lastStatus = 0;

  const send = (r, fallbackName) => {
    const ct = r.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `attachment; filename="${fallbackName}"`);
  };

  for (const url of getCandidates) {
    tried.push(`GET ${url}`);
    const r = await fetch(url, {
      headers: { Authorization: qReportToken, Accept: "application/octet-stream, */*" },
    });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const name = reportId ? `zrapport-${reportId}.se` : `rapport-${shopId}-${startDate?.slice(0,10)}.se`;
      send(r, name);
      return res.status(200).send(buf);
    }
    lastStatus = r.status;
  }

  for (const url of postCandidates) {
    tried.push(`POST ${url}`);
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: qReportToken,
        "Content-Type": "application/json;charset=utf-8",
        Accept: "application/octet-stream, */*",
      },
      body: postBody,
    });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const name = reportId ? `zrapport-${reportId}.se` : `rapport-${shopId}-${startDate?.slice(0,10)}.se`;
      send(r, name);
      return res.status(200).send(buf);
    }
    lastStatus = r.status;
  }

  return res.status(404).json({
    error: "SIE-endpoint hittades ej",
    hint: "Capturer SIE-download-request från Qopla DevTools och uppdatera handleSie() med rätt URL",
    lastStatus,
    tried,
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const email = process.env.QOPLA_EMAIL;
  const password = process.env.QOPLA_PASSWORD;
  if (!email || !password) {
    return res.status(500).json({ error: "QOPLA_EMAIL / QOPLA_PASSWORD saknas i miljövariabler" });
  }

  try {
    const { token, companyId } = await login(email, password);
    const action = req.query.action || "sales";

    if (action === "reports") {
      const reportType = (req.query.reportType || "X").toUpperCase();
      if (reportType !== "X" && reportType !== "Z") {
        return res.status(400).json({ error: "reportType måste vara X eller Z" });
      }
      const pageNumber = parseInt(req.query.page || "1", 10);
      const pageItems = parseInt(req.query.items || "10", 10);
      const shopId = req.query.shopId || null;
      const out = await handleReports({ companyId, token, reportType, pageNumber, pageItems, shopId });
      res.setHeader("Cache-Control", reportType === "Z" ? "s-maxage=600" : "s-maxage=120");
      return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
    }

    if (action === "overview") {
      const start = req.query.start;
      const end = req.query.end;
      if (!start || !end) {
        return res.status(400).json({ error: "start och end (ISO) krävs" });
      }
      const out = await handleOverview({ companyId, token, startDate: start, endDate: end });
      res.setHeader("Cache-Control", "s-maxage=300");
      return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
    }

    if (action === "sie") {
      const reportId = req.query.reportId || null;
      const shopId = req.query.shopId;
      const start = req.query.start || null;
      const end = req.query.end || null;
      if (!shopId) {
        return res.status(400).json({ error: "shopId krävs" });
      }
      if (!reportId && !(start && end)) {
        return res.status(400).json({ error: "reportId ELLER start+end krävs" });
      }
      return await handleSie({ companyId, token, reportId, shopId, startDate: start, endDate: end, res });
    }

    // default: sales overview (idag/igår)
    const daysAgo = req.query.date === "yesterday" ? 1 : 0;
    const out = await handleSales({ companyId, token, daysAgo });
    res.setHeader("Cache-Control", "s-maxage=300");
    return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
