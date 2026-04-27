# Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-app artbin repo into a pnpm workspace monorepo, extracting platform-agnostic code into `@artbin/core`.

**Architecture:** Create a pnpm workspace with `apps/web` (existing app moved) and `packages/core` (shared parsers, detection, types). The web app imports from `@artbin/core` via `workspace:*`. No build step for the shared package -- Vite resolves TypeScript source directly.

**Tech Stack:** pnpm workspaces, TypeScript, Vite, React Router

---

### Task 1: Create workspace scaffold and move the web app

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `apps/web/` (move entire app here)
- Modify: root `package.json`

- [ ] **Step 1: Create pnpm-workspace.yaml**

Create `pnpm-workspace.yaml` at repo root:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create apps/web directory and move the app**

Move these into `apps/web/`:
- `src/` -> `apps/web/src/`
- `test/` -> `apps/web/test/`
- `public/` -> `apps/web/public/`
- `drizzle/` -> `apps/web/drizzle/`
- `scripts/` -> `apps/web/scripts/`
- `package.json` -> `apps/web/package.json`
- `tsconfig.json` -> `apps/web/tsconfig.json`
- `vite.config.ts` -> `apps/web/vite.config.ts`
- `vitest.config.ts` -> `apps/web/vitest.config.ts`
- `drizzle.config.ts` -> `apps/web/drizzle.config.ts`
- `Dockerfile` -> `apps/web/Dockerfile`
- `.dockerignore` -> `apps/web/.dockerignore`
- `README.md` -> `apps/web/README.md`

Use `git mv` for each to preserve history.

- [ ] **Step 3: Update apps/web/package.json**

Change the name to `@artbin/web`. Keep everything else.

- [ ] **Step 4: Create root package.json**

Create a new root `package.json`:
```json
{
  "name": "artbin",
  "private": true,
  "scripts": {
    "ci": "pnpm run format:check && pnpm run lint && pnpm -r run ci",
    "lint": "oxlint",
    "format": "oxfmt --write apps/ packages/",
    "format:check": "oxfmt --check apps/ packages/"
  },
  "devDependencies": {
    "oxlint": "^1.61.0",
    "oxfmt": "^0.46.0"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "better-sqlite3",
      "bcrypt",
      "sharp"
    ]
  }
}
```

- [ ] **Step 5: Update apps/web/package.json**

Remove `oxlint` and `oxfmt` from devDependencies (now in root). Remove `pnpm.onlyBuiltDependencies` (now in root). Remove `format`, `format:check`, `lint`, `lint:fix` scripts (now run from root). Change the `ci` script to just `pnpm run typecheck && pnpm run test` (format/lint run from root).

- [ ] **Step 6: Move config files that stay at root**

These should NOT move -- they stay at the repo root:
- `.oxlintrc.json` (already at root)
- `.oxfmtrc.json` (already at root)
- `.github/` (already at root)
- `docs/` (already at root)

Update `.oxlintrc.json` ignorePatterns to include `apps/web/build/`, `apps/web/.react-router/`, `apps/web/tmp/`.

Update `.oxfmtrc.json` ignorePatterns similarly.

- [ ] **Step 7: Run pnpm install and verify**

```bash
pnpm install
cd apps/web && pnpm run typecheck && pnpm run test
```

This may require fixing path issues in `tsconfig.json` since the working directory changed.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "move web app into apps/web, create pnpm workspace"
```

---

### Task 2: Create @artbin/core package with detection module

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/detection/index.ts`
- Create: `packages/core/src/detection/kind.ts`
- Create: `packages/core/src/detection/mime.ts`
- Create: `packages/core/src/detection/filenames.ts`

- [ ] **Step 1: Create packages/core/package.json**

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
    "file-type": "^22.0.1",
    "mime-types": "^3.0.2"
  },
  "devDependencies": {
    "@types/mime-types": "^3.0.1",
    "typescript": "^6.0.3"
  },
  "scripts": {
    "ci": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create packages/core/tsconfig.json**

```json
{
  "compilerOptions": {
    "lib": ["ES2022"],
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create detection/kind.ts**

Extract from `apps/web/src/lib/files.server.ts`. This file has no dependencies -- pure functions and constants.

```typescript
import { extname } from "path";

export const fileKinds = [
  "texture", "model", "audio", "map", "archive", "config", "other",
] as const;
export type FileKind = (typeof fileKinds)[number];

const KIND_EXTENSIONS: Record<FileKind, string[]> = {
  texture: ["png", "jpg", "jpeg", "gif", "webp", "tga", "bmp", "pcx", "wal", "vtf", "dds"],
  model: ["gltf", "glb", "obj", "fbx", "md2", "md3", "mdl", "md5mesh", "md5anim", "ase", "lwo", "iqm", "blend"],
  audio: ["wav", "mp3", "ogg", "flac", "m4a", "aiff"],
  map: ["bsp", "map", "vmf", "rmf"],
  archive: ["pk3", "pk4", "pak", "wad", "zip", "7z", "rar", "tar", "gz"],
  config: ["cfg", "txt", "json", "xml", "ini", "yaml", "yml", "toml", "rc", "conf"],
  other: [],
};

export function detectKind(filename: string): FileKind {
  const ext = extname(filename).toLowerCase().slice(1);
  for (const [kind, extensions] of Object.entries(KIND_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return kind as FileKind;
    }
  }
  return "other";
}

export function isImageKind(kind: FileKind): boolean {
  return kind === "texture";
}

export function needsPreview(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return ["tga", "bmp", "pcx", "wal", "vtf", "dds"].includes(ext);
}

export function isWebImage(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
}
```

- [ ] **Step 4: Create detection/mime.ts**

Extract from `apps/web/src/lib/files.server.ts`. Copy the full `CUSTOM_MIME_TYPES` map, `looksLikeText()`, and `getMimeType()` functions.

- [ ] **Step 5: Create detection/filenames.ts**

Extract `sanitizeFilename()` from `files.server.ts` and `cleanFolderSlug()` from `folders.server.ts`.

```typescript
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 255);
}

export function cleanFolderSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 6: Create detection/index.ts and src/index.ts**

`packages/core/src/detection/index.ts`:
```typescript
export { fileKinds, type FileKind, detectKind, isImageKind, needsPreview, isWebImage } from "./kind.ts";
export { getMimeType, CUSTOM_MIME_TYPES } from "./mime.ts";
export { sanitizeFilename, cleanFolderSlug } from "./filenames.ts";
```

`packages/core/src/index.ts`:
```typescript
export * from "./detection/index.ts";
```

- [ ] **Step 7: Run pnpm install and typecheck core**

```bash
pnpm install
cd packages/core && pnpm run ci
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "create @artbin/core package with detection module"
```

---

### Task 3: Create @artbin/core parsers module

**Files:**
- Create: `packages/core/src/parsers/index.ts`
- Create: `packages/core/src/parsers/bsp.ts`
- Create: `packages/core/src/parsers/archives.ts`
- Modify: `packages/core/package.json` (add `sharp` dependency)

- [ ] **Step 1: Copy bsp.ts**

Copy `apps/web/src/lib/bsp.server.ts` to `packages/core/src/parsers/bsp.ts`. This file is already entirely buffer-based. Remove the `.server` suffix. Keep all exports as-is.

- [ ] **Step 2: Add sharp to @artbin/core dependencies**

Add `"sharp": "^0.34.5"` to `packages/core/package.json` dependencies. Add `sharp` to `pnpm.onlyBuiltDependencies` in root `package.json` if not already there.

- [ ] **Step 3: Create archives.ts**

Refactor `apps/web/src/lib/archives.server.ts` into a buffer-based version. The key changes:
- `detectArchiveType(buffer: Buffer)` instead of reading from file path -- check magic bytes from buffer head
- `parsePk3(buffer: Buffer)` -- already reads full file internally, just accept buffer directly
- `extractPk3Entry(buffer: Buffer, entry)` -- same
- `parsePak(buffer: Buffer)` -- refactor from file handle reads to buffer offset reads
- `extractPakEntry(buffer: Buffer, entry)` -- same
- `parseArchive(buffer: Buffer)` -- delegates based on type
- Remove all `fs` imports

Keep all type exports (`ArchiveEntry`, `ParsedArchive`, `ArchiveType`).

- [ ] **Step 4: Create parsers/index.ts**

```typescript
export { parseBSPHeader, parseMipTextures, extractTexturesFromBSP, isBSPFile } from "./bsp.ts";
export type { BSPHeader, MipTexture } from "./bsp.ts";
export { detectArchiveType, parsePk3, extractPk3Entry, parsePak, extractPakEntry, parseArchive, getDirectoryPaths, getFileEntries } from "./archives.ts";
export type { ArchiveEntry, ParsedArchive, ArchiveType } from "./archives.ts";
```

Update `packages/core/src/index.ts`:
```typescript
export * from "./detection/index.ts";
export * from "./parsers/index.ts";
```

- [ ] **Step 5: Run pnpm install and typecheck**

```bash
pnpm install
cd packages/core && pnpm run ci
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "add parsers module to @artbin/core (archives + BSP, buffer-based)"
```

---

### Task 4: Wire up apps/web to import from @artbin/core

**Files:**
- Modify: `apps/web/package.json` (add `@artbin/core` dependency)
- Modify: `apps/web/src/lib/files.server.ts` (import detection from core)
- Modify: `apps/web/src/lib/folders.server.ts` (import cleanFolderSlug from core)
- Modify: `apps/web/src/lib/archives.server.ts` (delegate to core parsers)
- Modify: `apps/web/src/lib/bsp.server.ts` (re-export from core)
- Modify: `apps/web/src/db/schema.ts` (import FileKind from core)

- [ ] **Step 1: Add @artbin/core dependency to apps/web**

In `apps/web/package.json`, add to dependencies:
```json
"@artbin/core": "workspace:*"
```

Remove from `apps/web/package.json` dependencies (now in core):
- `file-type`
- `mime-types`

Remove from devDependencies:
- `@types/mime-types`

Run `pnpm install`.

- [ ] **Step 2: Update files.server.ts**

Replace the detection functions with imports from `@artbin/core`. Remove the extracted code (KIND_EXTENSIONS, detectKind, isImageKind, needsPreview, isWebImage, CUSTOM_MIME_TYPES, looksLikeText, getMimeType, sanitizeFilename). Replace with:

```typescript
import { detectKind, isImageKind, needsPreview, isWebImage, getMimeType, sanitizeFilename, type FileKind } from "@artbin/core";
```

Remove the `import type { FileKind } from "~/db/schema"` and `import mime from "mime-types"` and `import { fileTypeFromBuffer } from "file-type"` imports.

Keep all fs-based functions (saveFile, deleteFile, moveFile, ensureDir, etc.) and the Result-based wrappers.

Re-export the detection functions for backward compatibility so other web app files don't need to change their imports:
```typescript
export { detectKind, isImageKind, needsPreview, isWebImage, getMimeType, sanitizeFilename };
```

- [ ] **Step 3: Update folders.server.ts**

Replace the local `cleanFolderSlug` function with an import:
```typescript
import { cleanFolderSlug } from "@artbin/core";
```

Delete the `cleanFolderSlug` function body. Re-export it:
```typescript
export { cleanFolderSlug };
```

- [ ] **Step 4: Update archives.server.ts**

Make it a thin adapter that reads files from disk and delegates to `@artbin/core`:

```typescript
import { readFile } from "fs/promises";
import { detectArchiveType, parsePk3, extractPk3Entry, parsePak, extractPakEntry, getDirectoryPaths, getFileEntries } from "@artbin/core/parsers";
import type { ArchiveEntry, ParsedArchive, ArchiveType } from "@artbin/core/parsers";

export type { ArchiveEntry, ParsedArchive, ArchiveType };
export { getDirectoryPaths, getFileEntries };

export async function parseArchive(filePath: string): Promise<ParsedArchive> {
  const buffer = await readFile(filePath);
  // delegate to core's buffer-based parser
  // ... (thin wrapper)
}

export async function extractEntry(filePath: string, entry: ArchiveEntry): Promise<Buffer> {
  const buffer = await readFile(filePath);
  // delegate to core's buffer-based extractor
  // ...
}
```

- [ ] **Step 5: Update bsp.server.ts**

Make it a re-export from core:
```typescript
export { parseBSPHeader, parseMipTextures, extractTexturesFromBSP, isBSPFile } from "@artbin/core/parsers";
export type { BSPHeader, MipTexture } from "@artbin/core/parsers";
```

- [ ] **Step 6: Update db/schema.ts**

The `fileKinds` and `FileKind` type are now in `@artbin/core`. Update `schema.ts` to import from core:
```typescript
import { fileKinds, type FileKind } from "@artbin/core";
```

Remove the local definitions. Re-export for backward compatibility:
```typescript
export { fileKinds, type FileKind };
```

- [ ] **Step 7: Run full CI from apps/web**

```bash
cd apps/web && pnpm run ci
```

All 41 tests should pass. All types should check.

- [ ] **Step 8: Run full CI from root**

```bash
cd /path/to/artbin && pnpm run ci
```

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "wire apps/web to import from @artbin/core"
```

---

### Task 5: Update CI and Docker

**Files:**
- Modify: `.github/workflows/pr-check.yml`
- Modify: `.github/workflows/build-and-push.yml`
- Modify: `apps/web/Dockerfile`

- [ ] **Step 1: Update GitHub workflows**

Both workflows need to update their script references. The root `pnpm run ci` already calls `pnpm -r run ci` which runs each package's ci script. Update the check job steps:

```yaml
      - name: Check formatting
        run: pnpm run format:check

      - name: Lint
        run: pnpm run lint

      - name: CI (typecheck + test for all packages)
        run: pnpm run ci

      - name: Build
        run: pnpm run --filter @artbin/web build
```

Remove the separate `Typecheck` and `Test` steps since `ci` handles both.

- [ ] **Step 2: Update Dockerfile**

The Dockerfile needs to work from the monorepo root (since Docker context is set by the workflow). Update to handle pnpm workspace:

```dockerfile
FROM node:25-alpine AS build-env
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run --filter @artbin/web build

FROM node:25-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY --from=build-env /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build-env /app/apps/web/package.json apps/web/
COPY --from=build-env /app/packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build-env /app/apps/web/build apps/web/build
WORKDIR /app/apps/web
CMD ["pnpm", "run", "start"]
```

- [ ] **Step 3: Update build-and-push.yml Docker context**

The `docker/build-push-action` step needs `context: .` (repo root, which is the default) so it can access the full monorepo. Ensure the Dockerfile path is specified:

```yaml
      - name: Build and push Docker image
        uses: docker/build-push-action@v7
        with:
          context: .
          file: apps/web/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

- [ ] **Step 4: Verify locally**

```bash
pnpm run ci
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "update CI workflows and Dockerfile for monorepo structure"
```

---

### Task 6: Clean up and final verification

- [ ] **Step 1: Remove stale root-level files**

Check if any files were accidentally left at the repo root that should have moved to `apps/web/`. Common suspects: `drizzle.config.ts`, stale `node_modules/`, `.env` files.

- [ ] **Step 2: Run full CI pipeline**

```bash
pnpm run ci
```

- [ ] **Step 3: Verify the workspace structure**

```bash
pnpm ls --depth 0 -r
```

Should show `@artbin/web` and `@artbin/core` as workspace packages.

- [ ] **Step 4: Verify Docker build locally (optional)**

```bash
docker build -f apps/web/Dockerfile -t artbin-test .
```

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A && git commit -m "monorepo restructure cleanup"
```
