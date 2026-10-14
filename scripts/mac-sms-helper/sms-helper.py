#!/usr/bin/env python3
"""
wOrder SMS-hjälpare för Mac.

Liten lokal server (bara 127.0.0.1) som wOrder i webbläsaren anropar när
SMS-läget "Mac-hjälpprogram" är valt i Settings. SMS:et skickas via
Meddelanden med AppleScript — inga fönster, ingen Genvägar-app.

  GET  /health                     -> {"ok": true, "version": ...}
  POST /send  {"phone", "body"}    -> {"ok": true} | {"error": "..."}

Startas av launchd (se install.sh). Logg: ~/Library/Logs/worder-sms.log

Säkerhet: servern lyssnar bara på loopback, och POST /send kräver att
anropet kommer från wOrder (Origin-headern, som webbsidor inte kan förfalska)
och att Host är 127.0.0.1/localhost (skydd mot DNS rebinding).
"""
import json
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = 1
PORT = 47821
ALLOWED_ORIGINS = {
    'https://worder.woso.se',
    'http://localhost:5173',  # vite dev
}
ALLOWED_HOSTS = {f'127.0.0.1:{PORT}', f'localhost:{PORT}'}
MAX_BODY = 4000

# Skicka som SMS om vidarebefordran från iPhonen är påslagen, annars iMessage.
APPLESCRIPT = '''
on run argv
  set phoneNum to item 1 of argv
  set msg to item 2 of argv
  tell application "Messages"
    set svc to missing value
    try
      set svc to 1st account whose service type = SMS and enabled is true
    end try
    if svc is missing value then set svc to 1st account whose service type = iMessage
    send msg to participant phoneNum of svc
  end tell
end run
'''

send_lock = threading.Lock()


def normalize_phone(raw):
    """'+46 76-219 17 89' -> '+46762191789'. None om det inte ser ut som ett nummer."""
    phone = re.sub(r'[\s\-().]', '', str(raw or ''))
    return phone if re.fullmatch(r'\+?\d{6,15}', phone) else None


def send_sms(phone, body):
    with send_lock:
        r = subprocess.run(
            ['/usr/bin/osascript', '-', phone, body],
            input=APPLESCRIPT, capture_output=True, text=True, timeout=30,
        )
    if r.returncode != 0:
        err = (r.stderr or r.stdout).strip()
        if '-1743' in err:
            err = 'Mac-hjälparen saknar behörighet att styra Meddelanden (Systeminställningar → Integritet och säkerhet → Automatisering)'
        raise RuntimeError(err or f'osascript exit {r.returncode}')


class Handler(BaseHTTPRequestHandler):
    server_version = 'worder-sms/1'

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))

    def _origin_ok(self):
        return self.headers.get('Origin') in ALLOWED_ORIGINS and self.headers.get('Host') in ALLOWED_HOSTS

    def _reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        if not self._origin_ok():
            return self._reply(403, {'error': 'Origin not allowed'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Chrome: Private/Local Network Access från en publik https-sida
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Max-Age', '600')
        self.send_header('Vary', 'Origin')
        self.end_headers()

    def do_GET(self):
        if self.path != '/health':
            return self._reply(404, {'error': 'Not found'})
        if not self._origin_ok() and self.headers.get('Origin') is not None:
            return self._reply(403, {'error': 'Origin not allowed'})
        self._reply(200, {'ok': True, 'version': VERSION})

    def do_POST(self):
        if self.path != '/send':
            return self._reply(404, {'error': 'Not found'})
        if not self._origin_ok():
            return self._reply(403, {'error': 'Origin not allowed'})
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            return self._reply(415, {'error': 'Expected JSON'})
        try:
            length = int(self.headers.get('Content-Length') or 0)
            data = json.loads(self.rfile.read(min(length, MAX_BODY * 4)) or b'{}')
        except (ValueError, json.JSONDecodeError):
            return self._reply(400, {'error': 'Invalid JSON'})

        phone = normalize_phone(data.get('phone'))
        body = str(data.get('body') or '')
        if not phone:
            return self._reply(400, {'error': 'Ogiltigt telefonnummer'})
        if not body.strip() or len(body) > MAX_BODY:
            return self._reply(400, {'error': 'Tomt eller för långt meddelande'})

        try:
            send_sms(phone, body)
        except subprocess.TimeoutExpired:
            return self._reply(504, {'error': 'Meddelanden svarade inte'})
        except RuntimeError as e:
            sys.stderr.write(f'send to {phone} failed: {e}\n')
            return self._reply(500, {'error': str(e)})
        sys.stderr.write(f'sent to {phone} ({len(body)} chars)\n')
        self._reply(200, {'ok': True})


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    sys.stderr.write(f'worder-sms listening on 127.0.0.1:{PORT}\n')
    server.serve_forever()
