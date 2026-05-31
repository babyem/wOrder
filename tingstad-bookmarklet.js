/*
 * wOrder → Tingstad — varukorg-fyllare (BOOKMARKLET — funkar på dator OCH mobil)
 *
 * Fyller Tingstad-varukorgen från en väntande wOrder-order, i DIN inloggade
 * session (samma som userscriptet, men utan extension → funkar på mobil).
 * Lägger ingen order — du granskar och beställer själv.
 *
 * INSTALLERA (den körbara "javascript:"-raden finns i tingstad-bookmarklet.txt):
 *   Dator: skapa ett bokmärke, redigera det, klistra in javascript:-raden som URL.
 *          På tingstad.com (inloggad) → klicka bokmärket.
 *   iOS Safari: bokmärk valfri sida → redigera → byt URL till javascript:-raden.
 *               Kör: skriv bokmärkesnamnet i adressfältet → välj det.
 *   Android: Firefox eller Kiwi Browser → spara bokmärke → kör via adressfältet.
 *
 * Källkoden nedan är samma logik, ominifierad, för underhåll.
 */
(async () => {
  const SB = 'https://cjrzeoswkzenwlftsahp.supabase.co';
  const K = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcnplb3N3a3plbndsZnRzYWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjkwMTIsImV4cCI6MjA5NDM0NTAxMn0.KHMSRNjvuzlCny3ciDJj2CtJTOeXKLk3u3HAijlLAEg';
  const H = { apikey: K, Authorization: 'Bearer ' + K };
  const E = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let P = document.getElementById('woBM');
  if (P) P.remove();
  P = document.createElement('div');
  P.id = 'woBM';
  P.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:320px;max-height:75vh;overflow:auto;background:#fff;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:14px system-ui;color:#0f172a';
  document.body.appendChild(P);

  const W = (t, b) => {
    P.innerHTML = '<div style="padding:12px 14px;border-bottom:1px solid #f1f5f9;font-weight:600;display:flex;justify-content:space-between">' + E(t) + '<span id="woX" style="cursor:pointer;color:#94a3b8">✕</span></div>' + b;
    const x = document.getElementById('woX');
    if (x) x.onclick = () => P.remove();
  };

  W('wOrder → Tingstad', '<div style="padding:14px;color:#64748b">Laddar ordrar…</div>');

  const SEL = 'id,created_at,location:locations(name),items:order_items(quantity,product:products(name,tingstad_id))';
  let O;
  try {
    const r = await fetch(SB + '/rest/v1/orders?status=eq.pending&select=' + encodeURIComponent(SEL) + '&order=created_at.desc&limit=50', { headers: H });
    O = (await r.json())
      .map((o) => ({ w: o.created_at, loc: (o.location || {}).name || '—', items: (o.items || []).filter((i) => i.product && i.product.tingstad_id) }))
      .filter((o) => o.items.length);
  } catch (e) { W('Fel', '<div style="padding:14px">' + E(e.message) + '</div>'); return; }

  if (!O.length) { W('Inga ordrar', '<div style="padding:14px;color:#64748b">Inga väntande ordrar med Tingstad-varor.</div>'); return; }

  const F = (i) => { try { return new Date(i).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return i; } };
  W('Välj order', O.map((o, i) => '<div class="woO" data-i="' + i + '" style="padding:11px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer"><b>' + E(o.loc) + '</b><br><span style="color:#64748b;font-size:12px">' + F(o.w) + ' · ' + o.items.length + ' varor</span></div>').join(''));

  const A = async (art, amt) => {
    try {
      const r = await fetch('/se-sv/fixed/cart/AddToCart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: 'productNumber=' + encodeURIComponent(art) + '&amount=' + encodeURIComponent(amt) + '&productId=&ticketId=',
        credentials: 'include',
      });
      return r.ok;
    } catch (e) { return false; }
  };

  P.querySelectorAll('.woO').forEach((el) => el.onclick = async () => {
    const o = O[+el.dataset.i];
    W(o.loc, '<div style="padding:14px" id="woP">Lägger till…</div>');
    const fa = [];
    let n = 0;
    for (const it of o.items) {
      document.getElementById('woP').textContent = 'Lägger till ' + (n + 1) + '/' + o.items.length + '…';
      const ok = await A(it.product.tingstad_id, it.quantity);
      if (!ok) fa.push(it.product);
      n++;
    }
    W('Klart', '<div style="padding:14px"><b>' + (o.items.length - fa.length) + ' varor</b> i varukorgen.' +
      (fa.length ? '<br><br>⚠️ Ej tillagda (slut i lager / fel artnr):<br>' + fa.map((f) => '• ' + E(f.name) + ' <a href="https://www.tingstad.com/se-sv/sokresultat?q=' + encodeURIComponent(f.tingstad_id) + '" target="_blank" style="color:#0f766e">sök ›</a>').join('<br>') : '') +
      '<br><br>Öppna varukorgen och granska.</div>');
  });
})();
