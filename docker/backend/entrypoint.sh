#!/bin/sh
set -eu

if [ "${RAJESH_TICKER_DB_HOST:-}" ]; then
  python - <<'PY'
import os
import time

import psycopg2

deadline = time.time() + int(os.environ.get("DB_WAIT_TIMEOUT", "60"))
config = {
    "dbname": os.environ["RAJESH_TICKER_DB_NAME"],
    "user": os.environ["RAJESH_TICKER_DB_USER"],
    "password": os.environ["RAJESH_TICKER_DB_PASSWORD"],
    "host": os.environ["RAJESH_TICKER_DB_HOST"],
    "port": os.environ["RAJESH_TICKER_DB_PORT"],
}

while True:
    try:
        with psycopg2.connect(**config):
            break
    except psycopg2.OperationalError:
        if time.time() >= deadline:
            raise
        time.sleep(1)
PY
fi

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  python manage.py migrate --noinput
fi

if [ "${COLLECT_STATIC:-1}" = "1" ]; then
  python manage.py collectstatic --noinput
fi

exec "$@"
