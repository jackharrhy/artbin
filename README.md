# artbin

artbin is a private, invite-only asset bin for game development resources.

It is focused on textures first, with support for other asset types and import/extraction tooling for classic game archives.

## What it does

- Private login + invite-code registration
- Folder-based asset library
- File metadata and type classification (textures, models, audio, maps, archives, etc.)
- Admin import pipelines:
  - TextureTown
  - Texture Station
  - Sadgrl tiled backgrounds
  - local folder imports
  - local archive scan/import (PAK/PK3/WAD/ZIP)
- Background job queue for long-running imports and processing

## Stack

- React Router v7
- TypeScript
- Tailwind CSS v4
- Drizzle ORM + SQLite (`better-sqlite3`)
- three.js (viewer-related UI)

## Quick start

Prereqs: Node 25+, pnpm

```bash
pnpm install
pnpm run build
pnpm run dev
```

App runs at `http://localhost:5173` in dev mode.

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

## Project notes

See `PROJECT.md` for roadmap and design goals.
