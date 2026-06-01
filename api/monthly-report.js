// api/monthly-report.js — Vercel serverless function
//
// Returnerar föregående månads (eller valfri månads) omsättning per butik som JSON,
// sammanslaget från Qopla-overview + Supabase-tabellen pos_daily_sales — samma logik
// som rapportsidan i admin.
//
// Skyddad med en delad token. Sätt REPORT_API_TOKEN i Vercel → Settings →
// Environment Variables. Anropa med ?token=… eller Authorization: Bearer <token>.
//
// Exempel:
//   GET /api/monthly-report?token=XXX                  → föregående månad
//   GET /api/monthly-report?token=XXX&month=2026-05    → specifik månad (YYYY-MM)

import { getSession, fetchOverviewRaw, dayRangeISO } from "./_lib/qopla.js";
import { sbSelect } from "./_lib/supabaseAdmin.js";

// Aktuellt år/månad i Europe/Stockholm.
function stockholmYearMonth() {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [year, month] = s.split("-").map(Number);
  return { year, month };
}

// "YYYY-MM" → { year, month, firstDay: "YYYY-MM-DD", lastDay: "YYYY-MM-DD" }
function monthBounds(year, month) {
  const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
  // dag 0 i nästa månad = sista dagen i denna
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { firstDay, lastDay };
}

function previousMonth() {
  const { year, month } = stockholmYearMonth();
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

async function qoplaShopSales({ startISO, endISO }) {
  const { companyId, token, shops } = await getSession();
  const rows = await Promise.all(
    shops.map(async (shop) => {
      try {
        const data = await fetchOverviewRaw({
          companyId,
          token,
          shopId: shop.id,
          startDate: startISO,
          endDate: endISO,
        });
        const report = data.aggregatedReport || {};
        let gross = 0; // totalSum = inkl moms
        let orders = 0;
        let net = 0; // summa av timme-netto = exkl moms
        let grossHours = 0; // kontroll: timme-brutto ska ≈ gross
        for (const ch of Object.values(report)) {
          gross += ch.totalSum || 0;
          orders += ch.quantityOfOrders || 0;
          const stats = ch && ch.saleStatsPerHour;
          if (stats && typeof stats === "object") {
            for (const v of Object.values(stats)) {
              net += v.totalNet || 0;
              grossHours += v.total || 0;
            }
          }
        }
        return {
          shopId: shop.id,
          shopName: shop.name,
          salesGross: gross,
          salesNet: net,
          orders,
          source: "qopla",
          _grossHours: grossHours,
        };
      } catch {
        return { shopId: shop.id, shopName: shop.name, salesGross: 0, salesNet: 0, orders: 0, source: "qopla" };
      }
    })
  );
  return rows;
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
      };
      map.set(r.qopla_shop_id, e);
    }
    e.salesGross += Number(r.sales) || 0;
    e.orders += Number(r.orders) || 0;
  }
  return [...map.values()];
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // ---- Auth ----
  const expected = process.env.REPORT_API_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: "REPORT_API_TOKEN saknas i miljövariabler" });
  }
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = req.query.token || bearer;
  if (provided !== expected) {
    return res.status(401).json({ error: "Ogiltig eller saknad token" });
  }

  // ---- Vilken månad? ----
  let year, month;
  if (req.query.month) {
    const m = /^(\d{4})-(\d{2})$/.exec(req.query.month);
    if (!m) return res.status(400).json({ error: "month måste vara YYYY-MM" });
    year = Number(m[1]);
    month = Number(m[2]);
    if (month < 1 || month > 12) {
      return res.status(400).json({ error: "month måste vara YYYY-MM (01–12)" });
    }
  } else {
    ({ year, month } = previousMonth());
  }

  const { firstDay, lastDay } = monthBounds(year, month);
  const startISO = dayRangeISO(firstDay).startDate;
  const endISO = dayRangeISO(lastDay).endDate;

  // ---- Debug: dumpa rå Qopla-overview för en butik (för att hitta exakt netto-fält) ----
  if (req.query.debug === "raw" && req.query.shopId) {
    try {
      const { companyId, token } = await getSession();
      const raw = await fetchOverviewRaw({
        companyId,
        token,
        shopId: req.query.shopId,
        startDate: startISO,
        endDate: endISO,
      });
      // Ta bort de stora saleStatsPerHour-objekten men behåll fältnamn + alla andra fält per kanal
      const report = raw.aggregatedReport || {};
      const channelKeys = {};
      for (const [name, ch] of Object.entries(report)) {
        const { saleStatsPerHour, ...rest } = ch || {};
        channelKeys[name] = {
          allFields: Object.keys(ch || {}),
          ...rest,
          _saleStatsPerHourCount: saleStatsPerHour ? Object.keys(saleStatsPerHour).length : 0,
        };
      }
      return res.status(200).json({
        topLevelKeys: Object.keys(raw),
        nonAggregatedReport: Object.fromEntries(
          Object.entries(raw).filter(([k]) => k !== "aggregatedReport")
        ),
        channels: channelKeys,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const [qopla, pos] = await Promise.all([
      qoplaShopSales({ startISO, endISO }),
      posShopSales({ firstDay, lastDay }),
    ]);

    // Slå ihop, undvik dubbletter på shopId (Qopla har företräde).
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
        // kontrollvärde: timme-brutto vs totalSum (ska vara nära lika för Qopla)
        ...(s._grossHours != null ? { _grossHours: Math.round(s._grossHours) } : {}),
      }));

    const total = shops.reduce(
      (acc, s) => ({
        salesGross: acc.salesGross + (s.salesGross || 0),
        salesNet: acc.salesNet + (s.salesNet || 0),
        orders: acc.orders + (s.orders || 0),
      }),
      { salesGross: 0, salesNet: 0, orders: 0 }
    );

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    return res.status(200).json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      period: { start: firstDay, end: lastDay, startISO, endISO },
      shops,
      total,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
