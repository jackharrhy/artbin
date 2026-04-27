FROM node:25-alpine AS build
RUN npm install -g pnpm
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run --filter @artbin/web build

FROM node:25-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/packages/core/ packages/core/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/apps/web/build apps/web/build
WORKDIR /app/apps/web
CMD ["pnpm", "run", "start"]
