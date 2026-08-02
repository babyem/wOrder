// api/monthly-report.js — Vercel serverless function
//
// Föregående månads (eller ?month=YYYY-MM) omsättning per butik, sammanslaget från
// Qopla-overview + Supabase-tabellen pos_daily_sales (samma logik som admin-rapporten).
//
// Skyddad med REPORT_API_TOKEN (?token=… eller Authorization: Bearer <token>).
//
// Lägen:
//   GET /api/monthly-report?token=XXX                    → JSON, föregående månad
//   GET /api/monthly-report?token=XXX&month=2026-05      → JSON, specifik månad
//   GET /api/monthly-report?token=XXX&action=send&dry=1  → visa vilka mejl som SKULLE skickas
//   GET /api/monthly-report?token=XXX&action=send        → skicka rapport-mejl via Resend
//
// För action=send krävs RESEND_API_KEY i miljövariabler (samma nyckel som send-email).

import { gql, getSession, fetchOverviewRaw, dayRangeISO } from "./_lib/qopla.js";
import { sbSelect } from "./_lib/supabaseAdmin.js";

// Pos-butiker (dinkassa) lagrar bara brutto (inkl moms). För netto exkl moms delar
// vi med momssatsen. Chao är 100% takeaway (6%), så netto = brutto / 1,06.
// (Fortnox-bokföringen kan inte användas — den dubbelbeskattar Chao.)
const POS_NET_VAT_DIVISOR = {
  "dinkassa-chao": 1.06, // Chao Oriental Express — takeaway 6%
};

// Jernhusen: inloggning via webbformuläret + POST /turnover/Create per verksamhet.
// Inga API-nycklar behövs. Login med JERNHUSEN_USER / JERNHUSEN_PASS (Vercel env).
// Rapporterar EXKL moms (salesNet) + antal kvitton (orders).
const JERNHUSEN_BASE = "https://omsa.jernhusen.se";

// Emporia (Mallcomm/Let's Join): login → byt profil → hämta plugin-token → POSTa Month_Total.
// Rapporterar INKL moms (salesGross) i fältet "Month_Total". Login med LETSJOIN_USER / LETSJOIN_PASS.
const LETSJOIN_BASE = "https://letsjoinshopping.com";
const MALLCOMM_BASE = "https://plugins.mallcomm.co.uk";
const EMPORIA_SHOPS = [
  { shopId: "ancon:IgE", localName: "WOSO Salad & Sushi" },
  { shopId: "65e5e4fc3bc80a13e1e798ba", localName: "Izakai" },
];
const SV_MONTHS = ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"];
const JERNHUSEN_BUSINESSES = [
  { shopId: "67bc9ec96c7e0c3b0a59968f", businessId: "c0f63bb3-eda4-44c0-8e3d-bd62d70edf4e", name: "Woso Centralstationen" },
  { shopId: "dinkassa-chao", businessId: "4b7719f3-53a5-4882-b024-105953e8d2f1", name: "Chao Oriental Express" },
];

// Qopla skapar en Z-rapport (dagsavslut) per dag automatiskt. Den räknar moms per
// kvitto, vilket är exakt det köpcentrumen vill ha. Vi summerar månadens dagliga
// Z-rapporter och faller tillbaka på overview-aggregatet om inga Z-rapporter hittas.
const REPORTS_QUERY = `query getReports($shopId: String, $reportType: ReportType, $pageNumber: Int, $pageItems: Int) {
  getReports(shopId: $shopId, reportType: $reportType, pageNumber: $pageNumber, pageItems: $pageItems) {
    ... on ZXReport {
      reportNumber
      startDate
      endDate
      totalSales
      totalNetSales
      sumReceipts
      vatRatesAndNetAmounts { vatRate amount refundedAmount }
      refunds { amount }
    }
  }
}`;

// Summera målmånadens dagliga Z-rapporter (slutdatum i månaden).
// Netto/brutto redovisas efter återköp — samma som köpcentrumets siffra.
//
// OBS: Qopla skapar normalt en Z-rapport per dag, men om en dag inte slås ut
// separat (t.ex. midsommardagen då butiken var stängd) bakas den ihop med nästa
// dag till EN Z-rapport som spänner över flera dygn. En sådan sammanslagen
// dagsrapport ska räknas med. Tidigare uteslöts allt med spann ≥ 2 dygn, vilket
// felaktigt tappade dessa merges (och därmed en dags omsättning). Istället för
// en spann-gräns skyddar vi mot dubbelräkning av period-/månadssammanställningar
// genom att hoppa över rapporter som ÖVERLAPPAR redan täckt tid.
function sumDailyReports(items, year, month) {
  const target = `${year}-${String(month).padStart(2, "0")}`;
  const inMonth = (items || [])
    .filter((it) => it && it.startDate && it.endDate && String(it.endDate).slice(0, 7) === target)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || new Date(a.endDate) - new Date(b.endDate));
  if (inMonth.length === 0) return null;
  let net = 0, gross = 0, orders = 0, refundNet = 0, refundGross = 0, days = 0;
  let coveredUntil = 0; // ms — senast täckta tidpunkt
  for (const it of inMonth) {
    const start = new Date(it.startDate).getTime();
    const end = new Date(it.endDate).getTime();
    // Hoppa över rapporter som överlappar redan täckt tid (t.ex. en period-
    // eller månadssammanställning ovanpå dagsrapporterna) → undvik dubbelräkning.
    if (start < coveredUntil) continue;
    const spanDays = (end - start) / 86400000;
    net += it.totalNetSales || 0;
    gross += it.totalSales || 0;
    orders += it.sumReceipts || 0;
    refundNet += (it.vatRatesAndNetAmounts || []).reduce((a, v) => a + (v.refundedAmount || 0), 0);
    refundGross += it.refunds?.amount || 0;
    // En sammanslagen dagsrapport täcker flera kalenderdagar — räkna dem så att
    // zDays motsvarar antal dagar med försäljning (en vanlig dagsrapport = 1).
    days += Math.max(1, Math.round(spanDays));
    coveredUntil = end;
  }
  return { net: net + refundNet, gross: gross - refundGross, orders, days };
}

const MONTHS_SV = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

// E-postdestinationer per köpcentrum. shops = shopId som ska ingå.
// separate=true → ett mejl per butik; annars ett mejl med alla butikerna.
const EMAIL_DESTINATIONS = [
  {
    center: "Triangeln",
    to: "omsattning.malmo@vasakronan.se",
    from: "rapport@woso.se",
    separate: true,
    shops: [
      "61cc937c0746cf344f514c64", // LETS GRAB
      "6862a617a667dd4ac3c5885d", // Woso Triangeln
    ],
    // Visningsnamn i mejlet (override av Qopla:s namn)
    names: {
      "61cc937c0746cf344f514c64": "Lets Grab",
    },
  },
];

// ---------- Datum ----------
function stockholmYearMonth() {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [year, month] = s.split("-").map(Number);
  return { year, month };
}

function monthBounds(year, month) {
  const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { firstDay, lastDay };
}

function previousMonth() {
  const { year, month } = stockholmYearMonth();
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// ---------- Datakällor ----------
// Overview-aggregat (fallback): brutto = totalSum, netto = summa av timme-netto.
async function qoplaOverviewShop({ companyId, token, shop, startISO, endISO }) {
  const data = await fetchOverviewRaw({
    companyId, token, shopId: shop.id, startDate: startISO, endDate: endISO,
  });
  const report = data.aggregatedReport || {};
  let gross = 0, orders = 0, net = 0;
  for (const ch of Object.values(report)) {
    gross += ch.totalSum || 0;
    orders += ch.quantityOfOrders || 0;
    const stats = ch && ch.saleStatsPerHour;
    if (stats && typeof stats === "object") {
      for (const v of Object.values(stats)) net += v.totalNet || 0;
    }
  }
  return { shopId: shop.id, shopName: shop.name, salesGross: gross, salesNet: net, orders, source: "qopla", basis: "overview" };
}

async function qoplaShopSales({ year, month, startISO, endISO }) {
  const { companyId, token, shops } = await getSession();
  return Promise.all(
    shops.map(async (shop) => {
      // 1) Summera månadens dagliga Z-rapporter (exakt, moms per kvitto, efter återköp).
      try {
        const data = await gql(
          REPORTS_QUERY,
          { shopId: shop.id, reportType: "Z", pageNumber: 1, pageItems: 150 },
          token
        );
        const z = sumDailyReports(data.getReports, year, month);
        if (z) {
          return {
            shopId: shop.id, shopName: shop.name,
            salesGross: z.gross, salesNet: z.net,
            orders: z.orders,
            source: "qopla", basis: "zreport", zDays: z.days,
          };
        }
      } catch {
        // faller igenom till overview
      }
      // 2) Fallback: overview-aggregat.
      try {
        return await qoplaOverviewShop({ companyId, token, shop, startISO, endISO });
      } catch {
        return { shopId: shop.id, shopName: shop.name, salesGross: 0, salesNet: 0, orders: 0, source: "qopla", basis: "error" };
      }
    })
  );
}

// Synk-butiker (ancon/dinkassa) ligger i pos_daily_sales, inte i Qopla-overview.
async function posShopSales({ firstDay, lastDay }) {
  const query =
    `select=qopla_shop_id,shop_name,source,sales,orders,business_date` +
    `&business_date=gte.${firstDay}&business_date=lte.${lastDay}`;
  let data;
  try {
    data = await sbSelect("pos_daily_sales", query);
  } catch {
    return [];
  }
  const map = new Map();
  for (const r of data || []) {
    let e = map.get(r.qopla_shop_id);
    if (!e) {
      e = {
        shopId: r.qopla_shop_id,
        shopName: r.shop_name || r.qopla_shop_id,
        salesGross: 0,
        salesNet: null, // netto lagras inte i pos_daily_sales
        orders: 0,
        source: r.source || "pos",
        basis: "pos",
      };
      map.set(r.qopla_shop_id, e);
    }
    e.salesGross += Number(r.sales) || 0;
    e.orders += Number(r.orders) || 0;
  }
  return [...map.values()];
}

async function computeReport(year, month) {
  const { firstDay, lastDay } = monthBounds(year, month);
  const startISO = dayRangeISO(firstDay).startDate;
  const endISO = dayRangeISO(lastDay).endDate;

  const [qopla, pos] = await Promise.all([
    qoplaShopSales({ year, month, startISO, endISO }),
    posShopSales({ firstDay, lastDay }),
  ]);

  // Netto exkl moms för pos-butiker (Chao) = brutto / momssats.
  for (const s of pos) {
    const divisor = POS_NET_VAT_DIVISOR[s.shopId];
    if (divisor && s.salesGross > 0) {
      s.salesNet = s.salesGross / divisor;
      s.basis = "pos-vat";
    }
  }

  const byId = new Map();
  for (const s of qopla) byId.set(s.shopId, s);
  for (const s of pos) if (!byId.has(s.shopId)) byId.set(s.shopId, s);

  const shops = [...byId.values()]
    .filter((s) => (s.salesGross || 0) > 0 || (s.orders || 0) > 0)
    .sort((a, b) => (b.salesGross || 0) - (a.salesGross || 0))
    .map((s) => ({
      shopId: s.shopId,
      shopName: s.shopName,
      salesGross: Math.round(s.salesGross || 0), // inkl moms
      salesNet: s.salesNet == null ? null : Math.round(s.salesNet), // exkl moms (null för pos)
      orders: s.orders,
      source: s.source,
      basis: s.basis, // "zreport" | "overview" | "pos" | "pos-vat"
      ...(s.zDays != null ? { zDays: s.zDays } : {}),
    }));

  const total = shops.reduce(
    (acc, s) => ({
      salesGross: acc.salesGross + (s.salesGross || 0),
      salesNet: acc.salesNet + (s.salesNet || 0),
      orders: acc.orders + (s.orders || 0),
    }),
    { salesGross: 0, salesNet: 0, orders: 0 }
  );

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    period: { start: firstDay, end: lastDay, startISO, endISO },
    shops,
    total,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- E-post ----------
function kr(n) {
  return Math.round(n).toLocaleString("sv-SE");
}

function buildBody(monthLabel, rows) {
  const lines = [`Hej,`, ``, `Omsättning för ${monthLabel}:`, ``];
  for (const r of rows) {
    lines.push(r.shopName);
    lines.push(`${kr(r.salesNet)} (exkl moms)`);
    lines.push(`${kr(r.salesGross)} (inkl moms)`);
    lines.push(``);
  }
  lines.push(`Vänliga hälsningar`);
  return lines.join("\n");
}

function planEmails(report) {
  const [yy, mm] = report.month.split("-").map(Number);
  const monthLabel = `${MONTHS_SV[mm - 1]} ${yy}`;
  const byId = new Map(report.shops.map((s) => [s.shopId, s]));
  const planned = [];
  for (const dest of EMAIL_DESTINATIONS) {
    const rows = dest.shops
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((s) => ({ ...s, shopName: (dest.names && dest.names[s.shopId]) || s.shopName }));
    if (rows.length === 0) continue;
    if (dest.separate) {
      for (const row of rows) {
        planned.push({
          center: dest.center, to: dest.to, from: dest.from,
          subject: `Omsättning ${monthLabel} – ${row.shopName}`,
          text: buildBody(monthLabel, [row]),
          shops: [row.shopName],
        });
      }
    } else {
      planned.push({
        center: dest.center, to: dest.to, from: dest.from,
        subject: `Omsättning ${monthLabel} – ${dest.center}`,
        text: buildBody(monthLabel, rows),
        shops: rows.map((r) => r.shopName),
      });
    }
  }
  return { monthLabel, planned };
}

// Visa vad som SKULLE rapporteras till Jernhusen (dry-run).
function planJernhusen(report) {
  const [Year, Month] = report.month.split("-").map(Number);
  const byId = new Map(report.shops.map((s) => [s.shopId, s]));
  const planned = [];
  for (const b of JERNHUSEN_BUSINESSES) {
    const shop = byId.get(b.shopId);
    if (!shop || shop.salesNet == null) continue;
    planned.push({
      name: b.name,
      Year, Month,
      MonthlyTurnOverExVat: Math.round(shop.salesNet), // exkl moms
      NumberOfReceipts: shop.orders || 0,
    });
  }
  return planned;
}

const jhToken = (html) => {
  const m = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html || "");
  return m ? m[1] : null;
};
const jhForm = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");

// Fetch med timeout + retry — Jernhusens portal kan vara mycket seg, och utan
// per-anrop-timeout riskerar hela Vercel-funktionen att dödas vid maxDuration.
const JH_TIMEOUT_MS = 15000;
async function jhFetch(url, opts = {}, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, { ...opts, signal: AbortSignal.timeout(JH_TIMEOUT_MS) });
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

// Extrahera ASP.NET-valideringsfel ur en svarskropp (så vi ser VARFÖR det misslyckades).
function jhValidationErrors(body) {
  const msgs = [];
  const summary = /class="[^"]*validation-summary-errors[^"]*"[\s\S]*?<\/(?:div|ul)>/.exec(body);
  if (summary) msgs.push(summary[0]);
  for (const m of body.matchAll(/class="[^"]*field-validation-error[^"]*"[^>]*>([\s\S]*?)<\/span>/g)) msgs.push(m[1]);
  for (const m of body.matchAll(/class="[^"]*(?:alert-danger|text-danger)[^"]*"[^>]*>([\s\S]*?)<\//g)) msgs.push(m[1]);
  const clean = msgs.map((s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  return [...new Set(clean)].join(" | ").slice(0, 500);
}

// Logga in på Jernhusen (webbformulär, ASP.NET anti-forgery) och POSTa omsättning per verksamhet.
// Verksamheterna körs PARALLELLT med varsin cookie-kopia (anti-forgery-token hör ihop med cookien).
async function jernhusenWebReport(report) {
  const USER = process.env.JERNHUSEN_USER;
  const PASS = process.env.JERNHUSEN_PASS;
  if (!USER || !PASS) return { error: "JERNHUSEN_USER / JERNHUSEN_PASS saknas i miljövariabler" };

  const [Year, Month] = report.month.split("-").map(Number);
  const byId = new Map(report.shops.map((s) => [s.shopId, s]));
  const parseCookies = (res) => {
    const out = {};
    const sc = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of sc) { const p = c.split(";")[0]; const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1); }
    return out;
  };
  const cookieStr = (jar) => Object.entries(jar).map(([k, v]) => k + "=" + v).join("; ");

  // 1) Login GET → token + cookie, 2) Login POST (måste vara sekventiellt)
  const lg = await jhFetch(`${JERNHUSEN_BASE}/Account/Login`, { redirect: "manual" });
  const baseJar = parseCookies(lg);
  const loginToken = jhToken(await lg.text());
  const lp = await jhFetch(`${JERNHUSEN_BASE}/Account/Login`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieStr(baseJar) },
    body: jhForm({ __RequestVerificationToken: loginToken, Username: USER, Password: PASS, RememberMe: "false" }),
  });
  Object.assign(baseJar, parseCookies(lp));

  // 3) Per verksamhet (parallellt): GET create (nytt token) → POST create
  const results = await Promise.all(JERNHUSEN_BUSINESSES.map(async (b) => {
    const shop = byId.get(b.shopId);
    if (!shop || shop.salesNet == null) return { name: b.name, status: "skip", reason: "saknar netto" };
    try {
      const jar = { ...baseJar };
      const gc = await jhFetch(`${JERNHUSEN_BASE}/turnover/Create?BusinessId=${b.businessId}`, { headers: { Cookie: cookieStr(jar) }, redirect: "manual" });
      Object.assign(jar, parseCookies(gc));
      const gcBody = await gc.text();
      if (/name="Username"/.test(gcBody)) return { name: b.name, status: "error", reason: "inte inloggad (kontrollera JERNHUSEN_USER/PASS)" };
      const formToken = jhToken(gcBody);
      const pc = await jhFetch(`${JERNHUSEN_BASE}/turnover/Create`, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieStr(jar) },
        body: jhForm({
          __RequestVerificationToken: formToken, BusinessId: b.businessId,
          Year, Month, MonthlyTurnOverExVat: Math.round(shop.salesNet), NumberOfReceipts: shop.orders || 0, Comment: "",
        }),
      });
      const base = { name: b.name, code: pc.status, exVat: Math.round(shop.salesNet), receipts: shop.orders || 0 };
      // success = redirect till verksamhetssidan
      if (pc.status >= 300 && pc.status < 400) return { ...base, status: "sent" };
      const pcBody = await pc.text().catch(() => "");
      // Dubblettspärr = månaden är redan rapporterad. Räknas som OK (idempotent omkörning).
      if (/finns redan en rapporterad uppgift/i.test(pcBody)) {
        return { ...base, status: "already_reported", reason: "Det finns redan en rapporterad uppgift för denna månad" };
      }
      const reason = jhValidationErrors(pcBody);
      return { ...base, status: "error", reason: reason || "okänt (inga valideringsfel hittade i svaret)" };
    } catch (err) {
      return { name: b.name, status: "error", reason: String((err && err.message) || err) };
    }
  }));
  return { results };
}

// ---------- Emporia (Mallcomm / Let's Join) ----------

// Enkel cookie-jar per domän.
function makeJar() {
  const jars = {};
  const host = (url) => new URL(url).host;
  return {
    absorb(url, res) {
      const h = host(url);
      jars[h] = jars[h] || {};
      const sc = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const c of sc) { const p = c.split(";")[0]; const i = p.indexOf("="); if (i > 0) jars[h][p.slice(0, i).trim()] = p.slice(i + 1); }
    },
    header(url) {
      const h = host(url);
      return Object.entries(jars[h] || {}).map(([k, v]) => k + "=" + v).join("; ");
    },
  };
}

async function ljFetch(jar, url, opts = {}, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const headers = { ...(opts.headers || {}) };
      const c = jar.header(url);
      if (c) headers.Cookie = c;
      const res = await fetch(url, { ...opts, headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
      jar.absorb(url, res);
      return res;
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

const formBody = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*" };

// Plocka ut <form>-block ur plugin-HTML:en. Varje öppen period är ett eget formulär.
function parseSalesForms(html) {
  const forms = [];
  for (const m of html.matchAll(/<form[^>]*sales-collection-form[\s\S]*?<\/form>/g)) {
    const block = m[0];
    const fields = {};
    for (const h of block.matchAll(/<input[^>]*type=["']hidden["'][^>]*>/g)) {
      const name = /name=["']([^"']+)["']/.exec(h[0]);
      const value = /value=["']([^"']*)["']/.exec(h[0]);
      if (name) fields[name[1]] = value ? value[1] : "";
    }
    const dayFields = [...new Set([...block.matchAll(/name=["'](\d{2}_([A-Za-zÅÄÖåäö]+)_(\d{4}))["']/g)].map((d) => d[1]))];
    const first = /name=["']\d{2}_([A-Za-zÅÄÖåäö]+)_(\d{4})["']/.exec(block);
    forms.push({
      fields,
      dayFields,
      monthName: first ? first[1] : null,
      year: first ? Number(first[2]) : null,
      hasMonthTotal: /name=["']Month_Total["']/.test(block),
    });
  }
  return forms;
}

// Logga in, byt till rätt profil och rapportera Month_Total (inkl moms) per Emporia-butik.
async function emporiaReport(report, { dry = false } = {}) {
  const USER = process.env.LETSJOIN_USER;
  const PASS = process.env.LETSJOIN_PASS;
  if (!USER || !PASS) return { error: "LETSJOIN_USER / LETSJOIN_PASS saknas i miljövariabler" };

  const [Year, Month] = report.month.split("-").map(Number);
  const wantMonth = SV_MONTHS[Month - 1];
  const byId = new Map(report.shops.map((s) => [s.shopId, s]));
  const jar = makeJar();

  // 1) Login (delad session för båda profilerna)
  const lr = await ljFetch(jar, `${LETSJOIN_BASE}/auth/api_login`, {
    method: "POST", headers: FORM_HEADERS,
    body: formBody({ email_address: USER, password: PASS }),
  });
  const lj = await lr.json().catch(() => ({}));
  const user = lj?.data?.user;
  if (!user || !Array.isArray(user.accounts)) {
    return { error: `Inloggning på Let's Join misslyckades (status ${lr.status})` };
  }
  const accounts = user.accounts;

  const results = [];
  for (const target of EMPORIA_SHOPS) {
    const shop = byId.get(target.shopId);
    const base = { name: target.localName, grossVat: shop ? Math.round(shop.salesGross) : null };
    try {
      if (!shop || shop.salesGross == null) { results.push({ ...base, status: "skip", reason: "saknar omsättning" }); continue; }

      // 2) Byt till rätt profil
      const acc = accounts.find((a) => (a?.local?.name || "").trim().toLowerCase() === target.localName.toLowerCase());
      if (!acc) { results.push({ ...base, status: "error", reason: `hittar ingen profil som heter "${target.localName}"` }); continue; }
      const sw = await ljFetch(jar, `${LETSJOIN_BASE}/auth/api_switch_account`, {
        method: "POST", headers: FORM_HEADERS,
        body: formBody({ localid: acc.local.id, centreid: acc.centre.id }),
      });
      if (sw.status >= 400) { results.push({ ...base, status: "error", reason: `profilbyte misslyckades (${sw.status})` }); continue; }

      // 3) Hitta kategorin "RAPPORT OMSÄTTNING" och hämta dess krypterade data-sträng
      const cats = await ljFetch(jar, `${LETSJOIN_BASE}/api/get_categories`).then((r) => r.json());
      const cat = (cats?.data || []).find((c) => c.type === "segue_plugin_sales_collection");
      if (!cat) { results.push({ ...base, status: "error", reason: "hittar ingen sales_collection-kategori" }); continue; }
      const gc = await ljFetch(jar, `${LETSJOIN_BASE}/api/get_category`, {
        method: "POST", headers: FORM_HEADERS, body: formBody({ catid: cat.id }),
      }).then((r) => r.json());
      const dataString = gc?.data_string;
      if (!dataString) { results.push({ ...base, status: "error", reason: "fick ingen data_string från get_category" }); continue; }

      // 4) Hämta plugin-formuläret och välj perioden för rapportmånaden
      const pluginUrl = `${MALLCOMM_BASE}/sales-collection?data=${encodeURIComponent(dataString)}`;
      const html = await ljFetch(jar, pluginUrl, { headers: { Accept: "text/html" } }).then((r) => r.text());
      // ftoken är ofta en tom sträng i webbkontext (används bara av app-klienten) — det är OK.
      const ftokenMatch = /\bftoken\s*=\s*["']([^"']*)["']/.exec(html);
      if (!ftokenMatch) { results.push({ ...base, status: "error", reason: "hittar ingen ftoken-deklaration i plugin-svaret" }); continue; }
      const ftoken = ftokenMatch[1];
      // Perioderna laddas lazily — plocka ut period_form_id:n och hämta varje periods formulär.
      const periodIds = [...new Set([...html.matchAll(/data-period-form-id=["'](\d+)["']/g)].map((m) => m[1]))];
      if (!periodIds.length) { results.push({ ...base, status: "error", reason: "hittar inga perioder i plugin-svaret" }); continue; }
      let form = null;
      let shopHeading = null;
      const seen = [];
      for (const pid of periodIds) {
        const slideUrl = `${MALLCOMM_BASE}/sales-collection/period-form-slide?data=${encodeURIComponent(dataString)}&period_form_id=${pid}`;
        const slide = await ljFetch(jar, slideUrl, { headers: { Accept: "text/html", Referer: pluginUrl } }).then((r) => r.text());
        const f = parseSalesForms(slide)[0];
        if (!f) continue;
        seen.push(`${f.monthName || "?"} ${f.year || "?"}`);
        if (f.monthName && f.monthName.toLowerCase() === wantMonth.toLowerCase() && f.year === Year) {
          form = f;
          // Butiksnamnet renderas i slide-svaret — används för att verifiera att rätt profil är aktiv.
          shopHeading = (/<div[^>]*class=["'][^"']*text-uppercase[^"']*["'][^>]*>\s*([^<]{2,60}?)\s*</i.exec(slide) || [])[1] || null;
          break;
        }
      }
      if (!form) {
        results.push({ ...base, status: "error", reason: `ingen öppen period för ${wantMonth} ${Year} (öppna: ${seen.join(", ") || "inga"})` });
        continue;
      }

      // 5) Bygg payload: dolda fält + tomma dagsfält + månadssumman inkl moms
      const submitted = { ...form.fields };
      for (const d of form.dayFields) submitted[d] = "";
      submitted.Month_Total = String(Math.round(shop.salesGross));

      // Skydd mot att skriva till fel butik om profilbytet inte fått genomslag.
      const headingOk = !shopHeading || shopHeading.toLowerCase().replace(/\s+/g, " ").includes(target.localName.toLowerCase().split(" ")[0]);
      if (!headingOk) {
        results.push({ ...base, status: "error", reason: `plugin-sessionen visar "${shopHeading}" men förväntade "${target.localName}" — profilbytet slog inte igenom` });
        continue;
      }

      if (dry) {
        results.push({ ...base, status: "dry", shopInPortal: shopHeading, period: `${form.monthName} ${form.year}`, form_periodid: form.fields.form_periodid, campaignid: form.fields.campaignid, wouldSend: submitted.Month_Total });
        continue;
      }

      const sub = await ljFetch(jar, `${MALLCOMM_BASE}/sales-collection/submit`, {
        method: "POST", headers: { ...FORM_HEADERS, Referer: pluginUrl },
        body: formBody({ token: ftoken, data: dataString, plugin_data: JSON.stringify(submitted) }),
      });
      const txt = await sub.text().catch(() => "");
      let ok = sub.status >= 200 && sub.status < 300;
      let payload;
      try { payload = JSON.parse(txt); } catch { /* icke-JSON */ }
      if (payload && (payload.status === 200 || payload.success === true)) ok = true;
      else if (payload && payload.status && payload.status !== 200) ok = false;
      results.push({
        ...base,
        status: ok ? "sent" : "error",
        code: sub.status,
        period: `${form.monthName} ${form.year}`,
        ...(ok ? {} : { reason: (payload ? JSON.stringify(payload) : txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 300) }),
      });
    } catch (err) {
      results.push({ ...base, status: "error", reason: String((err && err.message) || err) });
    }
  }
  return { results };
}

async function sendViaResend({ apiKey, from, to, subject, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || JSON.stringify(data?.error || data) || `Resend ${res.status}`);
  return data.id;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // Auth
  const expected = process.env.REPORT_API_TOKEN;
  if (!expected) return res.status(500).json({ error: "REPORT_API_TOKEN saknas i miljövariabler" });
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = req.query.token || bearer;
  if (provided !== expected) return res.status(401).json({ error: "Ogiltig eller saknad token" });

  // Månad
  let year, month;
  if (req.query.month) {
    const m = /^(\d{4})-(\d{2})$/.exec(req.query.month);
    if (!m) return res.status(400).json({ error: "month måste vara YYYY-MM" });
    year = Number(m[1]);
    month = Number(m[2]);
    if (month < 1 || month > 12) return res.status(400).json({ error: "month måste vara YYYY-MM (01–12)" });
  } else {
    ({ year, month } = previousMonth());
  }

  try {
    const report = await computeReport(year, month);

    // ----- action=send: skicka (eller dry-run) rapport-mejl -----
    if (req.query.action === "send") {
      const dry = req.query.dry === "1" || req.query.dry === "true";
      const apiKey = process.env.RESEND_API_KEY;
      const { monthLabel, planned } = planEmails(report);

      if (dry) {
        return res.status(200).json({ dryRun: true, month: report.month, monthLabel, emails: planned });
      }
      if (!apiKey) return res.status(500).json({ error: "RESEND_API_KEY saknas i miljövariabler" });

      const results = [];
      for (const p of planned) {
        try {
          const id = await sendViaResend({ apiKey, from: p.from, to: p.to, subject: p.subject, text: p.text });
          results.push({ to: p.to, subject: p.subject, status: "sent", id });
        } catch (err) {
          results.push({ to: p.to, subject: p.subject, status: "error", error: err.message });
        }
      }
      const allOk = results.every((r) => r.status === "sent");
      return res.status(allOk ? 200 : 207).json({
        month: report.month, monthLabel,
        sent: results.filter((r) => r.status === "sent").length,
        failed: results.filter((r) => r.status === "error").length,
        results,
      });
    }

    // ----- action=jernhusen: logga in och rapportera till Jernhusen (eller dry-run) -----
    if (req.query.action === "jernhusen") {
      const dry = req.query.dry === "1" || req.query.dry === "true";
      if (dry) {
        return res.status(200).json({
          dryRun: true,
          month: report.month,
          credsSet: !!(process.env.JERNHUSEN_USER && process.env.JERNHUSEN_PASS),
          reports: planJernhusen(report),
        });
      }
      const out = await jernhusenWebReport(report);
      if (out.error) return res.status(500).json({ error: out.error });
      const isOk = (r) => r.status === "sent" || r.status === "already_reported";
      const allOk = out.results.length > 0 && out.results.every(isOk);
      return res.status(allOk ? 200 : 207).json({
        month: report.month,
        sent: out.results.filter((r) => r.status === "sent").length,
        alreadyReported: out.results.filter((r) => r.status === "already_reported").length,
        failed: out.results.filter((r) => !isOk(r)).length,
        results: out.results,
      });
    }

    // ----- action=emporia: logga in på Let's Join och rapportera Month_Total (eller dry-run) -----
    if (req.query.action === "emporia") {
      const dry = req.query.dry === "1" || req.query.dry === "true";
      const out = await emporiaReport(report, { dry });
      if (out.error) return res.status(500).json({ error: out.error });
      const allOk = out.results.length > 0 && out.results.every((r) => r.status === "sent" || r.status === "dry");
      return res.status(allOk ? 200 : 207).json({
        month: report.month,
        dryRun: dry || undefined,
        sent: out.results.filter((r) => r.status === "sent").length,
        failed: out.results.filter((r) => r.status !== "sent" && r.status !== "dry").length,
        results: out.results,
      });
    }

    // ----- default: returnera JSON -----
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
