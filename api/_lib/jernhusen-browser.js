// api/_lib/jernhusen-browser.js
//
// Jernhusens OMSA-portal (omsa.jernhusen.se) byggdes om hösten 2026 till Blazor Server:
// rapportformuläret är interaktivt över websocket (SignalR), fälten saknar name-attribut
// och id:n slumpas per rendering. Ett vanligt form-POST fungerar därför inte längre —
// vi kör en headless Chromium (puppeteer-core + @sparticuz/chromium) och fyller i
// formuläret som en människa.
//
// Flöde per verksamhet:
//   1. Logga in (/Account/Login, fälten Input.Email / Input.Password).
//   2. /Turnovers → välj Verksamhet → År → Månad.
//      Portalens Månad-lista visar BARA månader som saknar rapport. Finns inte
//      rapportmånaden i listan är den redan rapporterad → "already_reported".
//   3. Fyll "Preliminär omsättning exkl. moms" + "Antal kvitton", läs tillbaka värdena.
//   4. Klicka "Rapportera omsättning". Verifiera genom att ladda om sidan och kontrollera
//      att månaden försvunnit ur listan → "sent". Annars "error" med sidans felmeddelanden.
//
// dry: true → steg 1–3 körs (inkl. ifyllnad och tillbakaläsning) men inget skickas.
// Lokalt: sätt CHROME_PATH till en Chromium-binär för att slippa @sparticuz/chromium.

const BASE = process.env.JERNHUSEN_BASE_URL || "https://omsa.jernhusen.se"; // override endast för lokala tester
const SV_MONTHS = ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"];
const STEP_TIMEOUT = 20000;
const SETTLE_MS = 1200; // Blazor renderar om via websocket — ge den tid efter varje val

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.CHROME_PATH) {
    return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  }
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
    defaultViewport: { width: 1280, height: 900 },
  });
}

// Synlig feltext på sidan (valideringsfel, alerts, toasts).
async function pageMessages(page) {
  return page.evaluate(() => {
    const sel = ".validation-message, .validation-errors, .validation-summary-errors, .alert, .toast, .text-danger, .invalid-feedback, [role=alert]";
    const t = [...document.querySelectorAll(sel)].map((e) => e.innerText.replace(/\s+/g, " ").trim()).filter(Boolean);
    return [...new Set(t)].join(" | ").slice(0, 500);
  });
}

const options = (page, id) => page.$$eval(`#${id} option`, (os) => os.map((o) => ({ value: o.value, text: o.textContent.trim(), selected: o.selected })));

// Välj ett värde i en Blazor-select och vänta på omrendering.
async function choose(page, id, value) {
  const current = await page.$eval(`#${id}`, (s) => s.value);
  if (current !== value) {
    await page.select(`#${id}`, value);
    await sleep(SETTLE_MS);
  }
  const after = await page.$eval(`#${id}`, (s) => s.value);
  if (after !== value) throw new Error(`kunde inte välja ${id}=${value} (står på ${after})`);
}

async function login(page, user, pass) {
  await page.goto(`${BASE}/Account/Login`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
  await page.waitForSelector('input[name="Input.Email"]', { timeout: STEP_TIMEOUT });
  await page.type('input[name="Input.Email"]', user);
  await page.type('input[name="Input.Password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: STEP_TIMEOUT }).catch(() => null),
    page.click('form:has(input[name="Input.Email"]) button[type=submit]'),
  ]);
  if (/\/Account\/Login/i.test(page.url())) {
    const msg = await pageMessages(page);
    throw new Error(`inloggning misslyckades${msg ? ": " + msg : " (kontrollera JERNHUSEN_USER/JERNHUSEN_PASS)"}`);
  }
}

// Öppna /Turnovers och vänta tills formuläret är interaktivt.
async function openTurnovers(page) {
  await page.goto(`${BASE}/Turnovers`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
  if (/\/Account\/Login/i.test(page.url())) throw new Error("utloggad vid öppning av /Turnovers");
  await page.waitForSelector("#Business option", { timeout: STEP_TIMEOUT });
  // Interaktiva element får _bl_-attribut när Blazor-kretsen är uppe.
  await page.waitForFunction(() => [...document.querySelectorAll("button, input")].some((e) => [...e.attributes].some((a) => a.name.startsWith("_bl_"))), { timeout: STEP_TIMEOUT });
  await sleep(SETTLE_MS);
}

// Text i rutan "Omsättning saknas" (för diagnostik).
const missingOverview = (page) => page.evaluate(() => {
  const t = document.body.innerText;
  const i = t.indexOf("Omsättning saknas");
  const j = t.indexOf("Verksamhet", i);
  return i >= 0 ? t.slice(i + 17, j > i ? j : i + 400).replace(/\s+/g, " ").trim() : null;
});

// Välj verksamhet + år och returnera om månaden finns kvar att rapportera.
async function selectPeriod(page, b, Year, monthName) {
  const biz = await options(page, "Business");
  if (!biz.some((o) => o.value === b.businessId)) throw new Error(`verksamheten ${b.businessId} finns inte i portalen`);
  await choose(page, "Business", b.businessId);
  const years = await options(page, "Year");
  if (!years.some((o) => o.value === String(Year))) return false;
  await choose(page, "Year", String(Year));
  const months = await options(page, "Month");
  if (!months.some((o) => o.value === monthName)) return false;
  await choose(page, "Month", monthName);
  return true;
}

// Hitta number-inputen under en label med viss text och returnera dess id.
const inputIdByLabel = (page, label) => page.evaluate((label) => {
  const l = [...document.querySelectorAll("form label")].find((x) => x.textContent.trim().startsWith(label));
  const inp = l && l.parentElement.querySelector("input[type=number]");
  return inp ? inp.id : null;
}, label);

async function fillNumber(page, label, value) {
  const id = await inputIdByLabel(page, label);
  if (!id) throw new Error(`hittar inte fältet "${label}"`);
  const sel = `[id="${id}"]`;
  await page.click(sel, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(sel, String(value));
  await page.keyboard.press("Tab"); // blur → change → Blazor-binding
  await sleep(600);
  // Läs tillbaka via etiketten — Blazor kan ha renderat om elementet.
  const got = await page.evaluate((label) => {
    const l = [...document.querySelectorAll("form label")].find((x) => x.textContent.trim().startsWith(label));
    const inp = l && l.parentElement.querySelector("input[type=number]");
    return inp ? inp.value : null;
  }, label);
  if (Number(got) !== Number(value)) throw new Error(`fältet "${label}" visar ${got}, väntat ${value}`);
}

export async function jernhusenBrowserReport({ month, businesses, user, pass, dry = false }) {
  if (!user || !pass) return { error: "JERNHUSEN_USER / JERNHUSEN_PASS saknas i miljövariabler" };
  const [Year, Month] = month.split("-").map(Number);
  const monthName = SV_MONTHS[Month - 1];

  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    await login(page, user, pass);
    await openTurnovers(page);
    const missingBefore = await missingOverview(page);

    const results = [];
    for (const b of businesses) {
      const base = { name: b.name, exVat: b.exVat, receipts: b.receipts };
      try {
        const open = await selectPeriod(page, b, Year, monthName);
        if (!open) {
          results.push({ ...base, status: "already_reported", reason: `${monthName} ${Year} finns inte bland månader som saknar rapport` });
          continue;
        }
        await fillNumber(page, "Preliminär omsättning", b.exVat);
        await fillNumber(page, "Antal kvitton", b.receipts);

        if (dry) {
          results.push({ ...base, status: "dry", reason: "ifyllt och verifierat, inte skickat" });
          await openTurnovers(page); // nollställ formuläret inför nästa verksamhet
          continue;
        }

        await page.evaluate(() => {
          const btn = [...document.querySelectorAll("form button[type=submit]")].find((x) => /Rapportera omsättning/i.test(x.textContent));
          if (!btn) throw new Error("hittar inte knappen Rapportera omsättning");
          btn.click();
        });
        await sleep(3000);
        const msgAfterSubmit = await pageMessages(page);

        // Verifiera: ladda om och kontrollera att månaden inte längre saknas.
        await openTurnovers(page);
        const stillOpen = await selectPeriod(page, b, Year, monthName);
        if (stillOpen) {
          results.push({ ...base, status: "error", reason: msgAfterSubmit || "månaden saknas fortfarande efter inskick (okänt fel)" });
        } else {
          results.push({ ...base, status: "sent", ...(msgAfterSubmit ? { message: msgAfterSubmit } : {}) });
        }
      } catch (err) {
        results.push({ ...base, status: "error", reason: String((err && err.message) || err) });
        await openTurnovers(page).catch(() => {});
      }
    }
    return { results, missingBefore };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
