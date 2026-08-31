FROM node:25-bookworm-slim AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11.9.0
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run --filter @artbin/web build

FROM node:25-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends imagemagick \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11.9.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/packages/core/package.json packages/core/
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && pnpm install --frozen-lockfile --prod \
    && pnpm --filter @artbin/web exec playwright install --with-deps --no-shell chromium \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/packages/core/src packages/core/src
COPY --from=build /app/apps/web/app apps/web/app
COPY --from=build /app/apps/web/src apps/web/src
COPY --from=build /app/apps/web/server.ts apps/web/server.ts
COPY --from=build /app/apps/web/tsconfig.json apps/web/tsconfig.json
COPY --from=build /app/apps/web/drizzle apps/web/drizzle
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app/apps/web
RUN mkdir -p data public/uploads tmp/uploads \
    && chown -R node:node data public/uploads tmp/uploads
USER node
EXPOSE 3000
CMD ["pnpm", "run", "start"]
