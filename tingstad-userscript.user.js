// ==UserScript==
// @name         wOrder → Tingstad varukorg
// @namespace    worder.tingstad
// @version      1.3
// @description  Fyll Tingstad-varukorgen från en väntande wOrder-order. Körs i din inloggade session — varorna hamnar i DIN varukorg. Lägger ingen order.
// @match        https://www.tingstad.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      cjrzeoswkzenwlftsahp.supabase.co
// ==/UserScript==

(function () {
  'use strict';

  // ── Config (Supabase anon key is public — same as the wOrder app ships) ──────
  const SUPABASE_URL = 'https://cjrzeoswkzenwlftsahp.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcnplb3N3a3plbndsZnRzYWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjkwMTIsImV4cCI6MjA5NDM0NTAxMn0.KHMSRNjvuzlCny3ciDJj2CtJTOeXKLk3u3HAijlLAEg';
  const ADD_TO_CART = '/se-sv/fixed/cart/AddToCart';

  // ── Supabase GET via GM_xmlhttpRequest (bypasses CORS) ───────────────────────
  function sbGet(pathAndQuery) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: SUPABASE_URL + '/rest/v1/' + pathAndQuery,
        headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
        onload: (r) => {
          try { resolve(JSON.parse(r.responseText)); }
          catch (e) { reject(new Error('Bad JSON from Supabase: ' + r.status)); }
        },
        onerror: () => reject(new Error('Network error to Supabase')),
      });
    });
  }

  // ── Supabase PATCH via GM_xmlhttpRequest (write back to wOrder) ──────────────
  function sbPatch(pathAndQuery, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'PATCH',
        url: SUPABASE_URL + '/rest/v1/' + pathAndQuery,
        headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        data: JSON.stringify(body),
        onload: (r) => { (r.status >= 200 && r.status < 300) ? resolve(true) : reject(new Error('Supabase PATCH ' + r.status)); },
        onerror: () => reject(new Error('Network error to Supabase')),
      });
    });
  }

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

  // ── Load pending wOrder orders that have Tingstad-mapped items ───────────────
  async function loadOrders() {
    const sel = 'id,created_at,done_vendors,location:locations(name),items:order_items(quantity,vendor_override,product:products(name,vendor,tingstad_id,tingstad_alt_id))';
    const rows = await sbGet('orders?status=eq.pending&select=' + encodeURIComponent(sel) + '&order=created_at.desc&limit=50');
    const evendor = (i) => i.vendor_override || (i.product && i.product.vendor) || null;
    return rows
      .map((o) => {
        const all = o.items || [];
        const tItems = all.filter((i) => i.product && i.product.tingstad_id);
        return {
          id: o.id,
          when: o.created_at,
          location: (o.location && o.location.name) || '—',
          doneVendors: o.done_vendors || [],
          items: tItems,
          vendorsAll: [...new Set(all.map(evendor).filter((v) => v && v !== '—'))],
          vendorsTingstad: [...new Set(tItems.map(evendor).filter(Boolean))],
        };
      })
      .filter((o) => o.items.length > 0);
  }

  // ── Mark the order's Tingstad vendor done in wOrder (auto-completes the order
  //    if Tingstad is the only/last vendor). Mirrors OrderCard.markVendorDone. ──
  async function markOrderDone(order) {
    const newDone = [...new Set([...(order.doneVendors || []), ...order.vendorsTingstad])];
    const patch = { done_vendors: newDone };
    const allCovered = order.vendorsAll.length > 0 && order.vendorsAll.every((v) => newDone.includes(v));
    if (allCovered) { patch.status = 'done'; patch.completed_at = new Date().toISOString(); }
    await sbPatch('orders?id=eq.' + encodeURIComponent(order.id), patch);
    return allCovered;
  }

  // ── UI ───────────────────────────────────────────────────────────────────────
  const css = `
    #wo-fab{position:fixed;right:18px;bottom:18px;z-index:999999;background:#0f766e;color:#fff;border:none;
      border-radius:14px;padding:11px 15px;font:600 13px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
    #wo-fab:hover{background:#0d5d56}
    #wo-panel{position:fixed;right:18px;bottom:66px;z-index:999999;width:340px;max-height:70vh;overflow:auto;
      background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);
      font:13px/1.4 system-ui,sans-serif;color:#0f172a;display:none}
    #wo-panel h3{margin:0;padding:13px 15px;font-size:13px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center}
    #wo-panel .wo-x{cursor:pointer;color:#94a3b8;font-weight:700}
    .wo-order{padding:11px 15px;border-bottom:1px solid #f1f5f9;cursor:pointer}
    .wo-order:hover{background:#f0fdfa}
    .wo-order b{display:block;font-size:13px}
    .wo-order span{color:#64748b;font-size:11px}
    .wo-empty,.wo-msg{padding:15px;color:#64748b}
    .wo-row{font-size:11px;color:#475569;padding:1px 0}
    .wo-bar{padding:11px 15px;border-top:1px solid #f1f5f9}
    .wo-back{cursor:pointer;color:#0f766e;font-weight:600;font-size:12px}
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

  function close() { panel.style.display = 'none'; }
  function header(title) { return `<h3>${esc(title)}<span class="wo-x">✕</span></h3>`; }

  async function showOrders() {
    panel.innerHTML = header('Väntande ordrar') + '<div class="wo-msg">Laddar…</div>';
    panel.style.display = 'block';
    panel.querySelector('.wo-x').onclick = close;
    let orders;
    try { orders = await loadOrders(); }
    catch (e) { panel.innerHTML = header('Fel') + `<div class="wo-msg">${esc(e.message)}</div>`; panel.querySelector('.wo-x').onclick = close; return; }
    if (!orders.length) { panel.innerHTML = header('Väntande ordrar') + '<div class="wo-empty">Inga väntande ordrar med Tingstad-varor.</div>'; panel.querySelector('.wo-x').onclick = close; return; }
    panel.innerHTML = header('Välj order') +
      orders.map((o, i) =>
        `<div class="wo-order" data-i="${i}"><b>${esc(o.location)}</b><span>${fmtTime(o.when)} · ${o.items.length} Tingstad-varor</span></div>`
      ).join('');
    panel.querySelector('.wo-x').onclick = close;
    panel.querySelectorAll('.wo-order').forEach((el) => {
      el.onclick = () => confirmOrder(orders[parseInt(el.dataset.i, 10)]);
    });
  }

  function confirmOrder(order) {
    panel.innerHTML = header(order.location) +
      '<div class="wo-bar"><span class="wo-back">‹ tillbaka</span></div>' +
      order.items.map((it) => `<div class="wo-row">${esc(it.product.name)} — <b>${it.quantity}</b> (art ${esc(it.product.tingstad_id)})</div>`).join('').replace(/^/, '<div style="padding:6px 15px 12px">') + '</div>' +
      `<div class="wo-bar"><button id="wo-fill" style="width:100%;background:#0f766e;color:#fff;border:none;border-radius:10px;padding:10px;font:600 13px system-ui;cursor:pointer">Lägg ${order.items.length} varor i varukorgen</button></div>`;
    panel.querySelector('.wo-x').onclick = close;
    panel.querySelector('.wo-back').onclick = showOrders;
    panel.querySelector('#wo-fill').onclick = () => fill(order);
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
    let doneMsg = '';
    if (okCount > 0) {
      try {
        const full = await markOrderDone(order);
        doneMsg = full
          ? '<br><br>✓ <b>Order markerad klar</b> i wOrder.'
          : '<br><br>✓ <b>Tingstad klar</b> i wOrder (andra leverantörer kvar).';
      } catch (e) { doneMsg = '<br><br>⚠️ Kunde ej markera klar i wOrder: ' + esc(e.message); }
    }
    panel.innerHTML = header('Klart') +
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
      doneMsg +
      `<br><br>Öppna varukorgen, granska och lägg ordern.</div>`;
    panel.querySelector('.wo-x').onclick = close;
  }

  fab.onclick = () => { if (panel.style.display === 'block') close(); else showOrders(); };
})();
