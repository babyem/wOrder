# SMS via Mac-hjälparen

På en Mac kan wOrder skicka SMS helt i bakgrunden: inga fönster, ingen Genvägar-app.
Ett litet program ("Mac-hjälparen") körs på Macen och skickar via Meddelanden med AppleScript.

```
wOrder (webbläsaren) ──POST──▶ 127.0.0.1:47821 (Mac-hjälparen) ──AppleScript──▶ Meddelanden ──▶ SMS
```

## Installera (en gång per Mac)

```bash
bash scripts/mac-sms-helper/install.sh
```

Det kopierar `sms-helper.py` till `~/Library/Application Support/wOrder/` och lägger in en
LaunchAgent (`se.woso.worder-sms`) som startar den vid inloggning. Ta bort med
`bash scripts/mac-sms-helper/install.sh uninstall`.

Sedan: wOrder → **Settings** → **SMS-utskick** → **Mac-hjälpare** → **Testa anslutning**.

## Första SMS:et

macOS frågar om **python3** får styra **Meddelanden** → **OK**. Har du råkat neka:
Systeminställningar → Integritet och säkerhet → Automatisering → python3 → slå på Meddelanden.

Chrome kan fråga om sidan får komma åt enheter på det lokala nätverket → **Tillåt**.

## Krav

- Vanliga SMS går via iPhonen: iPhone → Inställningar → Meddelanden → Vidarebefordra SMS → Macen på.
  Utan det skickas som iMessage (fungerar bara till iPhone-användare).
- Mac-hjälparen tar bara emot anrop från `https://worder.woso.se` (och `localhost:5173` vid utveckling),
  och lyssnar bara på den egna datorn.

## Felsökning

- Logg: `~/Library/Logs/worder-sms.log`
- Svarar den? `curl http://127.0.0.1:47821/health`
- Starta om: kör `install.sh` igen.
