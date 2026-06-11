# Media processing worker — needs FFmpeg for probing, transcoding and thumbnails.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install
RUN pnpm --filter @signage/database generate
RUN pnpm --filter "@signage/worker..." build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/main.js"]
