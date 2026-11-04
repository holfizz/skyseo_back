#!/usr/bin/env python3
"""Issue the landing certificate only after DNS points to the emergency host."""
from pathlib import Path
import os
import socket
import subprocess
import tempfile

IP = '85.208.85.102'
DOMAIN = 'skyseo.site'
ROOT = Path(__file__).resolve().parent
TARGET = Path('/etc/nginx/sites-available/skyseo-landing')
CERT = Path('/etc/letsencrypt/live/skyseo.site/fullchain.pem')

def ready(host):
    try:
        ips = {r[4][0] for r in socket.getaddrinfo(host, None)}
        return ips == {IP}
    except OSError:
        return False

def main():
    if not ready(DOMAIN):
        print('SkySEO TLS: waiting for public DNS to point to the emergency host')
        return
    domains = [DOMAIN] + (['www.' + DOMAIN] if ready('www.' + DOMAIN) else [])
    covered = ''
    if CERT.exists():
        covered = subprocess.run(['openssl','x509','-in',str(CERT),'-noout','-ext','subjectAltName'],check=True,capture_output=True,text=True).stdout
    if any('DNS:' + d not in covered for d in domains):
        command = ['certbot','certonly','--webroot','-w','/var/lib/skyseo-acme','--cert-name',DOMAIN,'--non-interactive','--agree-tos','--register-unsafely-without-email','--expand']
        for domain in domains:
            command += ['-d',domain]
        subprocess.run(command,check=True,timeout=180)
    source = (ROOT / 'skyseo-landing-http.conf').read_text()
    zone, block = source.split('server {', 1)
    body = block.rsplit('}', 1)[0]
    tls = body.replace('listen 80;', 'listen 443 ssl;').replace('listen [::]:80;', 'listen [::]:443 ssl;')
    tls = tls.replace('server_name skyseo.site www.skyseo.site 85.208.85.102;', 'server_name ' + ' '.join(domains) + ';')
    tls = '\n    ssl_certificate /etc/letsencrypt/live/skyseo.site/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/skyseo.site/privkey.pem;\n    ssl_protocols TLSv1.2 TLSv1.3;\n' + tls
    direct = body.replace('server_name skyseo.site www.skyseo.site 85.208.85.102;', 'server_name 85.208.85.102;')
    redirect = '''server {
    listen 80;
    listen [::]:80;
    server_name skyseo.site www.skyseo.site;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/skyseo-acme;
        try_files $uri =404;
    }
    location / { return 301 https://skyseo.site$request_uri; }
}
'''
    result = zone + redirect + 'server {' + tls + '}\nserver {' + direct + '}\n'
    previous = TARGET.read_text()
    if previous == result:
        return
    # Atomic replacement and validation, with rollback before touching workers.
    fd, path = tempfile.mkstemp(prefix='.skyseo-landing-',dir=TARGET.parent)
    try:
        with os.fdopen(fd,'w') as file:
            file.write(result)
        os.chmod(path,0o644)
        os.replace(path,TARGET)
        checked = subprocess.run(['nginx','-t'],capture_output=True)
        if checked.returncode:
            TARGET.write_text(previous)
            raise SystemExit('SkySEO TLS: nginx validation failed; previous configuration restored')
        subprocess.run(['systemctl','reload','nginx'],check=True)
        print('SkySEO TLS certificate and HTTPS activated')
    finally:
        Path(path).unlink(missing_ok=True)

if __name__ == '__main__':
    main()
