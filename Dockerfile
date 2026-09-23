# syntax=docker/dockerfile:1

# Debian-based (not alpine): onnxruntime-node ships glibc-only prebuilt bindings.
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

FROM deps AS web-build
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN bun run --cwd apps/web build

FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

FROM deps AS server
COPY apps/server apps/server
COPY packages/shared packages/shared
WORKDIR /app/apps/server
ENV NODE_ENV=production
# Settings come from sakuya.config.json, mounted at /app/sakuya.config.json by docker-compose.yml.
# SAKUYA_DOCKER is what lets SAKUYA_* environment variables override it — only inside this image.
# The three pinned here are container plumbing the file can't know about:
#   - host: loopback would make the published port unreachable; the container boundary is the isolation
#   - port: docker/nginx.conf proxies to server:3777
#   - data dir: wherever the host keeps it, it is mounted at /data
ENV SAKUYA_DOCKER=1 \
    SAKUYA_HOST=0.0.0.0 \
    SAKUYA_PORT=3777 \
    SAKUYA_DATA_DIR=/data
EXPOSE 3777

# /api/health is registered before requireAuth in src/index.ts, so this keeps working with auth on.
# Shell form on purpose: $SAKUYA_PORT is expanded at run time, not build time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.SAKUYA_PORT ?? 3777) + '/api/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "src/index.ts"]
