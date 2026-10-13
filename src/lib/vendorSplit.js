// Delningsregler per leverantör (vendors.split_rules, migration 038).
// Exempel: Easy Asia — av Woso Triangelns order hör vissa varor till Letsgrab.
// Ren JS utan beroenden: används både av appen och av api/telegram.js.
// Testas i src/lib/__tests__/vendorSplit.test.ts.
//
// Regel: { location, label, items: [{ product_id, share }] }
//   share 1   = hela antalet flyttas till label
//   share 0.5 = halva antalet; udda antal avrundas uppåt till label (5 → 3 + 2)

const norm = s => (s ?? '').trim().toLowerCase()

export function splitQuantity(quantity, share) {
  if (!(share > 0)) return 0
  if (share >= 1) return quantity
  return Math.min(quantity, Math.ceil(quantity * share - 1e-9))
}

// lines: [{ product_id, quantity, ... }]. Returnerar block i utskicksordning:
// varje regels label först, sist butiken med det som blir kvar. Tomma block tas bort.
export function splitLines(rules, location, lines) {
  const applicable = (rules ?? []).filter(r => norm(r.location) === norm(location) && r.label?.trim())
  if (!applicable.length) return [{ label: location, lines }]

  let rest = lines.map(l => ({ ...l }))
  const blocks = []
  for (const rule of applicable) {
    const shares = new Map((rule.items ?? []).map(i => [i.product_id, Number(i.share)]))
    const taken = []
    for (const line of rest) {
      if (!shares.has(line.product_id)) continue
      const qty = splitQuantity(line.quantity, shares.get(line.product_id))
      if (qty <= 0) continue
      taken.push({ ...line, quantity: qty })
      line.quantity -= qty
    }
    if (taken.length) blocks.push({ label: rule.label.trim(), lines: taken })
    rest = rest.filter(l => l.quantity > 0)
  }
  if (rest.length) blocks.push({ label: location, lines: rest })
  return blocks
}

// Samma sak för listor av { loc, items } (express/batch). Ordningen behålls;
// label-blocken hamnar direkt före butiken de delats ut från.
export function splitLocations(rules, locations) {
  return locations.flatMap(({ loc, items }) =>
    splitLines(rules, loc, items).map(b => ({ loc: b.label, items: b.lines })))
}

// Text för ett enskilt ordercard. Utan delning: oförändrat format "Butik\n\nrader".
// Med delning: ett block per mottagare, "Label\nrader", blankrad emellan.
export function formatSplitText(rules, location, lines, formatLine) {
  const blocks = splitLines(rules, location, lines)
  if (blocks.length === 1 && blocks[0].label === location) {
    return `${location}\n\n${blocks[0].lines.map(formatLine).join('\n')}`
  }
  return blocks.map(b => `${b.label}\n${b.lines.map(formatLine).join('\n')}`).join('\n\n')
}
