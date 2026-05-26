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
  // Shift back by daysAgo
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

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const daysAgo = req.query.date === "yesterday" ? 1 : 0;
  const email = process.env.QOPLA_EMAIL;
  const password = process.env.QOPLA_PASSWORD;
  if (!email || !password) {
    return res.status(500).json({ error: "QOPLA_EMAIL / QOPLA_PASSWORD saknas i miljövariabler" });
  }

  try {
    // 1. Login
    const loginData = await gql(
      `mutation login($credentials: CredentialsInput) {
        login(userCredentials: $credentials) { token companyId }
        ttlTimeoutMs
      }`,
      { credentials: { username: email, password } }
    );
    const { token, companyId } = loginData.login;

    // 2. Alla restauranger
    const shopsData = await gql(
      `query getCompanyShops($companyId: String!) {
        getCompanyShops(companyId: $companyId) { id name }
      }`,
      { companyId }, token
    );
    const shops = shopsData.getCompanyShops;
    const { startDate, endDate } = getDateRange(daysAgo);

    // 3. Försäljning per restaurang (sekventiellt — token är engångs per anrop)
    const sales = [];
    for (const shop of shops) {
      const qrtData = await gql(
        `query qReportToken($companyId: String, $shopIds: [String]) {
          getQReportToken(companyId: $companyId, shopIds: $shopIds)
        }`,
        { companyId, shopIds: [shop.id] }, token
      );
      const qReportToken = qrtData.getQReportToken;

      const r = await fetch(`${QREPORT_URL}/overview`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=utf-8", Authorization: qReportToken },
        body: JSON.stringify({ shopIDs: [shop.id], startDate, endDate }),
      });
      const text = await r.text();
      const data = text ? JSON.parse(text) : { aggregatedReport: {} };
      const report = data.aggregatedReport || {};
      let totalSum = 0, totalOrders = 0;
      for (const ch of Object.values(report)) {
        totalSum += ch.totalSum || 0;
        totalOrders += ch.quantityOfOrders || 0;
      }
      sales.push({ shopId: shop.id, restaurant: shop.name, sales: totalSum, orders: totalOrders, currency: "SEK" });
    }

    res.setHeader("Cache-Control", "s-maxage=300"); // Cache 5 min på Vercel edge
    return res.status(200).json({ sales, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
