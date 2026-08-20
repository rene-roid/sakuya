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
EXPOSE 3777
CMD ["bun", "src/index.ts"]
