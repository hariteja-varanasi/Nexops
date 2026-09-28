# =====================================================================
# NexOps frontend image
# Stage 1 builds the React bundle with Vite. Stage 2 serves the static
# output with NGINX - the final image contains no Node.js at all.
# =====================================================================

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Baked in at build time because Vite inlines env vars into the bundle.
# Left empty by default so the browser calls /api on its own origin.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache curl
# The official nginx image runs envsubst over /etc/nginx/templates/*.template
# at startup, so the backend address is configurable per environment without
# rebuilding the image.
ENV BACKEND_HOST=backend \
    BACKEND_PORT=4000
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# Run NGINX as the unprivileged `nginx` user. That means it cannot bind port 80,
# so the container listens on 8080 and the Service maps 80 -> 8080.
RUN touch /var/run/nginx.pid \
 && chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /usr/share/nginx/html \
                          /etc/nginx/conf.d /etc/nginx/templates
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
