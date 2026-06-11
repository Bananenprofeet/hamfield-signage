# Admin dashboard — static build served by nginx, which also proxies /api
# to the backend so the browser only ever talks to one origin.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install
RUN pnpm --filter "@signage/web..." build

FROM nginx:1.27-alpine
COPY infra/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
