# Index Tool

Django + React ticker dashboard for Kite Connect futures data.

## Local Setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd frontend/gui
npm ci
CI=false NODE_OPTIONS=--openssl-legacy-provider npm run build
cd ../..
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 127.0.0.1:8008
```

In a second terminal, run the shared feed and five-minute recorder:

```bash
.venv/bin/python manage.py run_market_feed
```

Keep both processes running. The browser reads cached prices from Django approximately once per second; it never receives the broker session token or opens a broker connection. The feed worker subscribes to all three contract months and spot indices, reconnects after outages, and reloads refreshed admin credentials automatically. One database lease prevents duplicate feed workers.

Open `http://127.0.0.1:8008/`.

The local SQLite database, virtualenv, logs, frontend build output, and `node_modules` are intentionally ignored. Create the admin/app user locally and add Kite API credentials in Django admin. App-user passwords are hashed; administrators can set a replacement password but cannot retrieve the old one. Leave the password blank when editing to retain it.

Migration 0018 converts existing passwords without changing what users type and expires existing app sessions. Back up the database before migrating. This migration is deliberately irreversible: restoring the backup is required to return to the old plaintext-password version.

## Docker Setup

For local builds, use:

```bash
docker compose -f compose.local.yaml up --build
```

Open `http://localhost:8008/`.

The default `compose.yaml` is production-oriented and pulls prebuilt images from ECR. Both Compose files run PostgreSQL, Django/Gunicorn, nginx, and one `market-feed` worker. Web workers do not start schedulers. The feed and web services share the instrument cache through the `market_data` volume. On startup the backend waits for Postgres, runs migrations, and collects static files.

To create a Django admin account inside the running app container:

```bash
docker compose -f compose.local.yaml exec backend python manage.py createsuperuser
```

For production deployment on EC2, use [deploy/README.md](deploy/README.md). The production stack uses default `compose.yaml`, keeps secrets in `/etc/tickerapp/env` symlinked to `.env`, binds the app to `127.0.0.1:8008`, and expects host nginx to handle public traffic/TLS.

## Email Alerts

Configure SMTP once in Django admin under `Backend > SMTP Settings`. Then enable alerts per app user from the frontend settings page by setting an alert email and lot-swing threshold.

Alert emails are sent when a new 5-minute snapshot shows net lots moving by more than the configured threshold.

Lot-swing detection and email requests currently depend on an open, signed-in dashboard. Market recording continues on the server even when all browsers are closed.

## Broker Session Security

Refresh the broker session from Admin > Kite Settings, using the same hostname for the admin page and the registered callback URL. The callback requires the initiating admin session and a matching, single-use state valid for ten minutes. App-user endpoints cannot read or replace the broker credentials or upload shared snapshots. Rotate the broker access token when upgrading from versions that exposed it to browsers.
