# SkySEO landing-only recovery

Emergency host: `hermes@85.208.85.102`. Existing unrelated applications stay on
their current ports. SkySEO uses a dedicated `skyseo` service account and only
loopback listeners: frontend 3018 and applications API 4018.

## Scope

Clone `holfizz/skyseo_front` into `/srv/skyseo/front` and `holfizz/skyseo_back`
into `/srv/skyseo/back`. Each repository has its own read-only GitHub deploy key
under `/srv/skyseo/.ssh/`; Git config selects that key for subsequent pulls.
GitHub host keys are obtained from the HTTPS-authenticated GitHub metadata API.

Build the frontend from main with `scripts/ops/build-landing.sh` as `skyseo`.
It sets `NEXT_PUBLIC_API_URL=/v1/api` at build time and prepares Next.js standalone
assets. Runtime Node is isolated under `/opt/skyseo-node`, avoiding changes to
other applications' NVM installations. Use official Node release checksums.

Install the versioned `skyseo-landing.service`, `skyseo-leads.service`,
`skyseo-landing-tls.service` and `.timer` into `/etc/systemd/system/`.
Install `skyseo-landing-http.conf` into
`/etc/nginx/sites-available/skyseo-landing` and link it in sites-enabled.
Run `nginx -t` before reload. Enable the landing and leads services and TLS timer.
Install `activate-landing-tls.py` and `skyseo-landing-http.conf` into the root-owned
`/usr/local/lib/skyseo-landing/` directory. The privileged TLS unit runs that
installed copy, never application-user-writable code from the Git checkout.

Root-only `/etc/skyseo-landing.env` contains **only**:

```dotenv
TELEGRAM_BOT_TOKEN=<existing website notification bot>
TELEGRAM_ADMIN_ID=<existing primary recipient>
SITE_LEAD_SECONDARY_CHAT_ID=7271373084
SKYSEO_ALLOWED_HOSTS=skyseo.site,www.skyseo.site,85.208.85.102
# Optional: verified reachable Telegram API IPv4 if the DNS-selected address fails.
SKYSEO_TELEGRAM_IPV4=149.154.167.220
```

Do not copy Telegram user sessions, the old database, CRM bot settings, payment
keys, or general backend `.env` files for this limited deployment. The full Nest
backend, outreach, admin API and background campaign workers are not started.

## Application data and delivery

`POST /v1/api/lead` preserves the current form payload `{site,telegram,auto?}` and
accepts a Telegram username/link or a phone number in the legacy `telegram` field.
Phones normalize to `+<digits>` on submission; no input mask or mode switching.
SQLite retains the same column for compatibility; notifications label phones
as phone numbers. It returns `{ok:true,id,duplicate}` only after committing the application and its
notification outbox. Site/Telegram validation is performed server-side. JSON is
limited to 4 KiB, unrelated browser origins are rejected, and nginx rate-limits
submissions. Ten-minute normalized duplicates reuse the original ID and outbox.

Applications persist in `/var/lib/skyseo-landing/leads.sqlite3`, mode 0600, with
SQLite WAL and synchronous FULL. `StateDirectory` is private (0700). No public
application listing exists. Do not log request bodies, contacts or bot tokens.

Explicit submissions notify the existing primary recipient and 7271373084;
autosaved drafts notify the primary only. Outbox delivery retries with backoff
after network/API failures and survives process restarts. A notification timeout
can lead to duplicate internal notifications; the stable application ID permits
recognition. This service never sends messages to the lead's Telegram account.
An optional Telegram IPv4 override changes only the TCP destination; HTTPS Host,
SNI and certificate validation stay `api.telegram.org`. No third-party relay is
used and TLS verification must never be disabled. Delivery uses the host's curl
HTTP/2 support, with token/payload passed through stdin and no user curl config.

Health: `GET /v1/api/health`. Inspect only aggregate application/outbox counts
with Python sqlite3, or select an individual application by its test ID.
For backups, use SQLite's backup API rather than copying an active WAL database.
Preserve this store for import into the main CRM when the original host recovers.

## DNS and HTTPS

The authoritative DNS zone must contain:

- A `skyseo.site` → `85.208.85.102`;
- A `www.skyseo.site` → `85.208.85.102`, or a CNAME to `skyseo.site`;
- no stale AAAA record pointing to an unrelated host.

Changing NS alone does not create these records. Public resolver caches may
continue showing the former Beget NS and 5.35.80.127 temporarily.

Create `/var/lib/skyseo-acme` for the HTTP challenge. The TLS timer checks every
five minutes. Once root DNS resolves exclusively to this server, it requests a
Let's Encrypt certificate through webroot, then atomically switches only this
nginx vhost to HTTPS after `nginx -t`. It adds www when that name also resolves
here. Direct HTTP access by IP remains available. Existing vhosts are untouched.
Install `skyseo-certificate-renewed.sh` as an executable deploy hook in
`/etc/letsencrypt/renewal-hooks/deploy/` and keep certbot's existing renewal timer.

## Verification

Run `python3 scripts/ops/test-landing-leads.py`: validation, concurrent duplicate
submissions, restart persistence, primary/secondary routing, delayed retry and
the HTTP contract are covered without external messages. Verify a real browser
submission against the deployed form, then independently read back its SQLite
row and both Telegram message IDs. Mark verification submissions clearly as
deployment tests. Also check mobile layout, assets and existing nginx vhosts.

Changes are made locally, committed and pushed before server pulls/install.
An emergency build can use a temporary 1 GiB swap file to protect existing
applications; remove only that task-specific swap after the build, if unused.
