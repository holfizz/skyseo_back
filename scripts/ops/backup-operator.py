#!/usr/bin/env python3
"""Root-owned same-host backup; no notifications or remote mirror."""
from datetime import datetime, timezone
from pathlib import Path
import os
import subprocess
import shutil

root = Path('/var/backups/skyseo-operator')
root.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(root, 0o700)
folder = root / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
folder.mkdir(mode=0o700)
archive = folder / 'database.dump'
try:
    with archive.open('xb') as out:
        subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-p', '5432', '-Fc', 'skyseo_operator_20261109'], stdout=out, check=True)
    os.chmod(archive, 0o600)
    shutil.copyfile('/etc/skyseo-operator.env', folder / 'operator.env')
    os.chmod(folder / 'operator.env', 0o600)
    subprocess.run(['pg_restore', '--list', str(archive)], check=True, stdout=subprocess.DEVNULL)
    print('Same-host operator backup verified')
except Exception:
    print('Backup incomplete; inspect ' + str(folder))
    raise
