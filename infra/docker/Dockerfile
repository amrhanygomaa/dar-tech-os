# syntax=docker/dockerfile:1.7

FROM node:24.19.0-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/types/package.json ./packages/types/package.json

RUN npm ci --ignore-scripts --cache /tmp/npm-cache && rm -rf /tmp/npm-cache

FROM dependencies AS build
COPY . .
ENV DATABASE_URL=postgresql://validation:validation@127.0.0.1:5432/dartech_validation?schema=public
RUN npm run build

FROM dependencies AS migrate
COPY . .
RUN chown -R node:node /app/node_modules/@prisma /app/node_modules/prisma
ENV HOME=/tmp \
    NODE_ENV=production \
    NPM_CONFIG_CACHE=/tmp/npm-cache
USER node
CMD ["npm", "run", "db:migrate:deploy"]

FROM node:24.19.0-bookworm-slim AS production-dependencies
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/types/package.json ./packages/types/package.json

RUN npm ci --omit=dev --ignore-scripts --cache /tmp/npm-cache && rm -rf /tmp/npm-cache

FROM node:24.19.0-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/packages ./packages
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM node:24.19.0-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /app/packages ./packages
COPY --chown=node:node infra/docker/check-worker-health.mjs ./infra/docker/check-worker-health.mjs
USER node
CMD ["node", "apps/worker/dist/main.js"]

FROM node:24.19.0-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
CMD ["node", "apps/web/server.js"]
