# syntax=docker/dockerfile:1
# Pinned to a Node 22 LTS patch release on Debian bookworm (glibc) so the prebuilt
# better-sqlite3 and @node-rs/argon2 binaries are used.

FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
# Build tools are only a fallback if a native prebuild is unavailable for the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
RUN npm run build \
 && npm prune --omit=dev

FROM node:22.23.1-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATABASE_PATH=/data/dashboard.db \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/server/index.js"]
