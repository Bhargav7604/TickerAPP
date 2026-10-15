#!/bin/sh
set -eu

APP_DIR=${APP_DIR:-/opt/tickerapp}
ENV_FILE=${ENV_FILE:-/etc/tickerapp/env}
COMPOSE_FILE="$APP_DIR/compose.ec2.yaml"
PROJECT_NAME="tickerapp"

cd "$APP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: Environment file not found: $ENV_FILE" >&2
    exit 1
fi

ln -sfn "$ENV_FILE" "$APP_DIR/.env"

if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: Docker Compose v2 is not installed." >&2
    exit 1
fi

echo "Validating $COMPOSE_FILE..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" config -q

echo "Building and starting TickerAPP..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d --build

echo "Running database migrations..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" run --rm backend python manage.py migrate

echo "Collecting static files..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" run --rm backend python manage.py collectstatic --noinput

echo "TickerAPP deployment completed."
