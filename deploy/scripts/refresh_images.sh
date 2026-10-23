#!/bin/sh
set -eu

# Pull latest images from ECR and prepare for compose restart.
APP_DIR=${APP_DIR:-/opt/tickerapp}
ENV_FILE=${ENV_FILE:-/etc/tickerapp/env}
ECR_REGISTRY=${ECR_REGISTRY:-""}
IMAGE_TAG=${IMAGE_TAG:-latest}

cd "$APP_DIR"

echo "Refreshing images from ECR..."
if [ -n "$ECR_REGISTRY" ]; then
  # Compose file in repo uses env vars like ${ECR_REGISTRY}/... so ensure .env has ECR_REGISTRY set
  export ECR_REGISTRY="$ECR_REGISTRY"
fi

# Ensure .env is present (AppSpec files copied to $APP_DIR already)
if [ -f "$ENV_FILE" ]; then
  ln -sfn "$ENV_FILE" "$APP_DIR/.env" || true
fi

# Pull images referenced in docker-compose
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose pull || true
else
  # newer docker CLI uses docker compose
  docker compose pull || true
fi

echo "Images refreshed."