# artbin

asset bin for game development resources. textures first, with support for other asset types and import/extraction tooling for classic game archives.

## what it does

- login + invite-code registration
- folder-based asset library with file metadata and type classification (textures, models, audio, maps, archives, etc.)
- admin import pipelines: online sources, local folder imports, archive scan/import (PAK/PK3/WAD/ZIP)
- background job queue for long-running imports and processing

## structure

```
apps/web/        # React Router web app (the main thing)
packages/core/   # shared parsers and file detection (used by web, future CLI)
```

## stack

- React Router v7 + Tailwind CSS v4
- TypeScript, Drizzle ORM + SQLite
- pnpm workspaces
- three.js for 3D model viewer

## quick start

prereqs: Node 25+, pnpm

```bash
pnpm install
just dev
```

app runs at `http://localhost:5173`.

## commands

all commands work from the repo root via `just` or `pnpm run`:

| command | what it does |
|---|---|
| `just dev` | start dev server |
| `just ci` | run format, lint, typecheck, test |
| `just format` | format all files |
| `just lint` | lint all files |
| `just test` | run tests |
| `just typecheck` | typecheck all packages |
| `just build` | build the web app |
| `just db-push` | push schema changes |
| `just db-studio` | open drizzle studio |
| `just create-admin` | create an admin user |

or use pnpm directly:

```bash
pnpm run dev
pnpm run ci
pnpm run build
pnpm run db:push
```

## docker

```bash
just docker-build
just docker-run
```

or:

```bash
docker build -f apps/web/Dockerfile -t artbin .
docker run -p 3000:3000 artbin
```
