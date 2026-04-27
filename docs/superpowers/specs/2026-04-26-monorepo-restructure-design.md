# Monorepo Restructure Design

**Goal:** Convert the single-app artbin repo into a pnpm workspace monorepo, extracting platform-agnostic code into a shared `@artbin/core` package so future apps (CLI scanner/uploader) can reuse archive parsing, file detection, and type definitions without depending on the web app.

**Context:** This is sub-project 1 of 3. Sub-project 2 adds a CLI tool (`apps/cli`) for scanning local game dirs and uploading to the server. Sub-project 3 adds a contribution/approval workflow so non-admin users can submit files for admin review. This restructure lays the foundation without changing any features.

## Target Structure

```
artbin/
  apps/
    web/                        # the existing React Router app, moved here
      src/
        components/
        db/
        lib/
          jobs/                 # job handlers (all stay here for now)
          loaders/              # Three.js loaders (stay, web-only)
          archives.server.ts    # thin wrapper: reads files, delegates to @artbin/core
          auth.server.ts
          bsp.server.ts         # thin wrapper: delegates to @artbin/core
          files.server.ts       # fs operations stay, imports detection from @artbin/core
          folder-preview.server.ts
          folders.server.ts
          jobs.server.ts
          settings.server.ts
          settings.types.ts
        routes/
      test/
      public/
      drizzle/
      scripts/
      package.json              # @artbin/web, depends on @artbin/core
      tsconfig.json
      vite.config.ts
      vitest.config.ts
      Dockerfile
      .dockerignore
  packages/
    core/                       # shared, platform-agnostic code
      src/
        parsers/
          archives.ts           # PK3/PAK/WAD parsing from Buffer (no fs)
          bsp.ts                # BSP header parsing + texture extraction from Buffer
          index.ts              # re-exports
        detection/
          kind.ts               # fileKinds, FileKind, detectKind, needsPreview, isWebImage, isImageKind
          mime.ts               # getMimeType, CUSTOM_MIME_TYPES, looksLikeText
          filenames.ts          # sanitizeFilename, cleanFolderSlug
          index.ts              # re-exports
        index.ts                # top-level re-exports
      package.json              # @artbin/core
      tsconfig.json
  package.json                  # root workspace config
  pnpm-workspace.yaml
  .oxlintrc.json                # root-level, applies to all packages
  .oxfmtrc.json                 # root-level
  .github/
    workflows/
      build-and-push.yml        # updated paths
      pr-check.yml              # updated paths
```

## What Moves to @artbin/core

### parsers/archives.ts

Extracted from `src/lib/archives.server.ts`. The current code reads files from disk (`readFile(filePath)`, `open(filePath)`), but the core parsing logic operates on buffers. Refactor to:

- `parsePk3(buffer: Buffer)` -- already reads full file into buffer internally, just accept buffer directly
- `extractPk3Entry(buffer: Buffer, entry: ArchiveEntry)` -- same pattern
- `parsePak(buffer: Buffer)` -- currently uses file handles for efficiency; refactor to work from buffer with offset reads. Acceptable perf tradeoff for portability.
- `extractPakEntry(buffer: Buffer, entry: ArchiveEntry)` -- same
- `detectArchiveType(buffer: Buffer)` -- read magic bytes from buffer head instead of file handle
- `getDirectoryPaths()`, `getFileEntries()` -- pure functions on parsed data, move as-is
- Type exports: `ArchiveEntry`, `ParsedArchive`, `ArchiveType`

The web app's `archives.server.ts` becomes a thin adapter: reads file from disk into buffer, calls `@artbin/core` parsers.

### parsers/bsp.ts

Extracted from `src/lib/bsp.server.ts`. This code already operates entirely on buffers -- no filesystem access. Move as-is:

- `parseBSPHeader(buffer)`, `parseMipTextures(buffer, header)`, `extractTexturesFromBSP(buffer)`, `isBSPFile(buffer)`
- `sharp` dependency moves to `@artbin/core` (used for RGBA-to-PNG conversion in BSP texture extraction)

### detection/kind.ts

Extracted from `src/lib/files.server.ts` (top of file). Pure functions and constants:

- `fileKinds` array, `FileKind` type
- `KIND_EXTENSIONS` map
- `detectKind(filename)`, `isImageKind(kind)`, `needsPreview(filename)`, `isWebImage(filename)`

### detection/mime.ts

Extracted from `src/lib/files.server.ts`. Pure functions:

- `CUSTOM_MIME_TYPES` map
- `looksLikeText(buffer)` -- buffer inspection, no fs
- `getMimeType(filename, buffer?)` -- uses `file-type` npm package + custom map
- `file-type` and `mime-types` dependencies move to `@artbin/core`

### detection/filenames.ts

Extracted from `src/lib/files.server.ts` and `src/lib/folders.server.ts`:

- `sanitizeFilename(filename)` -- pure string transform
- `cleanFolderSlug(slug)` -- pure string transform

## What Stays in apps/web

Everything not listed above. The web app keeps:

- All React Router routes, components, CSS
- DB connection, schema, migrations (`src/db/`, `drizzle/`)
- Auth system (`auth.server.ts`)
- Job runner + all job handlers (including local-only `folder-import-job` and `scan-archives-job`)
- File storage operations (`saveFile`, `deleteFile`, `moveFile`, `ensureDir`, etc.)
- Folder operations (`createFolder`, `moveFolder`, etc.)
- Image processing (`getImageDimensions`, `generatePreview`, `processImage`)
- Folder preview generation
- Settings system
- Three.js loaders (`ASELoader`, `MD5Loader`)
- Dockerfile, scripts

The web app imports shared code from `@artbin/core`:

```typescript
import { detectKind, getMimeType, sanitizeFilename } from "@artbin/core";
import { parsePk3, extractPk3Entry } from "@artbin/core/parsers";
import { extractTexturesFromBSP, isBSPFile } from "@artbin/core/parsers";
```

## Package Configuration

### pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Root package.json

```json
{
  "name": "artbin",
  "private": true,
  "scripts": {
    "ci": "pnpm -r run ci",
    "lint": "oxlint",
    "format": "oxfmt --write apps/ packages/",
    "format:check": "oxfmt --check apps/ packages/"
  },
  "devDependencies": {
    "oxlint": "...",
    "oxfmt": "..."
  }
}
```

Lint and format run from root (they scan all files). Typecheck, test, build, and ci run per-package via `pnpm -r`.

### @artbin/core package.json

```json
{
  "name": "@artbin/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./parsers": "./src/parsers/index.ts",
    "./detection": "./src/detection/index.ts"
  },
  "dependencies": {
    "file-type": "...",
    "mime-types": "...",
    "sharp": "..."
  }
}
```

No build step for the shared package -- the web app's Vite bundler handles TypeScript compilation via workspace resolution. The `exports` field points directly at `.ts` source files.

### @artbin/web package.json

Current `package.json` with:
- `"name": "@artbin/web"` 
- `"@artbin/core": "workspace:*"` added to dependencies
- `file-type`, `mime-types`, `sharp` removed (now in `@artbin/core`)

## CI Updates

- GitHub workflows update working directories and paths
- `Dockerfile` context changes to build from `apps/web/`
- Root `pnpm run ci` runs ci across all workspace packages
- Each package has its own `ci` script (typecheck + test for web, typecheck for core)

## What This Does NOT Change

- No features added or removed
- No UI changes
- No API changes
- All job handlers stay in the web app
- Local-only jobs (`scan-archives`, `folder-import`) continue working in local dev
- The app behaves identically before and after
