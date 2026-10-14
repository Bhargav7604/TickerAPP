# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY frontend/gui/package*.json ./
RUN npm ci

COPY frontend/gui/ ./
ENV CI=false
ENV NODE_OPTIONS=--openssl-legacy-provider
RUN npm run build


FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 8080
