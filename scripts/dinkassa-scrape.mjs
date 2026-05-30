// scripts/dinkassa-scrape.mjs — run by GitHub Actions (a host that can run a real
// browser, which dinkassa's login requires). Logs into dinkassa via the form, pulls
// each kassa's Z-report for the target day, and POSTs them to wOrder /api/dinkassa-book
// which books them to Fortnox.
//
// Env: DINKASSA_USERNAME, DINKASSA_PASSWORD, WORDER_URL, CRON_SECRET,
//      optional DINKASSA_INTEGRATOR_ID, DAY ("yesterday" | "today", default yesterday).

import { chromium } from "playwright";

const {
  DINKASSA_USERNAME, DINKASSA_PASSWORD, WORDER_URL, CRON_SECRET,
} = process.env;
const INTEGRATOR_ID = process.env.DINKASSA_INTEGRATOR_ID || "cc7c4035-ce21-40a6-95e2-a39a641a1c27";
const DAY = process.env.DAY || "yesterday";
const FROM = (process.env.FROM_DATE || process.env.DATE || "").trim(); // YYYY-MM-DD, overrides DAY
const TO = (process.env.TO_DATE || "").trim(); // optional range end; defaults to FROM

function stockholmDate(daysAgo) {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!daysAgo) return s;
  const [y, m, d] = s.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d - daysAgo));
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(base);
}

async function main() {
  for (const [k, v] of Object.entries({ DINKASSA_USERNAME, DINKASSA_PASSWORD, WORDER_URL, CRON_SECRET })) {
    if (!v) throw new Error(`Missing env: ${k}`);
  }
  const from = /^\d{4}-\d{2}-\d{2}$/.test(FROM) ? FROM : stockholmDate(DAY === "today" ? 0 : 1);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(TO) ? TO : from;
  console.log(`dinkassa scrape ${from} .. ${to}`);

  const browser = await chromium.launch();
  let machines;
  try {
    const page = await browser.newContext().then(c => c.newPage());
    await page.goto("https://dinkassa.se/v2/login", { waitUntil: "networkidle" });

    // Fill the login form (the only path dinkassa accepts). Field is input[name=username]
    // — NOT the first text input (that's the language selector).
    await page.locator("input[name=username]").waitFor({ timeout: 30000 });
    await page.locator("input[name=username]").fill(DINKASSA_USERNAME);
    await page.locator("input[name=password]").fill(DINKASSA_PASSWORD);
    await page.getByRole("button", { name: /logga in/i }).click();

    // Session lands in localStorage on success.
    await page.waitForFunction(() => !!localStorage.getItem("sessionId"), null, { timeout: 30000 });

    // Pull machines + Z-reports from the authenticated page context.
    machines = await page.evaluate(async ({ integrator, from, to }) => {
      const sid = localStorage.getItem("sessionId");
      const H = { Accept: "application/json", SessionId: sid, IntegratorId: integrator };
      const mjson = await (await fetch("https://dinkassa.se/api/machine", { headers: H })).json();
      const list = (mjson.Items || []).map(m => ({ id: m.Id, name: m.Name }));
      for (const m of list) {
        const url = `https://dinkassa.se/api/reports/download-z-report-by-date/json?machineId=${encodeURIComponent(m.id)}&startDate=${from}&endDate=${to}`;
        const j = await (await fetch(url, { headers: H })).json();
        m.zReports = j.ZReports || [];
      }
      return list;
    }, { integrator: INTEGRATOR_ID, from, to });
  } finally {
    await browser.close();
  }

  console.log(`Fetched ${machines.length} kassor, ${machines.reduce((n, m) => n + (m.zReports?.length || 0), 0)} Z-reports`);

  const res = await fetch(`${WORDER_URL.replace(/\/$/, "")}/api/dinkassa-book`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CRON_SECRET}` },
    body: JSON.stringify({ from, to, machines }),
  });
  const out = await res.json().catch(() => ({}));
  console.log("Book result:", JSON.stringify(out, null, 2));
  if (!res.ok) throw new Error(`dinkassa-book failed: ${res.status}`);
}

main().catch(e => { console.error(e); process.exit(1); });
