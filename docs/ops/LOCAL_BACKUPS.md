# Local SkySEO backups

The primary server `5.35.80.127` owns the scheduled backup. The retired mirror
`109.107.173.48` must not pull the database or send mirror health notifications.
The Telegram outreach digest is independent and remains enabled.

## Primary server

Versioned script: `scripts/ops/local-backup.sh`. Deployed entry point:
`/home/skyseo/backups/backup.sh` (root, mode 0700).

The existing **root** crontab entry stays unchanged:

```cron
0 3 * * * /home/skyseo/backups/backup.sh >> /home/skyseo/backups/backup.log 2>&1
```

The host timezone is UTC: this is **06:00 Europe/Moscow** every day. Sunday also
creates a weekly copy. Daily filenames use UTC. Retention preserves the old
`find -mtime +7` / `-mtime +28` policy; named manual snapshots are not removed.

The script dumps `skyseo_db` via PostgreSQL's local Unix socket as `postgres`.
It archives the dump and both application source directories, including their
local configuration. It excludes dependencies, generated builds and Git data.
The manifest records creation time, PostgreSQL client version and Git revisions.
It does not copy anything to another server or send Telegram notifications.

The backup uses a nonblocking process lock, checks the dump table of contents,
checks gzip/tar integrity, then atomically publishes a private archive. A failed
run leaves previous complete archives intact and exits nonzero into backup.log.
Partial files from the current run are removed on exit. A full restore test is
still needed after significant schema/PostgreSQL changes.

### Deploy from the repository

Make changes locally, commit and push first; on the server:

```bash
cd /home/skyseo/skyseo_back
git pull --ff-only
sudo install -m 0700 scripts/ops/local-backup.sh /home/skyseo/backups/backup.sh
sudo chmod 0700 /home/skyseo/backups /home/skyseo/backups/daily /home/skyseo/backups/weekly
sudo find /home/skyseo/backups/daily /home/skyseo/backups/weekly -maxdepth 1 -type f -name '*.tar.gz' -exec chmod 0600 {} +
sudo /home/skyseo/backups/backup.sh
```

This changes the host backup job only. No application rebuild/restart or
database migration is required. Do not print or export archived `.env` contents.

### Verify restoration

Check the archive CRC and restore `db_skyseo.dump` into a **new, isolated**
database using `pg_restore --exit-on-error --single-transaction --no-owner
--no-privileges`. Run SQL row-count checks against the restored tables, then drop
only that temporary database. Never run a verification restore against
`skyseo_db`, never start application schedulers on the restored copy, and never
print data or credentials. The production database must remain untouched.

## Retired mirror jobs

The old server had these independent jobs:

- `skyseo-backup.timer`: remote `pg_dump` over the primary's public port 5432;
- `skyseo-health.timer`: mirror disk/RAM/backup-age alerts.

Retire them with service management, not by changing application source files:

```bash
systemctl disable --now skyseo-backup.timer skyseo-health.timer
systemctl stop skyseo-backup.service skyseo-health.service
systemctl show skyseo-backup.timer skyseo-health.timer -p Id -p ActiveState -p UnitFileState
```

Both timers must be `inactive` and `disabled`, including after reboot. Keep
existing mirror archives; this task does not delete them or stop its web server.
