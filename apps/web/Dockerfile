FROM node:25-alpine AS build
RUN apk add --no-cache python3 make g++ \
    && npm install -g pnpm@11.9.0
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run --filter @artbin/web build

FROM node:25-alpine
RUN apk add --no-cache imagemagick \
    && npm install -g pnpm@11.9.0
WORKDIR /app
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/packages/core/package.json packages/core/
RUN apk add --no-cache --virtual .native-build-deps python3 make g++ \
    && pnpm install --frozen-lockfile --prod \
    && apk del .native-build-deps
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
RUN mkdir -p public/uploads tmp/uploads
EXPOSE 3000
CMD ["pnpm", "run", "start"]
