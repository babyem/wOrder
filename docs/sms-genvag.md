# SMS via genväg ("wOrder SMS")

SMS-knappen i wOrder kan köra en genväg i Genvägar i stället för att öppna Meddelanden.
Genvägen skickar SMS:et direkt från ditt nummer och säger sedan till wOrder att det gick
iväg, så leverantören blir grön utan frågan "Skickat?".

Görs **en gång per iPhone/Mac**. Skapad på iPhone synkas den via iCloud till Macen (och tvärtom).

## 1. Installera genvägen

**Enklast — importera färdig fil:** öppna [`public/wOrder SMS.shortcut`](../public/wOrder%20SMS.shortcut)
(eller `https://worder.woso.se/wOrder%20SMS.shortcut` i Safari på iPhonen) → **Lägg till genväg**.
Filen är signerad för "alla", och genvägen får namnet `wOrder SMS` automatiskt.

Kontrollera efter import att **"Skicka meddelande"** har "Visa vid körning" avstängt (pilen ▸).

Filen byggs om med `python3 scripts/build-sms-shortcut.py` (se skriptet).

### Bygga för hand (om importen inte fungerar)

Öppna **Genvägar** → **+** → döp genvägen till exakt **`wOrder SMS`** (stavning och mellanslag måste stämma).

Lägg till de här åtgärderna i ordning (sök på namnet i åtgärdslistan):

1. **Hämta ordlista från indata**
   - Indata: *Genvägsindata*.
   - Om Genvägar frågar vad genvägen tar emot: välj **Text**.
2. **Hämta ordlistevärde** → *Hämta* **Värde** *för* `phone` *i* **Ordlista**
3. **Hämta ordlistevärde** → **Värde** för `body` i **Ordlista** (välj ordlistan från steg 1)
4. **Hämta ordlistevärde** → **Värde** för `id` i **Ordlista**
5. **Hämta ordlistevärde** → **Värde** för `confirm` i **Ordlista**
6. **Skicka meddelande**
   - Meddelande: värdet från steg 3 (`body`)
   - Mottagare: värdet från steg 2 (`phone`)
   - Tryck på pilen ▸ och **stäng av "Visa vid körning"** — annars måste du trycka Skicka själv.
7. **Hämta innehållet i URL**
   - URL: värdet från steg 5 (`confirm`)
   - Tryck på pilen ▸: **Metod: POST**, **Begärandetext: JSON**
   - Lägg till fält: typ **Text**, nyckel `id`, värde: värdet från steg 4 (`id`)

Tips: när du väljer ett värde, tryck länge på variabeln och välj rätt *Ordlistevärde* (de heter likadant —
kolla att steg 6 använder `body`/`phone` och steg 7 använder `confirm`/`id`).

## 2. Slå på i wOrder

wOrder → **Settings** → **SMS via genväg** → slå på. Inställningen gäller bara den enheten,
så gör det på varje iPhone/Mac där genvägen finns.

## 3. Första körningen

Första gången frågar Genvägar om genvägen får skicka meddelanden och kontakta `cjrzeoswkzenwlftsahp.supabase.co`
→ välj **Tillåt alltid**. På Macen frågar webbläsaren om den får öppna Genvägar → **Tillåt**.

## Så ser det ut

1. Tryck **SMS** på en leverantör.
2. Genvägar blinkar förbi 1–2 s och skickar SMS:et.
3. Tryck **◀ Orders** uppe till vänster (iPhone) / klicka tillbaka till webbläsaren (Mac).
4. Leverantören är grön och SMS:et syns med ✓ i loggen.

Medan wOrder väntar visar knappen **Väntar på SMS…** med två knappar:
- **Klar** — SMS:et gick iväg men bekräftelsen kom inte fram (t.ex. dåligt nät). Markerar klar.
- **Avbryt** — SMS:et skickades inte. Inget loggas.

## Bra att veta

- **Mac:** vanliga SMS skickas via iPhonen, så den måste vara på och ha täckning
  (iPhone → Inställningar → Meddelanden → Vidarebefordra SMS → Macen på). iMessage går utan.
- Om wOrder stängs medan genvägen kör syns SMS:et ändå som ✓ i loggen, men leverantören
  måste markeras klar för hand.
- En väntande rad som aldrig bekräftas visas med en klocka i loggen ("Inte bekräftat av genvägen").
