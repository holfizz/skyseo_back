# Internal CRM recovery on the emergency host

This restores a NEW operator database, not the unavailable former database. Existing Telegram sessions and local enrichment secrets must not be transferred. Website requests continue through the dedicated landing intake.

- Frontend: existing `skyseo-landing`, loopback 3018.
- Internal API: `skyseo-operator`, loopback 4019, `SKYSEO_RUNTIME=operator`.
- Database: dedicated `skyseo_operator_20261109` and role of the same name on PostgreSQL port 5432. Other databases remain untouched.
- Required server-only configuration: DATABASE_URL, SKYSEO_BOOTSTRAP_DATABASE, JWT_SECRET, SECRETS_KEY. Generate new random keys; retain the encryption key for all future Telegram sessions. Never commit these values.
- Admin provisioning accepts a bcrypt cost-12 hash on stdin; the plaintext password is not placed in repository files, server arguments or logs. It refuses any database that already contains users.

## Fresh database migrations

The historical migrations cannot be replayed unchanged on an empty database: the epoch-named migration `1780430548_add_app_tracking` sorts before the initial users table. Do not rename historical migrations or use `db push`.

`prisma/bootstrap/20261109_operator.sql` is a reviewed migration from an empty database to the current Prisma model. It also retains the two SQL-only conversation CHECK constraints. Its manifest fixes the schema and all 102 historical migration checksums.

Run `node scripts/ops/bootstrap-operator.cjs --apply` ONLY with explicit DATABASE_URL and SKYSEO_BOOTSTRAP_DATABASE environment values, matching the dedicated new local database. It refuses pre-existing application tables. It applies the schema transactionally, checks live schema equality, baselines the historical migration records using Prisma `migrate resolve`, and verifies `migrate deploy`. If interrupted before application data exists, `--apply --resume` checks schema and empty tables before resuming missing history records. Future migrations use normal `prisma migrate deploy`.

Do not run demo seeds: this must start without example clients, Telegram accounts, campaigns or sends. The API starts the existing operator modules, excluding retired executor/payment/AI application modules; missing AI-provider credentials cannot block the internal login.

## Deployment

Commit locally, push main, pull on the host, then use `scripts/ops/build-operator.sh` as user skyseo. Install the service and the nginx template from the versioned checkout. Root-executed provisioning/TLS helpers must first be installed root-owned under `/usr/local/lib`, never executed with root directly from an app-writable checkout. The TLS helper's installed template must be updated too, so its timer preserves the operator routes.

The admin UI and API use HTTPS. Keep public registration and retired customer application routes closed. Uploaded account archives require a larger body limit on the authenticated operator API; keep the 4 KiB limit on the public lead form.
