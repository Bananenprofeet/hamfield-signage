# Simulated signage device: runs the real agent + serves the real player UI,
# so you can watch playback in a browser at http://localhost:8081.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install
RUN pnpm --filter "@signage/mock-device..." build
RUN pnpm --filter @signage/player build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
ENV SIGNAGE_PLAYER_UI_DIR=/app/apps/player/dist
ENV MOCK_DEVICE_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
CMD ["node", "apps/mock-device/dist/main.js"]
