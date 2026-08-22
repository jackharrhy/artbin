# artbin

asset bin for game development resources. textures first, with support for other asset types and import/extraction tooling for classic game archives.

## what it does

- login + invite-code registration
- folder-based asset library with file metadata and type classification (textures, models, audio, maps, archives, etc.)
- admin import pipelines: online sources, local folder imports, archive scan/import (PAK/PK3/WAD/ZIP)
- site imports from GameBanana, SCMapDB, and direct ZIP, 7z, or RAR URLs
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

The development server automatically uses a database-backed local admin account, so 4orm is not
required for local work. Set `ARTBIN_REQUIRE_AUTH=1` when starting the server if you need to test the
production OAuth flow.

## site imports

Open a folder's **Upload** dialog (or **Admin → Import** for the full-page interface), paste one or
more GameBanana or SCMapDB page URLs or direct HTTPS archive URLs, and choose the folder that should
contain the imported collections. The background importer:

- preserves the map's source URL, author, game, and source metadata;
- streams provider downloads only from trusted file hosts and restricts direct links to public
  HTTPS destinations;
- verifies GameBanana file sizes and MD5 checksums when supplied;
- safely inspects ZIP, 7z, and RAR files with entry-count and expanded-size limits;
- skips executables, HTML, host scripts, and unknown file types; and
- extracts embedded BSP textures and WAD2/WAD3 textures into browsable PNG subfolders.

Re-importing the same source into the same destination is idempotent: existing asset paths are
kept, while newly added paths are imported.

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
