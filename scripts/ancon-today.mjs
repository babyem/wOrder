// scripts/ancon-today.mjs — run by GitHub Actions. ancon exposes TODAY's intraday
// sales only through the Försäljningsöversikt report (Report/10), whose data request
// is built by the page's JS and can't be replicated cleanly server-side. So we load
// it in a real browser, let it render today's running total, scrape the "Total" row's
// "inkl. moms" amount, and POST it to wOrder /api/ancon-sales for the widget/reports.
//
// Env: ANCON_EMAIL, ANCON_PASSWORD, WORDER_URL, CRON_SECRET, optional ANCON_TENANT.

import { chromium } from "playwright";

const { ANCON_EMAIL, ANCON_PASSWORD, WORDER_URL, CRON_SECRET } = process.env;
const TENANT = process.env.ANCON_TENANT || "IgE";
const BASE = "https://login2.ancon.se";

function stockholmDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
// "4 612,80 SEK" -> 4612.80  (space thousands sep, comma decimal)
function parseSek(s) {
  return Number(String(s).replace(/[^\d,]/g, "").replace(",", ".")) || 0;
}

async function main() {
  for (const [k, v] of Object.entries({ ANCON_EMAIL, ANCON_PASSWORD, WORDER_URL, CRON_SECRET })) {
    if (!v) throw new Error(`Missing env: ${k}`);
  }
  const date = stockholmDate();
  console.log(`ancon today scrape ${date} (tenant ${TENANT})`);

  const browser = await chromium.launch();
  let scraped = { sales: 0, orders: 0 };
  try {
    const page = await browser.newContext().then(c => c.newPage());

    // 1. Form login (ASP.NET Identity).
    await page.goto(`${BASE}/Account/Login`, { waitUntil: "networkidle" });
    await page.fill("#Email, input[name=Email], input[type=email]", ANCON_EMAIL);
    await page.fill("#Password, input[name=Password], input[type=password]", ANCON_PASSWORD);
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.click("button[type=submit], input[type=submit]"),
    ]);

    // 2. Open Försäljningsöversikt — it auto-runs today's report on load.
    await page.goto(`${BASE}/${TENANT}/Reporting/Report/10`, { waitUntil: "networkidle" });

    // 3. Wait for the rendered report (Total row with an inkl-moms amount).
    try {
      await page.waitForFunction(() => {
        const txt = document.body.innerText || "";
        return /Total/.test(txt) && /SEK\s*\/\s*[\d\s.,]+SEK/.test(txt);
      }, null, { timeout: 30000 });
    } catch {
      console.log("report did not render a total within 30s (no sales yet?)");
    }

    scraped = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("tr")];
      // The grand-total row: cells include a "Total" label and a "x SEK / y SEK" summa.
      const totalRow = rows.find(r => /(^|\s)Total(\s|$)/.test(r.innerText) && /SEK\s*\/\s*[\d\s.,]+SEK/.test(r.innerText));
      if (!totalRow) return { sales: 0, orders: 0 };
      const cells = [...totalRow.querySelectorAll("td, th")].map(c => (c.innerText || "").trim());
      const sumCell = cells.find(c => /SEK\s*\/\s*[\d\s.,]+SEK/.test(c)) || "";
      const inkl = (sumCell.split("/")[1] || "").trim(); // inkl. moms is the second amount
      const intCell = cells.find(c => /^\d{1,6}$/.test(c)) || "0"; // Antal av kvitton
      return { salesRaw: inkl, ordersRaw: intCell };
    });
  } finally {
    await browser.close();
  }

  const sales = parseSek(scraped.salesRaw);
  const orders = Number(String(scraped.ordersRaw || "").replace(/\D/g, "")) || 0;
  console.log(`scraped: ${sales} kr inkl moms, ${orders} kvitton`);
  if (sales <= 0) { console.log("no sales to post — done"); return; }

  const res = await fetch(`${WORDER_URL.replace(/\/$/, "")}/api/ancon-sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CRON_SECRET}` },
    body: JSON.stringify({ date, sales, orders }),
  });
  const out = await res.json().catch(() => ({}));
  console.log("ancon-sales result:", JSON.stringify(out));
  if (!res.ok) throw new Error(`ancon-sales failed: ${res.status}`);
}

main().catch(e => { console.error(e); process.exit(1); });
