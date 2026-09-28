# Docker

## What is it

A way to package an application with everything it needs to run — runtime,
libraries, files — into one image that behaves identically wherever it runs.

## Why NexOps uses it

Kubernetes schedules containers. Without an image there is nothing to deploy.
More usefully: the image that passes the tests in CI is bit-for-bit the image
that reaches production, so "works on my machine" stops being a category of bug.

## The two images

| | backend | frontend |
|---|---|---|
| Builder stage | `node:22-alpine`, `npm ci --omit=dev` | `node:22-alpine`, `npm run build` |
| Runtime stage | `node:22-alpine` | `nginx:1.27-alpine` |
| Runs as | `node` (uid 1000) | `nginx` (uid 101) |
| Port | 4000 | 8080 |
| Final size | ~180 MB | ~55 MB |

The frontend's runtime image contains **no Node.js at all**. Vite produces
static files; serving them needs a web server, not a JavaScript runtime. That
one decision removes the entire npm dependency tree from the attack surface.

## Multi-stage builds

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci                    # ← layer cached until the lockfile changes
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
```

Two details worth copying:

**Copy the lockfile before the source.** Docker caches layers and invalidates
everything after the first change. Source changes far more often than
dependencies, so copying `package*.json` first means `npm ci` is re-run only
when dependencies actually change — the difference between a 4-second and a
90-second rebuild.

**`npm ci`, not `npm install`.** `ci` installs exactly the lockfile and fails if
`package.json` disagrees with it. `install` will quietly resolve a new version,
so the same Dockerfile can produce different images on different days.

## Running as non-root

```dockerfile
USER node
```

If someone escapes the application, they land as an unprivileged user rather
than root. The frontend takes this further: because NGINX runs as `nginx`, it
cannot bind port 80 at all, so the container listens on 8080 and the Service
maps 80 → 8080.

## dumb-init

```dockerfile
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
```

PID 1 in Linux does not get default signal handling. Without an init shim, the
`SIGTERM` that `kubectl delete pod` sends is ignored, the graceful shutdown in
`src/server.js` never runs, and the container is killed 30 seconds later
mid-request. `dumb-init` forwards the signal so shutdown works.

## Commands

```bash
# Build
docker build -t nexops-backend:local ./backend
docker build -t nexops-frontend:local ./frontend

# Inspect
docker images | grep nexops
docker history nexops-backend:local          # per-layer size
docker inspect nexops-backend:local | jq '.[0].Config.User'   # → "node"

# Run one container by hand
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgresql://nexops:pw@host.docker.internal:5432/nexops \
  -e JWT_SECRET=dev-secret \
  nexops-backend:local

# Shell into a running container
docker compose exec backend sh
docker compose logs -f backend

# Scan it
trivy image nexops-backend:local --severity HIGH,CRITICAL
```

## Exercise

1. Build both images and note the sizes.
2. Change one line in `frontend/src/pages/Dashboard.jsx`, rebuild, and watch
   which layers say `CACHED`.
3. Now change `frontend/package.json` and rebuild. More layers rebuild. Explain
   why, using the layer-caching rule above.
4. Run `docker history nexops-frontend:local`. Find the largest layer.
5. Prove the frontend image has no Node:
   `docker run --rm nexops-frontend:local node --version` → `not found`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `permission denied` on the Docker socket | Not in the `docker` group | `sudo usermod -aG docker $USER && newgrp docker` |
| Build cannot resolve hostnames | Docker DNS | `sudo systemctl restart docker` |
| `npm ci` fails: lockfile out of sync | `package.json` edited without `npm install` | Run `npm install` locally and commit the lockfile |
| Frontend container exits immediately | envsubst could not write the config | Check `/etc/nginx/conf.d` is writable by uid 101 |
| Image builds but the app cannot reach the DB | `localhost` inside a container is the container | Use the service name, `postgres`, not `localhost` |
