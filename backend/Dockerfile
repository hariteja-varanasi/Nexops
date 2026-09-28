# =====================================================================
# NexOps backend image
# Multi-stage: the deps stage installs production modules only, the final
# stage copies them in. Nothing from the build toolchain reaches runtime.
# =====================================================================

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# npm ci installs exactly what the lockfile says - reproducible across machines.
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime
WORKDIR /app

# dumb-init makes PID 1 forward SIGTERM properly, so `kubectl delete pod`
# reaches the graceful shutdown handler in src/server.js instead of killing
# the container after the 30s grace period.
RUN apk add --no-cache dumb-init curl

ENV NODE_ENV=production \
    PORT=4000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

# node:alpine ships an unprivileged `node` user (uid 1000). Run as that, never root.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# Container-level check. Kubernetes uses its own probes (see the Deployment);
# this one is for `docker compose ps` and plain `docker run`.
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
