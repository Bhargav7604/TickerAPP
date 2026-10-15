#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/tickerapp}"
ENV_FILE="${ENV_FILE:-/etc/tickerapp/env}"
COMPOSE_FILE="$APP_DIR/compose.ec2.yaml"
PROJECT_NAME="tickerapp"

cd "$APP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
    exit 1
fi

if [ ! -r "$ENV_FILE" ]; then
    echo "ERROR: Environment file is missing or unreadable: $ENV_FILE" >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: Docker Compose v2 is not installed." >&2
    exit 1
fi

compose() {
    docker compose \
        --env-file "$ENV_FILE" \
        -p "$PROJECT_NAME" \
        -f "$COMPOSE_FILE" "$@"
}

echo "Validating Compose configuration..."
compose config -q

echo "Building and starting TickerAPP..."
compose up -d --build

echo "Running database migrations..."
compose run --rm backend python manage.py migrate

echo "Collecting static files..."
compose run --rm backend python manage.py collectstatic --noinput

echo "Checking backend health..."
for i in $(seq 1 30); do
    if compose exec -T backend python -c \
        "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8008/api/health/', timeout=3)" \
        >/dev/null 2>&1; then
        echo "TickerAPP backend is healthy."
        exit 0
    fi
    sleep 2
done

echo "ERROR: Backend health check failed." >&2
compose logs --tail 60 backend
exit 1
