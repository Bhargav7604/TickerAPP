#!/bin/sh
set -eu

APP_DIR=${APP_DIR:-/opt/tickerapp}
ENV_FILE=${ENV_FILE:-/etc/tickerapp/env}

cd "$APP_DIR"

# Ensure .env is linked
if [ -f "$ENV_FILE" ]; then
  ln -sfn "$ENV_FILE" "$APP_DIR/.env"
fi

echo "Starting docker-compose stack..."
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d --remove-orphans
else
  docker compose up -d --remove-orphans
fi

echo "Running Django migrations and collectstatic (if a backend service exists)..."

# Run migrations if backend service exists in compose
if docker ps -a --format '{{.Names}}' | grep -q backend >/dev/null 2>&1 || true; then
  # run migrations in a temporary container (compose run)
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose run --rm backend python manage.py migrate || true
    docker-compose run --rm backend python manage.py collectstatic --noinput || true
  else
    docker compose run --rm backend python manage.py migrate || true
    docker compose run --rm backend python manage.py collectstatic --noinput || true
  fi
fi

echo "Application started."