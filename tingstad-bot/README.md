# Tingstad cart bot

Fyller Tingstad-kundvagnen automatiskt när du trycker **"Skicka till Tingstad"** i backoffice.
Ingen webbläsarflik behöver vara öppen — boten kör headless på din Mac och kundvagnen
sparas på ditt Tingstad-konto.

## Flöde

1. Backoffice-knappen lägger ordern i Supabase-tabellen `tingstad_queue`
2. Boten pollar kön var 30:e sekund
3. För varje jobb: söker på artikelnummer, lägger varorna i kundvagnen
4. Jobbet markeras `done` (eller `failed` med felbeskrivning)
5. Öppna tingstad.com när du vill — kundvagnen är fylld, granska och slutför köpet

## Installation

```bash
cd tingstad-bot
npm install
npx playwright install chromium
```

## Logga in (en gång)

```bash
npm run login
```

Ett webbläsarfönster öppnas — logga in på tingstad.com som vanligt och stäng fönstret.
Sessionen sparas i `tingstad-profile/` och återanvänds.

## Kör

```bash
npm run watch    # pollar kön var 30:e sekund tills du stoppar (Ctrl+C)
npm run once     # kör kön en gång och avslutar
```

## Autostart vid inloggning (valfritt)

Skapa `~/Library/LaunchAgents/se.woso.tingstad-bot.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>se.woso.tingstad-bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/tnmp/Documents/wOrder/tingstad-bot/bot.mjs</string>
    <string>watch</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/tingstad-bot.log</string>
  <key>StandardErrorPath</key><string>/tmp/tingstad-bot.err</string>
</dict>
</plist>
```

Aktivera: `launchctl load ~/Library/LaunchAgents/se.woso.tingstad-bot.plist`

## Anpassa add-to-cart-logiken

`addToCart()` i `bot.mjs` använder generiska selektorer (sök → första produktkortet →
antal → köpknapp). Om den missar på riktiga sajten: klistra in ditt Tampermonkey-script
till Claude så portas den exakta logiken.
