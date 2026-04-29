# CLI Tool + Batch Upload API Design

**Goal:** Build a CLI tool (`apps/cli`) that scans local game directories, parses archives, and uploads extracted files to the artbin server over HTTP. Add server-side API endpoints to support batch uploads with resumability.

**Context:** Sub-project 2 of 3. The monorepo restructure (sub-project 1) is complete -- `@artbin/core` already has buffer-based archive parsers, BSP extraction, file detection, and filename utilities. This work builds the CLI consumer of that shared code and the server API it talks to. Sub-project 3 (contribution/approval workflow for non-admin users) comes after.

## Decisions

- **Auth:** OAuth device flow via existing 4orm provider. CLI opens browser, user logs in, server redirects to localhost callback. CLI stores a regular 30-day session (same as web). Admin-only access for now.
- **Resumability:** Manifest-then-upload. CLI sends a file manifest (paths + content hashes), server responds with which files are new, CLI uploads only those. Re-run to resume after interruption.
- **Processing:** Server handles everything -- image previews, BSP texture extraction from uploaded BSP files, DB writes. CLI stays thin.
- **Archive handling:** CLI extracts archive contents locally using `@artbin/core` parsers, uploads individual files. Better for resumability and per-file dedup.
- **CLI workflow:** Two-step: `artbin scan` for discovery, `artbin import` for upload.

## CLI Commands

### `artbin login [server-url]`

Authenticates with the artbin server.

1. Server URL defaults to the production instance (configured as a constant in the CLI source, e.g. `https://artbin.jack.is`). Optional override for self-hosted.
2. Opens browser to `<server>/auth/cli/authorize`
3. Server runs the standard 4orm OAuth flow
4. After callback, server redirects to `http://localhost:<port>/callback?session=<id>` (CLI runs a temporary localhost HTTP server to catch it)
5. CLI stores session ID + server URL in platform-appropriate config:
   - Linux: `$XDG_CONFIG_HOME/artbin/config.json` (falls back to `~/.config/artbin/`)
   - macOS: `~/Library/Application Support/artbin/config.json`
   - Windows: `%APPDATA%\artbin\config.json`
   - Uses `env-paths` package for resolution
6. Verifies session by calling `GET /api/cli/whoami`
7. Prints logged-in user info

Config file format:
```json
{
  "serverUrl": "https://artbin.example.com",
  "sessionId": "abc123..."
}
```

### `artbin scan <path>`

Scans a local directory for game assets. No server communication.

1. Recursively walks the directory
2. Finds archive files (PAK, PK3, PK4, ZIP, BSP) and loose importable files (WAD parsing is not yet implemented in `@artbin/core` -- WAD files are detected but skipped for now)
3. Applies filtering rules:
   - Exclude directories (node_modules, .git, Library/Caches, etc.)
   - Exclude filenames (locale.pak, resources.pak, etc.)
   - Exclude path patterns (Electron frameworks, test fixtures, etc.)
   - Skip files < 1KB
   - Skip ZIP files not inside a known game directory
   - Skip BSP files starting with `b_` or < 200KB (ammo/item models)
4. Parses each archive using `@artbin/core` to list contents
5. Detects game directories from path segments (id1, baseq3, valve, etc.)
6. Outputs a tree view: game dir > archive > contained files, with counts and total sizes

### `artbin import <path> [--folder <slug>] [--dry-run]`

Scans and uploads files to the server.

1. Runs the same scan as `artbin scan`
2. For each archive: extracts contents locally using `@artbin/core` parsers
   - PK3/PAK: extracts individual files
   - BSP files: uploaded as-is (server handles texture extraction)
   - Standalone loose files: read from disk
3. Computes SHA-256 hash for each file
4. Calls `POST /api/cli/folders` to create the folder tree on the server
5. Calls `POST /api/cli/manifest` with the full file list -- server responds with which are new
6. Uploads new files in batches (~10 files per request) to `POST /api/cli/upload`
7. Shows progress via `@clack/prompts` spinner/progress indicators

Flags:
- `--folder <slug>`: parent folder to import into (created if needed)
- `--dry-run`: show what would be uploaded, don't actually upload

### `artbin logout`

Deletes the stored config file.

## Server API Endpoints

All endpoints under `/api/cli/` prefix. All require a valid session cookie with an admin user.

### `GET /api/cli/whoami`

Returns the authenticated user's info.

Response:
```json
{ "user": { "id": "...", "name": "...", "isAdmin": true } }
```

### `POST /api/cli/folders`

Creates a folder tree in one request before uploads begin.

Request:
```json
{
  "folders": [
    { "slug": "quake-id1", "name": "Quake id1", "parentSlug": null },
    { "slug": "quake-id1-textures", "name": "textures", "parentSlug": "quake-id1" }
  ]
}
```

Response:
```json
{
  "created": [{ "slug": "quake-id1", "id": "abc" }],
  "existing": [{ "slug": "quake-id1-textures", "id": "def" }]
}
```

Folders are processed in order so parents are created before children. Existing folders are returned as-is (not an error).

### `POST /api/cli/manifest`

Checks which files need to be uploaded.

Request:
```json
{
  "parentFolder": "quake-id1",
  "files": [
    { "path": "textures/brick01.png", "sha256": "abc123...", "size": 45000 },
    { "path": "maps/e1m1.bsp", "sha256": "def456...", "size": 2100000 }
  ]
}
```

Response:
```json
{
  "newFiles": ["textures/brick01.png", "maps/e1m1.bsp"],
  "existingFiles": []
}
```

Matching is by file path within the parent folder. Content hash is stored for future dedup but not used for matching in v1 (path-based matching is simpler and more predictable).

### `POST /api/cli/upload`

Uploads a batch of files.

Multipart form data with:
- `metadata`: JSON string with per-file info
- `file_0`, `file_1`, ... `file_N`: the file binaries

Metadata format:
```json
{
  "parentFolder": "quake-id1",
  "files": [
    {
      "path": "textures/brick01.png",
      "kind": "texture",
      "mimeType": "image/png",
      "sha256": "abc123...",
      "sourceArchive": "pak0.pak"
    }
  ]
}
```

Server processing per file (inline, not queued as a job):
1. Save to disk under the appropriate folder path
2. Run `processImage` if it's a texture that needs preview generation
3. Detect dimensions for images
4. If the file is a BSP, queue a `extract-bsp` job for background texture extraction
5. Insert file record in DB
6. Update folder file counts

Response:
```json
{
  "uploaded": ["textures/brick01.png"],
  "errors": [{ "path": "maps/e1m1.bsp", "error": "file too large" }]
}
```

Idempotent: if a file already exists at that path (race condition or retry), it's counted as uploaded, not an error.

## Auth Flow Detail

### New server routes

**`GET /auth/cli/authorize`**
- Generates OAuth state + PKCE challenge (same as existing `/auth/4orm`)
- Stores state + PKCE + `cliPort` in a short-lived cookie
- `cliPort` comes from query param: `/auth/cli/authorize?port=12345`
- Redirects to 4orm's OAuth authorize endpoint

**`GET /auth/cli/callback`**
- 4orm redirects here after user approves
- Exchanges code for token, fetches user info (same as existing `/auth/4orm/callback`)
- Creates or updates user, creates session
- Instead of setting a cookie and redirecting to `/folders`, redirects to `http://localhost:<cliPort>/callback?session=<sessionId>`

### CLI localhost server

The CLI starts a temporary HTTP server on a random available port before opening the browser. After receiving the callback with the session ID, it shuts down the server. Timeout after 2 minutes if no callback received.

Passing the session ID as a query param is safe here because the redirect target is always `localhost` -- the session never traverses the network in a URL.

## Folder Structure Derivation

When importing, the CLI creates a folder hierarchy that mirrors the source structure. The `--folder` flag sets the root. Within that:

- **Archive contents:** internal directory structure becomes subfolders. E.g., `pak0.pak` containing `textures/brick01.png` creates a `textures` subfolder.
- **Loose files:** directory structure relative to the import path becomes subfolders.
- **Game dir grouping:** if a game directory is detected (e.g., `id1`), it becomes a subfolder under the root.

Folder slugs are derived using `cleanFolderSlug()` from `@artbin/core`. Names preserve the original directory name casing.

Example: `artbin import ~/Games/quake --folder quake`
```
quake/                    (--folder root)
  id1/                    (detected game dir)
    textures/             (from pak0.pak internal structure)
      brick01.png
    maps/
      e1m1.bsp
  hipnotic/               (another game dir)
    ...
```

## What Moves to `@artbin/core`

### New module: `scanning`

Extracted from `scan-archives-job.server.ts` and `folder-import-job.server.ts`:

**Types:**
- `ScanSettings` -- interface for exclude dirs, filenames, path patterns, known game dirs
- `ScanResult` -- structured output of a directory scan

**Constants:**
- `DEFAULT_SCAN_SETTINGS` -- the 30 exclude dirs, 6 exclude filenames, 5 path patterns, 27 known game dirs
- `IMPORTABLE_EXTENSIONS` -- set of 37 file extensions worth importing

**Functions:**
- `shouldExclude(filename, filePath, settings)` -- checks against exclude rules
- `findGameDir(filePath, knownDirs)` -- walks path segments to find game directory match
- `isImportableFile(filename)` -- checks extension against IMPORTABLE_EXTENSIONS

### Updated `@artbin/core` exports

```
@artbin/core            # everything
@artbin/core/parsers    # archive + BSP parsers (existing)
@artbin/core/detection  # kind, mime, filenames (existing)
@artbin/core/scanning   # new: scan settings, filtering, game dir detection
```

## `apps/cli` Package

### Dependencies

```
dependencies:
  @artbin/core        workspace:*
  @bomb.sh/args       # <1kB typed flag parser
  @clack/prompts      # interactive prompts, spinners, styled output
  env-paths           # platform-appropriate config directories

devDependencies:
  @bomb.sh/tab        # shell completions (nice-to-have)
  tsup                # bundle to single JS file
  typescript
```

### Structure

```
apps/cli/
  src/
    index.ts          # entry point, command dispatch via @bomb.sh/args
    commands/
      login.ts        # OAuth flow + config storage
      scan.ts         # local directory scanning, tree output
      import.ts       # manifest check + batch upload
      logout.ts       # clear config
    lib/
      config.ts       # read/write config (env-paths)
      api.ts          # HTTP client (fetch + session cookie)
      scanner.ts      # directory walk, archive parsing, file listing
  package.json
  tsconfig.json
```

### Build

`tsup` bundles to a single ESM file. `package.json` has a `bin` field:

```json
{
  "name": "@artbin/cli",
  "bin": { "artbin": "./dist/index.js" }
}
```

Run with `npx @artbin/cli`, or install globally, or link locally during dev with `pnpm link`.

## What This Does NOT Change

- No changes to existing web UI or routes
- No changes to existing job handlers (scan-archives, folder-import stay for local dev use)
- No changes to the existing upload modal / single-file upload flow
- Database schema unchanged (no new tables needed -- files, folders, sessions all exist)
- The `sha256` field for content hashing will need to be added to the `files` table (single migration)
