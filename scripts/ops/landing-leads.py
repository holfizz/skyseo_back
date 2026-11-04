#!/usr/bin/env python3
"""Emergency landing-only intake. SQLite + durable Telegram outbox; no CRM workers."""
import argparse
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
 id TEXT PRIMARY KEY, site TEXT NOT NULL, telegram TEXT NOT NULL,
 auto INTEGER NOT NULL, created_at INTEGER NOT NULL, fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_dedupe ON leads(fingerprint, created_at);
CREATE TABLE IF NOT EXISTS notifications (
 lead_id TEXT NOT NULL REFERENCES leads(id), chat_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL, message_id INTEGER, last_error TEXT,
 PRIMARY KEY(lead_id, chat_id)
);
"""

def connect(path):
    db = sqlite3.connect(path, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA synchronous=FULL')
    return db

def initialize(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with connect(path) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript(SCHEMA)
    os.chmod(path, 0o600)

def validate(body):
    if not isinstance(body, dict):
        raise ValueError('Ожидается объект JSON')
    raw, contact = body.get('site'), body.get('telegram')
    if not isinstance(raw, str) or not 1 <= len(raw.strip()) <= 300 or re.search(r'\s', raw.strip()):
        raise ValueError('Проверьте адрес сайта')
    try:
        url = urllib.parse.urlsplit(raw.strip() if re.match(r'^https?://', raw, re.I) else 'https://' + raw.strip())
        if url.scheme not in ('http', 'https') or url.username or url.password or url.port:
            raise ValueError()
        domain = (url.hostname or '').encode('idna').decode('ascii').lower()
        if domain.startswith('www.'):
            domain = domain[4:]
        labels = domain.split('.')
        if len(domain) > 253 or len(labels) < 2 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', l) for l in labels) or not re.fullmatch(r'(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})', labels[-1]):
            raise ValueError()
    except (ValueError, UnicodeError):
        raise ValueError('Проверьте адрес сайта') from None
    if not isinstance(contact, str) or len(contact) > 120:
        raise ValueError('Укажите Telegram')
    username = re.sub(r'^(?:https?://)?(?:t\.me|telegram\.me)/', '', contact.strip(), flags=re.I).lstrip('@').rstrip('/')
    if not re.fullmatch(r'[a-z][a-z0-9_]{3,31}', username, re.I):
        raise ValueError('Укажите Telegram: @username или ссылку t.me/username')
    auto = body.get('auto', False)
    if not isinstance(auto, bool):
        raise ValueError('Некорректный тип auto')
    return domain, '@' + username, auto

def save(path, body, primary, secondary='7271373084', now=None):
    site, telegram, auto = validate(body)
    now = int(time.time() if now is None else now)
    fingerprint = hashlib.sha256(json.dumps([site, telegram.lower(), auto]).encode()).hexdigest()
    with connect(path) as db:
        db.execute('BEGIN IMMEDIATE')
        previous = db.execute('SELECT id FROM leads WHERE fingerprint=? AND created_at>=? ORDER BY created_at DESC LIMIT 1', (fingerprint, now - 600)).fetchone()
        if previous:
            return previous['id'], True
        lead_id = str(uuid.uuid4())
        db.execute('INSERT INTO leads VALUES(?,?,?,?,?,?)', (lead_id, site, telegram, int(auto), now, fingerprint))
        chats = {primary} if auto else {primary, secondary}
        for chat in sorted(chats - {''}):
            db.execute('INSERT INTO notifications(lead_id,chat_id,next_at) VALUES(?,?,?)', (lead_id, chat, now))
    return lead_id, False

class TelegramHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self):
        super().__init__('api.telegram.org', timeout=10, context=ssl.create_default_context())

    def connect(self):
        override = os.environ.get('SKYSEO_TELEGRAM_IPV4', '').strip()
        if not override:
            return super().connect()
        address = str(ipaddress.IPv4Address(override))
        sock = socket.create_connection((address, 443), timeout=self.timeout)
        try:
            # Only the TCP address changes. Host, SNI and certificate validation
            # remain api.telegram.org; no third-party proxy sees the bot token.
            self.sock = self._context.wrap_socket(sock, server_hostname='api.telegram.org')
        except Exception:
            sock.close()
            raise

def send_notification(token, row):
    head = 'Автосохранение: форму заполнили, но не отправили' if row['auto'] else 'Заявка с сайта: бесплатный тест'
    text = f"{head}\nСайт: https://{row['site']}\nTelegram: {row['telegram']}\nЗаявка: {row['lead_id']}"
    payload = json.dumps({'chat_id':row['chat_id'], 'text':text, 'disable_web_page_preview':True}).encode()
    connection = TelegramHTTPSConnection()
    try:
        connection.request('POST', f'/bot{token}/sendMessage', body=payload, headers={'Content-Type':'application/json'})
        response = connection.getresponse()
        if response.status >= 400:
            raise urllib.error.HTTPError('telegram',response.status,'Telegram rejected the request',None,None)
        result = json.loads(response.read())
    finally:
        connection.close()
    if not result.get('ok'):
        raise RuntimeError('telegram_rejected')
    return int(result['result']['message_id'])

def deliver(path, token, sender=send_notification, now=None):
    now = int(time.time() if now is None else now)
    with connect(path) as db:
        rows = db.execute("SELECT n.*,l.site,l.telegram,l.auto FROM notifications n JOIN leads l ON l.id=n.lead_id WHERE n.state='pending' AND n.next_at<=? ORDER BY n.next_at LIMIT 20", (now,)).fetchall()
    for row in rows:
        try:
            message_id = sender(token, row)
        except Exception as error:
            # Never log exception URLs: urllib errors can contain the bot token.
            code = error.code if isinstance(error, urllib.error.HTTPError) else None
            label = 'telegram_http_' + str(code) if code else type(error).__name__
            delay = min(3600, 30 * (2 ** min(row['attempts'], 7)))
            with connect(path) as db:
                db.execute('UPDATE notifications SET attempts=attempts+1,next_at=?,last_error=? WHERE lead_id=? AND chat_id=?', (now + delay, label, row['lead_id'], row['chat_id']))
            print('Notification queued for retry:', label, flush=True)
        else:
            with connect(path) as db:
                db.execute("UPDATE notifications SET state='sent',attempts=attempts+1,message_id=?,last_error=NULL WHERE lead_id=? AND chat_id=?", (message_id, row['lead_id'], row['chat_id']))

def handler(path, primary, secondary, allowed_hosts):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # No contacts, request bodies, query strings, or tokens in logs.

        def reply(self, status, data):
            payload = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path != '/v1/api/health':
                return self.reply(404, {'ok':False})
            try:
                with connect(path) as db:
                    db.execute('SELECT 1 FROM leads LIMIT 1').fetchall()
                self.reply(200, {'ok':True, 'mode':'landing-only'})
            except sqlite3.Error:
                self.reply(503, {'ok':False})

        def do_POST(self):
            if self.path != '/v1/api/lead':
                return self.reply(404, {'ok':False})
            origin = self.headers.get('Origin')
            if origin and urllib.parse.urlsplit(origin).hostname not in allowed_hosts:
                return self.reply(403, {'ok':False})
            if self.headers.get_content_type() != 'application/json':
                return self.reply(415, {'ok':False})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096:
                    return self.reply(413, {'ok':False})
                body = json.loads(self.rfile.read(length))
                lead_id, duplicate = save(path, body, primary, secondary)
            except (ValueError, UnicodeError):
                return self.reply(400, {'ok':False, 'message':'Проверьте адрес сайта и Telegram'})
            except sqlite3.Error:
                return self.reply(503, {'ok':False, 'message':'Не удалось сохранить заявку. Попробуйте еще раз'})
            self.reply(200, {'ok':True, 'id':lead_id, 'duplicate':duplicate})
    return Handler

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4018)
    args = parser.parse_args()
    path = Path(os.environ.get('SKYSEO_LEADS_DB', '/var/lib/skyseo-landing/leads.sqlite3'))
    primary = os.environ.get('TELEGRAM_ADMIN_ID', '').strip()
    secondary = os.environ.get('SITE_LEAD_SECONDARY_CHAT_ID', '7271373084').strip()
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
    if not token or not primary:
        raise SystemExit('Configure TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_ID')
    initialize(path)
    stop = threading.Event()
    hosts = set(os.environ.get('SKYSEO_ALLOWED_HOSTS', 'skyseo.site,www.skyseo.site,85.208.85.102').split(','))
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(path, primary, secondary, hosts))
    server.daemon_threads = True

    def worker():
        while not stop.is_set():
            try:
                deliver(path, token)
            except Exception as error:
                print('Notification worker:', type(error).__name__, flush=True)
            stop.wait(5)
    threading.Thread(target=worker, daemon=True).start()
    def shutdown(_signum, _frame):
        stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    print('SkySEO landing-only intake ready on loopback', flush=True)
    server.serve_forever()
    server.server_close()

if __name__ == '__main__':
    main()
