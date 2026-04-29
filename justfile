# artbin development commands

# start the dev server
dev:
    pnpm run dev

# run the full ci pipeline (format, lint, typecheck, test)
ci:
    pnpm run ci

# format all files
format:
    pnpm run format

# check formatting without writing
check:
    pnpm run format:check

# lint all files
lint:
    pnpm run lint

# fix lint issues
lint-fix:
    pnpm run lint:fix

# run tests
test:
    pnpm run test

# typecheck all packages
typecheck:
    pnpm run typecheck

# build the web app
build:
    pnpm run build

# push database schema changes
db-push:
    pnpm run db:push

# run drizzle studio
db-studio:
    pnpm run db:studio

# run database migrations
db-migrate:
    pnpm run db:migrate

# create an admin user
create-admin:
    pnpm run --filter @artbin/web create-admin

# docker build
docker-build:
    docker build -f apps/web/Dockerfile -t artbin .

# docker run
docker-run:
    docker run -p 3000:3000 artbin

# build the cli
cli-build:
    pnpm run cli:build

# dev the cli (watch mode)
cli-dev:
    pnpm run cli:dev
