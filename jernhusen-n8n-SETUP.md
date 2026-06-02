# Jernhusen omsättningsrapportering via n8n — gratis & enkelt

Helautomatisk månadsrapportering till Jernhusen (Woso Centralstationen + Chao). n8n loggar in och fyller i åt dig.

## Gratis n8n (self-hosted)
n8n är gratis och öppen källkod när du kör det själv. Enklaste sättet:

- **Snabbast:** öppna en terminal och kör `npx n8n` → öppna http://localhost:5678
- **Eller** kör via Docker: `docker run -it --rm -p 5678:5678 docker.n8n.io/n8nio/n8n`

(Ingen betald plan behövs. Maskinen måste vara igång när workflowet ska köra — vill du ha det "alltid på" kan vi titta på en gratis molnvärd senare.)

## Steg
1. **Importera** `jernhusen-n8n-workflow.json` i n8n (Workflows → tre prickar → Import from File).
2. Öppna noden **"Rapportera till Jernhusen"** och fyll i de två översta raderna:
   ```js
   const USER = 'tony@woso.se';          // ← ditt användarnamn
   const PASS = 'SKRIV_DITT_LOSENORD';   // ← ditt lösenord
   ```
3. **Testa:** klicka **Execute Workflow**. Du ska se `status: "ok"` för båda verksamheterna, och raden ska dyka upp i Jernhusen-portalen.
4. När det funkar: toggla **Active** uppe till höger. Klart — körs automatiskt 1:a varje månad kl 08:00.

## Vad den rapporterar
- `MonthlyTurnOverExVat` = nettoomsättning exkl moms (Woso Centralstationen från Z-rapport, Chao = brutto/1,06)
- `NumberOfReceipts` = antal kvitton
- Avser alltid **föregående månad**.

## Felsökning
- `status: "error", reason: "inte inloggad"` → fel användarnamn/lösenord.
- Inget händer på schemat → kontrollera att n8n är igång och att workflowet är **Active**.

## Säkerhet
Lösenordet står i klartext i Code-noden. Det är ok i din egen n8n, men dela inte workflow-filen med lösenordet ifyllt. (Vill du ha det säkrare kan vi byta till n8n-miljövariabler.)
