#!/bin/bash
# Installerar wOrder SMS-hjälparen som LaunchAgent (startar vid inloggning).
#   bash scripts/mac-sms-helper/install.sh            installera / uppdatera
#   bash scripts/mac-sms-helper/install.sh uninstall  ta bort
set -euo pipefail

LABEL=se.woso.worder-sms
DIR="$HOME/Library/Application Support/wOrder"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/worder-sms.log"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

if [ "${1:-}" = "uninstall" ]; then
  rm -f "$PLIST" "$DIR/sms-helper.py"
  echo "Borttagen."
  exit 0
fi

mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
install -m 755 "$(dirname "$0")/sms-helper.py" "$DIR/sms-helper.py"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DIR/sms-helper.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$PLIST"
sleep 1
curl -sf http://127.0.0.1:47821/health && echo && echo "Installerad. Logg: $LOG"
