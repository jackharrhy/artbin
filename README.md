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
apps/cli/        # installable CLI for local imports and server folder management
packages/core/   # shared parsers and file detection
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
- extracts embedded BSP textures and exposes WAD2/WAD3 contents as virtual folders at their
  original paths, with file-like pages for individual textures.

Re-importing the same source into the same destination is idempotent: existing asset paths are
kept, while newly added paths are imported.

## CLI

Build and install the repository version locally:

```bash
just cli-install
artbin login
```

The CLI defaults to the production server. Pass a server URL to `artbin login` to use another
instance. Automated and local test environments can provide `ARTBIN_SERVER_URL` and
`ARTBIN_SESSION_ID` instead of writing a config file.

```bash
artbin scan <path>
artbin import <path> [--folder <slug>] [--dry-run]
artbin add <path> [--folder <slug>] [--dry-run]

artbin folders list [--tree] [--all] [--json]
artbin folders show <slug> [--json]
artbin pull <slug> [destination] [--force] [--json]
artbin folders rename <slug> <new-name> [--dry-run] [--yes] [--json]
artbin folders move <slug> --to <destination-or-root> [--dry-run] [--yes] [--json]
```

All authenticated users can inspect public folders and download folder ZIPs. Uploads from regular
users go through the review inbox. Creating, renaming, and moving folders requires an administrator
account. Folder mutations show a server-generated preview before confirmation; use `--dry-run` to
inspect it without making changes.

### Publishing the CLI

CLI releases are published from `apps/cli`. Prepare and push the version change first, then run:

```bash
cd apps/cli
npm login
pnpm run release
```

The release command requires a clean Git checkout, reruns CLI checks, shows the npm package dry run,
asks for confirmation, publishes the current version, and pushes its `artbin@<version>` Git tag.

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
