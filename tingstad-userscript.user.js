// ==UserScript==
// @name         wOrder → Tingstad varukorg
// @namespace    worder.tingstad
// @version      1.4
// @description  Fyll Tingstad-varukorgen från en väntande wOrder-order. Körs i din inloggade session — varorna hamnar i DIN varukorg. Lägger ingen order. När du själv lagt Tingstad-ordern markeras wOrder-ordern klar automatiskt.
// @match        https://www.tingstad.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      cjrzeoswkzenwlftsahp.supabase.co
// ==/UserScript==

(function () {
  'use strict';

  // ── Config (Supabase anon key is public — same as the wOrder app ships) ──────
  const SUPABASE_URL = 'https://cjrzeoswkzenwlftsahp.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcnplb3N3a3plbndsZnRzYWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjkwMTIsImV4cCI6MjA5NDM0NTAxMn0.KHMSRNjvuzlCny3ciDJj2CtJTOeXKLk3u3HAijlLAEg';
  const ADD_TO_CART = '/se-sv/fixed/cart/AddToCart';
  // Tingstad's own order list (Mina sidor → Beställningar). A new order number
  // here is the proof that the order was actually placed.
  const TINGSTAD_ORDERS = '/se-sv/fixed/orders-content';

  const FILL_TTL_MS = 7 * 24 * 3600 * 1000; // forget a filled cart that was never ordered
  const CHECK_EVERY_MS = 60 * 1000;         // re-check while the tab stays open
  const SNOOZE_MS = 30 * 60 * 1000;         // ✕ on the question = ask again later
  const ORDER_SELECT = 'id,created_at,status,done_vendors,location:locations(name),items:order_items(quantity,vendor_override,product:products(name,vendor,tingstad_id,tingstad_alt_id))';

  // ── Supabase via GM_xmlhttpRequest (bypasses CORS) ───────────────────────────
  // Always resolves to the array of rows. A PATCH returns the rows it changed, so
  // an update that silently hit nothing shows up as an empty array.
  function sbRequest(method, pathAndQuery, body) {
    return new Promise((resolve, reject) => {
      const headers = { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON };
      if (body) { headers['Content-Type'] = 'application/json'; headers.Prefer = 'return=representation'; }
      GM_xmlhttpRequest({
        method,
        url: SUPABASE_URL + '/rest/v1/' + pathAndQuery,
        headers,
        data: body ? JSON.stringify(body) : undefined,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) { reject(new Error('Supabase svarade ' + r.status)); return; }
          let rows;
          try { rows = JSON.parse(r.responseText); } catch (e) { rows = null; }
          if (!Array.isArray(rows)) { reject(new Error('Oväntat svar från Supabase')); return; }
          resolve(rows);
        },
        onerror: () => reject(new Error('Nätverksfel mot Supabase')),
      });
    });
  }
  const sbGet = (pathAndQuery) => sbRequest('GET', pathAndQuery);
  const sbPatch = (pathAndQuery, body) => sbRequest('PATCH', pathAndQuery, body);

  // ── Small persistent state (shared between tabs) ─────────────────────────────
  const load = (key, fallback) => {
    try { const raw = GM_getValue(key, null); return raw == null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  };
  const save = (key, value) => GM_setValue(key, JSON.stringify(value));

  // Carts filled from wOrder that are waiting for the Tingstad order to be placed:
  // { since: 'YYYY-MM-DD', known: [Tingstad order numbers seen at fill time], fills: [{ id, location, at }] }
  function getFills() {
    const state = load('wo_fills', null);
    if (!state || !Array.isArray(state.fills)) return null;
    const fills = state.fills.filter((f) => Date.now() - f.at < FILL_TTL_MS);
    if (!fills.length) { save('wo_fills', null); return null; }
    return { since: state.since, known: state.known || [], fills };
  }
  // Tingstad order numbers that are already linked to wOrder or answered "none"
  const getHandled = () => load('wo_handled', []);
  const addHandled = (numbers) => save('wo_handled', [...new Set([...getHandled(), ...numbers])].slice(-80));

  const localDate = (d) => new Date(d).toLocaleDateString('sv-SE'); // YYYY-MM-DD

  // ── Add one product to the Tingstad cart (same-origin, your session) ─────────
  async function addToCart(productNumber, amount) {
    const body = 'productNumber=' + encodeURIComponent(productNumber) +
                 '&amount=' + encodeURIComponent(amount) +
                 '&productId=&ticketId=';
    const res = await fetch(ADD_TO_CART, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body,
      credentials: 'include',
    });
    return res.ok; // 200 = added; 500 = out of stock / not orderable for this account
  }

  // ── wOrder orders ────────────────────────────────────────────────────────────
  const effectiveVendor = (i) => i.vendor_override || (i.product && i.product.vendor) || null;

  function shapeOrder(o) {
    const all = o.items || [];
    const tItems = all.filter((i) => i.product && i.product.tingstad_id);
    return {
      id: o.id,
      when: o.created_at,
      status: o.status,
      location: (o.location && o.location.name) || '—',
      doneVendors: o.done_vendors || [],
      items: tItems,
      vendorsAll: [...new Set(all.map(effectiveVendor).filter((v) => v && v !== '—'))],
      vendorsTingstad: [...new Set(tItems.map(effectiveVendor).filter(Boolean))],
    };
  }

  // Pending wOrder orders that still have Tingstad items to buy
  async function loadOrders() {
    const rows = await sbGet('orders?status=eq.pending&deleted_at=is.null&select=' + encodeURIComponent(ORDER_SELECT) + '&order=created_at.desc&limit=50');
    return rows
      .map(shapeOrder)
      .filter((o) => o.items.length > 0 && !o.vendorsTingstad.every((v) => o.doneVendors.includes(v)));
  }

  // Mark the order's Tingstad vendor done in wOrder (completes the whole order if
  // Tingstad is the only/last vendor). Mirrors OrderCard.markVendorDone. Reads the
  // order fresh first so nothing done in wOrder meanwhile is overwritten.
  // Returns 'done' | 'partial' | 'already' | 'missing'.
  async function markOrderDone(orderId) {
    const rows = await sbGet('orders?id=eq.' + encodeURIComponent(orderId) + '&select=' + encodeURIComponent(ORDER_SELECT));
    if (!rows.length) return 'missing';
    const order = shapeOrder(rows[0]);
    if (order.status !== 'pending') return 'already';
    const newDone = [...new Set([...order.doneVendors, ...order.vendorsTingstad])];
    const patch = { done_vendors: newDone };
    const allCovered = order.vendorsAll.length > 0 && order.vendorsAll.every((v) => newDone.includes(v));
    if (allCovered) { patch.status = 'done'; patch.completed_at = new Date().toISOString(); }
    const changed = await sbPatch('orders?id=eq.' + encodeURIComponent(orderId) + '&status=eq.pending', patch);
    if (!changed.length) throw new Error('ingen rad uppdaterades');
    return allCovered ? 'done' : 'partial';
  }

  // ── Tingstad's order list: [{ nr, date }] newest first, or null if unreadable ─
  async function fetchTingstadOrders() {
    try {
      const res = await fetch(TINGSTAD_ORDERS, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const seen = new Set();
      const orders = [];
      doc.querySelectorAll('tr').forEach((tr) => {
        const cells = tr.children;
        if (cells.length < 2) return;
        const nr = cells[0].textContent.trim();
        const date = cells[1].textContent.trim();
        if (!/^\d{6,}$/.test(nr) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(nr)) return;
        seen.add(nr);
        orders.push({ nr, date });
      });
      // No order rows and no table at all = not logged in / page changed
      if (!orders.length && !/Ordernummer/.test(doc.body ? doc.body.textContent : '')) return null;
      return orders.sort((a, b) => Number(b.nr) - Number(a.nr));
    } catch (e) { return null; }
  }

  // ── UI ───────────────────────────────────────────────────────────────────────
  const css = `
    #wo-fab{position:fixed;right:18px;bottom:18px;z-index:999999;background:#0f766e;color:#fff;border:none;
      border-radius:14px;padding:11px 15px;font:600 13px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
    #wo-fab:hover{background:#0d5d56}
    #wo-panel{position:fixed;right:18px;bottom:66px;z-index:999999;width:340px;max-width:calc(100vw - 36px);max-height:70vh;overflow:auto;
      background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);
      font:13px/1.4 system-ui,sans-serif;color:#0f172a;display:none}
    #wo-panel h3{margin:0;padding:13px 15px;font-size:13px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center}
    #wo-panel .wo-x{cursor:pointer;color:#94a3b8;font-weight:700;padding:0 4px}
    .wo-order{padding:11px 15px;border-bottom:1px solid #f1f5f9;cursor:pointer}
    .wo-order:hover{background:#f0fdfa}
    .wo-order b{display:block;font-size:13px}
    .wo-order span{color:#64748b;font-size:11px}
    .wo-order .wo-tag{display:inline-block;margin-top:4px;padding:2px 7px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600}
    .wo-empty,.wo-msg{padding:15px;color:#64748b}
    .wo-msg b{color:#0f172a}
    .wo-row{font-size:11px;color:#475569;padding:1px 0}
    .wo-bar{padding:11px 15px;border-top:1px solid #f1f5f9}
    .wo-back,.wo-link{cursor:pointer;color:#0f766e;font-weight:600;font-size:12px}
    .wo-btn{width:100%;background:#0f766e;color:#fff;border:none;border-radius:10px;padding:10px;font:600 13px system-ui;cursor:pointer}
    .wo-btn.wo-ghost{background:#fff;color:#475569;border:1px solid #e2e8f0}
    .wo-btn:disabled{opacity:.6;cursor:default}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const fab = document.createElement('button');
  fab.id = 'wo-fab'; fab.textContent = '📦 Fyll från wOrder';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'wo-panel';
  document.body.appendChild(panel);

  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const isOpen = () => panel.style.display === 'block';
  function close() { panel.style.display = 'none'; }
  function header(title) { return `<h3>${esc(title)}<span class="wo-x">✕</span></h3>`; }
  function render(title, bodyHtml, onClose) {
    panel.innerHTML = header(title) + bodyHtml;
    panel.style.display = 'block';
    panel.querySelector('.wo-x').onclick = onClose || close;
  }

  async function showOrders() {
    render('Väntande ordrar', '<div class="wo-msg">Laddar…</div>');
    let orders;
    try { orders = await loadOrders(); }
    catch (e) { render('Fel', `<div class="wo-msg">${esc(e.message)}</div>`); return; }
    if (!orders.length) { render('Väntande ordrar', '<div class="wo-empty">Inga väntande ordrar med Tingstad-varor.</div>'); return; }
    const state = getFills();
    const inCart = new Set(state ? state.fills.map((f) => f.id) : []);
    render('Välj order',
      orders.map((o, i) =>
        `<div class="wo-order" data-i="${i}"><b>${esc(o.location)}</b><span>${fmtTime(o.when)} · ${o.items.length} Tingstad-varor</span>` +
        (inCart.has(o.id) ? '<br><span class="wo-tag">🛒 I varukorgen · väntar på lagd order</span>' : '') +
        `</div>`
      ).join('') +
      (inCart.size ? '<div class="wo-bar"><span class="wo-link" id="wo-forget">Glöm varukorgen (ingen order läggs)</span></div>' : ''));
    panel.querySelectorAll('.wo-order').forEach((el) => {
      el.onclick = () => confirmOrder(orders[parseInt(el.dataset.i, 10)]);
    });
    const forget = panel.querySelector('#wo-forget');
    if (forget) forget.onclick = () => { save('wo_fills', null); showOrders(); };
  }

  function confirmOrder(order) {
    render(order.location,
      '<div class="wo-bar"><span class="wo-back">‹ tillbaka</span></div>' +
      '<div style="padding:6px 15px 12px">' +
      order.items.map((it) => `<div class="wo-row">${esc(it.product.name)} — <b>${esc(it.quantity)}</b> (art ${esc(it.product.tingstad_id)})</div>`).join('') +
      '</div>' +
      `<div class="wo-bar"><button id="wo-fill" class="wo-btn">Lägg ${order.items.length} varor i varukorgen</button></div>`);
    panel.querySelector('.wo-back').onclick = showOrders;
    panel.querySelector('#wo-fill').onclick = () => fill(order);
  }

  // Remember that this wOrder order now sits in the cart, plus which Tingstad
  // orders already existed, so the next new order number can be tied to it.
  async function rememberFill(order) {
    const state = getFills();
    const fill = { id: order.id, location: order.location, at: Date.now() };
    if (state) {
      save('wo_fills', { since: state.since, known: state.known, fills: [...state.fills.filter((f) => f.id !== order.id), fill] });
      return;
    }
    const existing = await fetchTingstadOrders();
    save('wo_fills', { since: localDate(Date.now()), known: (existing || []).map((o) => o.nr), fills: [fill] });
  }

  async function fill(order) {
    const btn = panel.querySelector('#wo-fill');
    btn.disabled = true;
    const failed = [];
    const altUsed = [];
    let done = 0;
    for (const it of order.items) {
      btn.textContent = `Lägger till ${done + 1}/${order.items.length}…`;
      try {
        let ok = await addToCart(it.product.tingstad_id, it.quantity);
        if (!ok && it.product.tingstad_alt_id) {
          if (await addToCart(it.product.tingstad_alt_id, it.quantity)) { altUsed.push({ name: it.product.name, art: it.product.tingstad_alt_id }); ok = true; }
        }
        if (!ok) failed.push({ name: it.product.name, art: it.product.tingstad_id });
      } catch (e) { failed.push({ name: it.product.name, art: it.product.tingstad_id }); }
      done++;
    }
    const okCount = order.items.length - failed.length;
    const searchUrl = (art) => 'https://www.tingstad.com/se-sv/sokresultat?q=' + encodeURIComponent(art);
    if (okCount > 0) await rememberFill(order);
    render('Klart',
      `<div class="wo-msg"><b>${okCount} varor</b> lagda i varukorgen.` +
      (altUsed.length
        ? `<br><br>↪ <b>Alternativ användes</b> för:<br>` +
          altUsed.map((f) => `• ${esc(f.name)} → ${esc(f.art)}`).join('<br>')
        : '') +
      (failed.length
        ? `<br><br>⚠️ <b>${failed.length} kunde inte läggas till</b> (slut i lager eller fel artikelnr):<br>` +
          failed.map((f) => `• ${esc(f.name)} <span style="color:#94a3b8">(${esc(f.art)})</span> — ` +
            `<a href="${searchUrl(f.art)}" target="_blank" style="color:#0f766e;font-weight:600">sök på Tingstad ›</a>`).join('<br>') +
          `<br><br>Lägg dessa manuellt (eller välj ersättning) via sök-länken.`
        : '') +
      (okCount > 0
        ? `<br><br>Öppna varukorgen, granska och lägg ordern. <b>${esc(order.location)}</b> markeras klar i wOrder automatiskt när Tingstad-ordern är lagd.`
        : '') +
      `</div>`);
  }

  // ── Order placed? ────────────────────────────────────────────────────────────
  const doneText = { done: 'markerad klar i wOrder', partial: 'Tingstad klar i wOrder (andra leverantörer kvar)', already: 'var redan klar i wOrder', missing: 'finns inte kvar i wOrder' };

  // Lane 1: the cart was filled from wOrder → a new Tingstad order number means
  // those wOrder orders are bought. Mark them done without asking.
  async function settleFills(state) {
    const list = await fetchTingstadOrders();
    if (!list) return;
    const handled = getHandled();
    const fresh = list.filter((o) => !state.known.includes(o.nr) && !handled.includes(o.nr) && o.date >= state.since);
    if (!fresh.length) return;
    const lines = [];
    const retry = [];
    for (const f of state.fills) {
      try { lines.push(`✓ <b>${esc(f.location)}</b> ${doneText[await markOrderDone(f.id)]}`); }
      catch (e) { retry.push(f); lines.push(`⚠️ <b>${esc(f.location)}</b> kunde inte markeras klar: ${esc(e.message)}`); }
    }
    // Failed ones stay and are tried again on the next check (the new order
    // number is left unhandled so it still counts as fresh)
    if (retry.length) save('wo_fills', { since: state.since, known: state.known, fills: retry });
    else { save('wo_fills', null); addHandled(fresh.map((o) => o.nr)); }
    render('Tingstad-order lagd',
      `<div class="wo-msg">Order <b>${esc(fresh[0].nr)}</b> finns hos Tingstad.<br><br>${lines.join('<br>')}</div>`);
  }

  // Lane 2: a Tingstad order that the script did not fill (cart built by hand).
  // wOrder still has pending Tingstad orders → ask which one it was. One tap.
  async function askAboutOrder() {
    if (isOpen() || Date.now() < load('wo_snooze', 0)) return;
    const pending = await loadOrders();
    if (!pending.length) return;
    const list = await fetchTingstadOrders();
    if (!list) return;
    const handled = getHandled();
    const oldest = pending.map((o) => localDate(o.when)).sort()[0];
    const candidate = list.find((o) => !handled.includes(o.nr) && o.date >= oldest);
    if (!candidate || isOpen()) return;
    render('Tingstad-order ' + candidate.nr,
      `<div class="wo-msg">Lagd ${esc(candidate.date)}. Vilken wOrder-order gällde den? Tryck för att markera klar.</div>` +
      pending.map((o, i) =>
        `<div class="wo-order" data-i="${i}"><b>${esc(o.location)}</b><span>${fmtTime(o.when)} · ${o.items.length} Tingstad-varor</span></div>`
      ).join('') +
      '<div class="wo-bar"><button id="wo-none" class="wo-btn wo-ghost">Ingen av dessa</button></div>',
      () => { save('wo_snooze', Date.now() + SNOOZE_MS); close(); });
    panel.querySelector('#wo-none').onclick = () => { addHandled([candidate.nr]); close(); };
    panel.querySelectorAll('.wo-order').forEach((el) => {
      el.onclick = async () => {
        const order = pending[parseInt(el.dataset.i, 10)];
        render('Tingstad-order ' + candidate.nr, '<div class="wo-msg">Markerar klar…</div>');
        try {
          const result = await markOrderDone(order.id);
          addHandled([candidate.nr]);
          render('Tingstad-order ' + candidate.nr, `<div class="wo-msg">✓ <b>${esc(order.location)}</b> ${doneText[result]}.</div>`);
        } catch (e) {
          render('Fel', `<div class="wo-msg">⚠️ Kunde inte markera klar i wOrder: ${esc(e.message)}</div>`);
        }
      };
    });
  }

  let checking = false;
  async function checkPlaced() {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const state = getFills();
      if (state) await settleFills(state);
      else await askAboutOrder();
    } catch (e) { /* quiet: next check tries again */ }
    checking = false;
  }

  fab.onclick = () => { if (isOpen()) close(); else showOrders(); };

  // Every page load on tingstad.com (the order confirmation included) and once a
  // minute while the tab is open
  checkPlaced();
  setInterval(checkPlaced, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPlaced(); });
})();
