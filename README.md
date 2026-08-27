# artbin

asset bin for game development resources. textures first, with support for other asset types and import/extraction tooling for classic game archives.

## what it does

- 4orm OAuth login, with an automatic local administrator in development
- folder-based asset library with file metadata and type classification (textures, models, audio, maps, archives, etc.)
- admin import pipelines: online sources, local folder imports, archive scan/import (PAK/PK3/WAD/ZIP)
- site imports from GameBanana, SCMapDB, and direct ZIP, 7z, or RAR URLs
- background job queue for long-running imports and processing

## structure

```
apps/web/        # Remix 3 web app and API (the main thing)
apps/cli/        # installable CLI for local imports and server folder management
packages/core/   # shared parsers and file detection
```

## stack

- Remix 3 beta with its native server router and UI runtime
- Node.js HTTP server + Tailwind CSS v4
- TypeScript, Drizzle ORM + SQLite
- pnpm workspaces
- three.js for 3D model previews and `@jackharrhy/worldview` for WebGPU BSP previews

## quick start

prereqs: Node 25+, pnpm

```bash
pnpm install
just dev
```

The app runs at `http://localhost:5175`. Remix's development runner handles server and browser-module
hot updates. Use `pnpm --filter @artbin/web run dev:watch` if you want the simpler Node watch mode.

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

## BSP previews

Quake BSP29 and GoldSrc BSP30 files open in an interactive Worldview preview. For external textures,
Artbin first looks for a matching WAD in the same imported collection as the BSP. It then falls back
to the private site asset directory at `data/bsp-assets`, searched recursively by basename. Quake
BSP29 maps use the same lookup for `palette.lmp`.

A production library can therefore use a layout such as:

```text
data/bsp-assets/
  quake/palette.lmp
  goldsrc/halflife.wad
  cstrike/cstrike.wad
```

Set `ARTBIN_BSP_ASSET_DIR` to use another directory. These game assets are intentionally not bundled
with Artbin or Worldview; the operator must provide assets they are permitted to host. The resolver
routes are authenticated, and uploaded WADs outside the BSP's collection are not used as global
fallbacks.

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

The web build compiles its stylesheet and verifies the server-first TypeScript source. Remix serves
browser modules from the source asset graph, so there is no separate client bundle directory.

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
