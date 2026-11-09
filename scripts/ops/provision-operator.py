#!/usr/bin/env python3
"""Install root-owned before running. Creates only the dedicated operator DB/config."""
from pathlib import Path
import os
import secrets
import subprocess
from urllib.parse import quote, urlsplit

DATABASE = 'skyseo_operator_20261109'
ROLE = DATABASE
ENV_FILE = Path('/etc/skyseo-operator.env')

def sql(command):
    return subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-p', '5432', '-d', 'postgres'], input=command, text=True, capture_output=True, check=True).stdout.strip()

def main():
    if os.geteuid() != 0:
        raise SystemExit('Run the installed root-owned provisioning helper as root')
    exists_db = sql(f"SELECT 1 FROM pg_database WHERE datname = '{DATABASE}';") == '1'
    exists_role = sql(f"SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}';") == '1'
    if ENV_FILE.exists():
        env = dict(line.split('=', 1) for line in ENV_FILE.read_text().splitlines() if '=' in line and not line.startswith('#'))
        if env.get('SKYSEO_BOOTSTRAP_DATABASE') != DATABASE or urlsplit(env.get('DATABASE_URL', '')).path != '/' + DATABASE:
            raise SystemExit('Existing environment targets a different database; refusing to change it')
        if not (exists_db and exists_role):
            raise SystemExit('Existing configuration is incomplete; inspect it before retrying')
        probe = subprocess.run(['psql', '-X', '-At', '-h', '127.0.0.1', '-p', '5432', '-U', ROLE, '-d', DATABASE, '-c', 'SELECT 1'], env={**os.environ, 'PGPASSWORD': urlsplit(env['DATABASE_URL']).password}, capture_output=True, text=True)
        if probe.returncode or probe.stdout.strip() != '1':
            raise SystemExit('Existing database credentials do not match; no password was changed')
        print('Existing dedicated operator configuration verified')
        return
    if exists_db or exists_role:
        raise SystemExit('Dedicated database or role already exists without its environment; refusing to overwrite')
    password = secrets.token_urlsafe(32)
    env = {
        'NODE_ENV': 'production', 'NODE_OPTIONS': '--max-old-space-size=512', 'SKYSEO_RUNTIME': 'operator', 'HOST': '127.0.0.1', 'PORT': '4019',
        'DATABASE_URL': f'postgresql://{ROLE}:{quote(password, safe="")}@127.0.0.1:5432/{DATABASE}?schema=public',
        'SKYSEO_BOOTSTRAP_DATABASE': DATABASE,
        'JWT_SECRET': secrets.token_hex(32), 'JWT_EXPIRES_IN': '7d',
        'SECRETS_KEY': secrets.token_hex(32), 'FRONTEND_URL': 'https://skyseo.site',
    }
    # The password alphabet contains no SQL quote characters; identifiers are constants.
    sql(f'CREATE ROLE "{ROLE}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD \'{password}\';')
    sql(f'CREATE DATABASE "{DATABASE}" OWNER "{ROLE}";')
    fd = os.open(ENV_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as target:
        target.write(''.join(f'{key}={value}\n' for key, value in env.items()))
    os.chmod(ENV_FILE, 0o600)
    state = Path('/var/lib/skyseo-operator')
    state.mkdir(mode=0o700, exist_ok=True)
    subprocess.run(['chown', 'skyseo:skyseo', str(state)], check=True)
    print('Created dedicated operator database and root-only environment; secrets were not printed')

if __name__ == '__main__':
    main()
