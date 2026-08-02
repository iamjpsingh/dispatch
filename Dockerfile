# syntax=docker/dockerfile:1
# Dispatch — multi-stage monorepo build (Bun workspaces).
# Default entrypoint = api; the worker service overrides CMD in docker-compose.

# ---- deps: install the whole workspace once (cached) ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/tracking-worker/package.json ./apps/tracking-worker/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

# ---- web build (Vite SPA) ----
FROM deps AS web-build
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN cd apps/web && bunx vite build

# ---- runtime: api (also used by the worker service via CMD override) ----
FROM oven/bun:1 AS api
WORKDIR /app
ENV NODE_ENV=production PORT=5500
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock turbo.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# The API serves the hand-maintained OpenAPI spec at /openapi.yaml (resolved ../../docs from apps/api)
COPY docs ./docs
# Serve the built SPA from the api (static assets)
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/api
RUN mkdir -p data logs uploads
EXPOSE 5500
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:5500/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["bun", "run", "index.ts"]
