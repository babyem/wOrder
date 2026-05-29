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

// ---------- Module-scope cache (per warm container) ----------
// Login + shops are stable across requests; cache while serverless container stays warm
let SESSION_CACHE = null; // { token, companyId, shops, expiresAt }
// qReportToken per shop (or shared) cache
const QR_TOKEN_CACHE = new Map(); // key=shopId -> { token, expiresAt }

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 min safe under Qopla's ttlTimeoutMs

async function loginRaw(email, password) {
  const data = await gql(
    `mutation login($credentials: CredentialsInput) {
      login(userCredentials: $credentials) { token companyId }
      ttlTimeoutMs
    }`,
    { credentials: { username: email, password } }
  );
  return { ...data.login, ttlTimeoutMs: data.ttlTimeoutMs };
}

async function getShopsRaw(companyId, token) {
  const data = await gql(
    `query getCompanyShops($companyId: String!) {
      getCompanyShops(companyId: $companyId) { id name }
    }`,
    { companyId }, token
  );
  return data.getCompanyShops;
}

async function getSession() {
  const now = Date.now();
  if (SESSION_CACHE && SESSION_CACHE.expiresAt > now) {
    return SESSION_CACHE;
  }
  const email = process.env.QOPLA_EMAIL;
  const password = process.env.QOPLA_PASSWORD;
  if (!email || !password) {
    throw new Error("QOPLA_EMAIL / QOPLA_PASSWORD saknas i miljövariabler");
  }
  const login = await loginRaw(email, password);
  const shops = await getShopsRaw(login.companyId, login.token);
  const ttl = Math.min(login.ttlTimeoutMs || SESSION_TTL_MS, SESSION_TTL_MS);
  SESSION_CACHE = {
    token: login.token,
    companyId: login.companyId,
    shops,
    expiresAt: now + ttl - 30_000, // 30s safety margin
  };
  return SESSION_CACHE;
}

async function getQReportToken(companyId, shopId, token) {
  const now = Date.now();
  const cached = QR_TOKEN_CACHE.get(shopId);
  if (cached && cached.expiresAt > now) return cached.token;
  const data = await gql(
    `query qReportToken($companyId: String, $shopIds: [String]) {
      getQReportToken(companyId: $companyId, shopIds: $shopIds)
    }`,
    { companyId, shopIds: [shopId] }, token
  );
  const qToken = data.getQReportToken;
  QR_TOKEN_CACHE.set(shopId, { token: qToken, expiresAt: now + SESSION_TTL_MS - 30_000 });
  return qToken;
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

// SIE-nedladdning — GraphQL mutation createSIEFileByDate
const SIE_MUTATION = `mutation createSIEFileByDate($shopId: String, $startDate: String, $endDate: String) {
  createSIEFileByDate(shopId: $shopId, startDate: $startDate, endDate: $endDate) {
    header
    referenceReportId
    verifications {
      date
      name
      sieTransactions {
        sieAccountNumber
        amount
        costCenter
      }
    }
  }
}`;

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
  const data = await gql(SIE_MUTATION, { shopId, startDate, endDate }, token);
  const payload = data.createSIEFileByDate;
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
    if (/token|auth|login/i.test(err.message)) SESSION_CACHE = null;
    return res.status(500).json({ error: err.message });
  }
}
