# frontend image — the Vite SPA is built ON THE HOST (bun run build) and the
# static dist/ is copied in here, served by nginx. The nginx config proxies
# /api/tasks-rs/ to the backend-rs container. See deploy/build.sh.
FROM docker.io/library/nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf

# Prebuilt SPA (copied from deploy/web/ by build.sh)
COPY web/ /usr/share/nginx/html/

# Compose-specific nginx config (NOT apps/frontend/nginx.conf, which targets the
# legacy Bun backend + the wider sedjiwa ecosystem).
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
