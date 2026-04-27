# artbin

artbin is an asset bin for game development resources.

it is focused on textures first, with support for other asset types and import/extraction tooling for classic game archives.

## what it does

- login + invite-code registration
- folder-based asset library
- file metadata and type classification (textures, models, audio, maps, archives, etc.)
- admin import pipelines:
  - misc. online sources
  - local folder imports
  - local archive scan/import (PAK/PK3/WAD/ZIP)
- background job queue for long-running imports and processing

## stack

- React Router v7
- TypeScript
- Tailwind CSS v4
- Drizzle ORM + SQLite (`better-sqlite3`)
- three.js (viewer-related UI)

## quick start

prereqs: Node 25+, pnpm

```bash
pnpm install
pnpm run build
pnpm run dev
```

app runs at `http://localhost:5173` in dev mode.

## Scripts

```bash
pnpm run dev
pnpm run build
pnpm run start
pnpm run typecheck
pnpm run db:push
pnpm run db:studio
pnpm run create-admin
```

## Docker

```bash
docker build -t artbin .
docker run -p 3000:3000 artbin
```
