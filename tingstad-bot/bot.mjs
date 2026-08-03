// Tingstad cart bot — polls Supabase tingstad_queue and fills the tingstad.com cart.
//
//   npm run login   → open a visible browser, log in ONCE manually, session is saved
//   npm run watch   → poll the queue every 30 s and process jobs headlessly
//   npm run once    → process pending jobs a single time, then exit
//
// The saved session lives in ./tingstad-profile (cookies persist between runs).

import { chromium } from 'playwright'

const SUPABASE_URL = 'https://cjrzeoswkzenwlftsahp.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcnplb3N3a3plbndsZnRzYWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjkwMTIsImV4cCI6MjA5NDM0NTAxMn0.KHMSRNjvuzlCny3ciDJj2CtJTOeXKLk3u3HAijlLAEg'
const PROFILE_DIR = new URL('./tingstad-profile', import.meta.url).pathname
const BASE = 'https://www.tingstad.com'

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
}

async function fetchQueue() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/tingstad_queue?status=eq.pending&order=created_at.asc`, { headers })
  return r.json()
}

async function updateJob(id, fields) {
  await fetch(`${SUPABASE_URL}/rest/v1/tingstad_queue?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(fields),
  })
}

async function launch(headless) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1440, height: 900 },
  })
}

// ── Add ONE product to the cart. ────────────────────────────────────────────
// Uses the site search with the article number, then clicks the add-to-cart
// button and sets the quantity. Selectors may need adjusting to the live site —
// see README for how to port your Tampermonkey logic here.
async function addToCart(page, artnr, quantity) {
  await page.goto(`${BASE}/se-sv/sok?q=${encodeURIComponent(artnr)}`, { waitUntil: 'networkidle' })

  // First product card in the search result
  const card = page.locator('[data-testid="product-card"], .product-card, article').first()
  await card.waitFor({ timeout: 10_000 })

  // Quantity input if present, otherwise click "add" repeatedly
  const qtyInput = card.locator('input[type="number"]').first()
  if (await qtyInput.count()) {
    await qtyInput.fill(String(quantity))
  }

  const addBtn = card.locator('button:has-text("Köp"), button:has-text("Lägg i"), [data-testid="add-to-cart"]').first()
  await addBtn.click()

  if (!(await qtyInput.count()) && quantity > 1) {
    for (let i = 1; i < quantity; i++) await addBtn.click()
  }

  await page.waitForTimeout(800)
}

async function processJob(context, job) {
  const page = await context.newPage()
  const failed = []
  try {
    for (const p of job.products) {
      const artnr = p.tingstad_id || p.tingstad_alt_id
      if (!artnr) { failed.push(`${p.name}: saknar artikelnummer`); continue }
      try {
        await addToCart(page, artnr, p.quantity)
        console.log(`  ✓ ${artnr} × ${p.quantity} (${p.name})`)
      } catch (err) {
        failed.push(`${p.name} (${artnr}): ${err.message}`)
        console.error(`  ✗ ${artnr}: ${err.message}`)
      }
    }
    await updateJob(job.id, {
      status: failed.length === 0 ? 'done' : 'failed',
      error: failed.length ? failed.join(' | ') : null,
      processed_at: new Date().toISOString(),
    })
  } finally {
    await page.close()
  }
}

async function ensureLoggedIn(context) {
  const page = await context.newPage()
  await page.goto(`${BASE}/se-sv`, { waitUntil: 'domcontentloaded' })
  // Heuristic: "Logga in" visible ⇒ not logged in
  const loginLink = page.locator('text=/Logga in/i').first()
  const loggedOut = await loginLink.isVisible().catch(() => false)
  await page.close()
  return !loggedOut
}

async function runOnce(headless = true) {
  const jobs = await fetchQueue()
  if (!jobs.length) { console.log('Inga jobb i kön'); return }

  const context = await launch(headless)
  try {
    if (!(await ensureLoggedIn(context))) {
      console.error('Ej inloggad — kör `npm run login` först')
      return
    }
    for (const job of jobs) {
      console.log(`Jobb ${job.id} — ${job.location_name} (${job.products.length} varor)`)
      await updateJob(job.id, { status: 'processing' })
      await processJob(context, job)
    }
  } finally {
    await context.close()
  }
}

const mode = process.argv[2]

if (mode === 'login') {
  const context = await launch(false)
  const page = await context.newPage()
  await page.goto(`${BASE}/se-sv`)
  console.log('Logga in i fönstret. Stäng webbläsaren när du är klar — sessionen sparas.')
  await new Promise(resolve => context.on('close', resolve))
} else if (mode === 'watch') {
  console.log('Bevakar tingstad_queue — Ctrl+C för att stoppa')
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await runOnce(true) } catch (err) { console.error('Fel:', err.message) }
    await new Promise(r => setTimeout(r, 30_000))
  }
} else if (mode === 'once') {
  await runOnce(true)
} else {
  console.log('Användning: node bot.mjs login | watch | once')
}
