# Production Docker Deploy

This layout is intended for the current EC2 style: host nginx terminates public HTTP/HTTPS and proxies to a Docker Compose stack bound to `127.0.0.1:8008`.

The default `compose.yaml` pulls prebuilt images from private ECR. It does not build on the server. GitHub Actions runs these commands automatically through AWS SSM after images are pushed:

```bash
docker compose pull
docker compose up -d
```

You can run the same command manually from `/opt/tickerapp` if you need to redeploy.

## Files

- `compose.yaml`: production Compose stack that pulls Postgres, Django/Gunicorn backend, and nginx frontend images from ECR.
- `compose.local.yaml`: local build-only Compose file for developer machines.
- `docker/backend/Dockerfile`: non-root Python runtime image.
- `docker/frontend/Dockerfile`: React build served by unprivileged nginx.
- `docker/postgres/Dockerfile`: pinned Postgres base image.
- `deploy/systemd/tickerapp-docker.service`: starts/stops the Compose stack.
- `deploy/nginx/tickerapp.conf`: host nginx reverse proxy.

## Server Setup

Install Docker and the Compose plugin on the server, then place the app at:

```bash
/opt/tickerapp
```

Bootstrap Docker, the ECR credential helper, and the env symlink:

```bash
sudo mkdir -p /etc/tickerapp
sudo /opt/tickerapp/deploy/scripts/bootstrap-runtime.sh
sudo vi /etc/tickerapp/env
```

Use real values for `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `ECR_REGISTRY`, and `POSTGRES_PASSWORD`.

After the GitHub Actions workflow has pushed images to ECR, deploy or update with:

```bash
cd /opt/tickerapp
sudo docker compose up -d
```

Install and start the systemd unit:

```bash
sudo cp /opt/tickerapp/deploy/systemd/tickerapp-docker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tickerapp-docker
```

Install nginx proxy config:

```bash
sudo cp /opt/tickerapp/deploy/nginx/tickerapp.conf /etc/nginx/sites-available/tickerapp
sudo ln -sfn /etc/nginx/sites-available/tickerapp /etc/nginx/sites-enabled/tickerapp
sudo nginx -t
sudo systemctl reload nginx
```

## Operations

Before upgrading to migration 0018, back up Postgres. Existing app passwords are converted to hashes and users must sign in again with their existing passwords. Do not roll back to the plaintext-password code without restoring a matching backup.

The stack now includes a single `market-feed` service using the backend image. It owns the broker connection and snapshot scheduler; the three Gunicorn workers only serve requests. Keep the shared `market_data` volume mounted in both backend and market-feed. Do not run a separate legacy snapshot scheduler alongside it.

After upgrading, refresh the broker token in admin to invalidate tokens exposed by older versions. Initiate and complete OAuth on the same hostname. Verify that `market-feed` is running and that signed-in requests to `/api/market-data/` return quote data without API keys or access tokens.

Check stack status:

```bash
sudo systemctl status tickerapp-docker
cd /opt/tickerapp && sudo docker compose ps
```

Read logs:

```bash
cd /opt/tickerapp && sudo docker compose logs -f backend
```

Create the first Django superuser:

```bash
cd /opt/tickerapp && sudo docker compose exec backend python manage.py createsuperuser
```

Backup Postgres:

```bash
cd /opt/tickerapp && sudo docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > tickerapp.sql
```
