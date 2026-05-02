# Unified File Ingest Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 14 duplicated save-detect-process-hash-insert pipelines with a single `ingestFile()` function.

**Architecture:** Add `ingestFile()` to `files.server.ts` that orchestrates the 6 common steps (save, detect kind, detect mime, process image, hash, insert record). Each caller keeps its own folder resolution and byte acquisition but delegates the common pipeline to `ingestFile()`. TDD: test the function first, then migrate callers one at a time with CI between each.

**Tech Stack:** TypeScript, Drizzle ORM, better-result, vitest

---

### Task 1: Create `ingestFile()` with tests

**Files:**
- Modify: `apps/web/src/lib/files.server.ts`
- Create: `apps/web/test/ingest.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/web/test/ingest.test.ts`:

```typescript
import { afterEach, describe, expect, test, vi } from "vitest";
import { files, folders } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";
import { eq } from "drizzle-orm";

vi.mock("evlog/react-router", () => {
  const noopLogger = { set: () => {}, error: () => {}, emit: () => {} };
  return { useLogger: () => noopLogger, loggerContext: Symbol("loggerContext") };
});

// Mock filesystem and image processing
vi.mock("~/lib/files.server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    saveFile: vi.fn(async (_buffer: Buffer, folderSlug: string, filename: string) => ({
      path: `${folderSlug}/${filename}`,
      name: filename,
    })),
    processImage: vi.fn(async () => ({
      isOk: () => true,
      isErr: () => false,
      value: { width: 128, height: 128, hasPreview: true },
    })),
    ensureDir: vi.fn(async () => {}),
    slugToPath: (slug: string) => `/mock-uploads/${slug}`,
  };
});

// Re-import after mocks are set up
const { ingestFile } = await import("~/lib/files.server");

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

describe("ingestFile", () => {
  test("saves file, detects kind/mime, hashes, and inserts DB record", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "f1", name: "Test", slug: "test", fileCount: 0 });

    const buffer = Buffer.from("hello world");
    const result = await ingestFile({
      buffer,
      fileName: "wall.png",
      folderSlug: "test",
      folderId: "f1",
      source: "test",
    });

    expect(result.isOk()).toBe(true);
    const val = result.value;
    expect(val.path).toBe("test/wall.png");
    expect(val.kind).toBe("texture");
    expect(val.sha256).toMatch(/^[a-f0-9]{64}$/);

    // Verify DB record
    const file = await db.query.files.findFirst({ where: eq(files.path, "test/wall.png") });
    expect(file).toBeTruthy();
    expect(file!.source).toBe("test");
    expect(file!.sha256).toBe(val.sha256);
    expect(file!.status).toBe("approved");
  });

  test("sets status to pending when specified", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "f1", name: "Test", slug: "test", fileCount: 0 });

    const result = await ingestFile({
      buffer: Buffer.from("data"),
      fileName: "readme.txt",
      folderSlug: "test",
      folderId: "f1",
      source: "upload",
      status: "pending",
      suggestedFolderId: "other-folder",
    });

    expect(result.isOk()).toBe(true);
    const file = await db.query.files.findFirst({ where: eq(files.path, "test/readme.txt") });
    expect(file!.status).toBe("pending");
    expect(file!.suggestedFolderId).toBe("other-folder");
  });

  test("skips image processing when processImages is false", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "f1", name: "Test", slug: "test", fileCount: 0 });

    const { processImage } = await import("~/lib/files.server");

    const result = await ingestFile({
      buffer: Buffer.from("pixels"),
      fileName: "photo.png",
      folderSlug: "test",
      folderId: "f1",
      source: "cli-upload",
      processImages: false,
    });

    expect(result.isOk()).toBe(true);
    expect(processImage).not.toHaveBeenCalled();

    const file = await db.query.files.findFirst({ where: eq(files.path, "test/photo.png") });
    expect(file!.width).toBeNull();
    expect(file!.height).toBeNull();
    expect(file!.hasPreview).toBe(false);
  });

  test("uses pre-computed kind and mimeType when provided", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "f1", name: "Test", slug: "test", fileCount: 0 });

    const result = await ingestFile({
      buffer: Buffer.from("bsp-texture-data"),
      fileName: "brick.png",
      folderSlug: "test",
      folderId: "f1",
      source: "bsp-extracted",
      kind: "texture",
      mimeType: "image/png",
      width: 64,
      height: 64,
    });

    expect(result.isOk()).toBe(true);
    const file = await db.query.files.findFirst({ where: eq(files.path, "test/brick.png") });
    expect(file!.kind).toBe("texture");
    expect(file!.mimeType).toBe("image/png");
    expect(file!.width).toBe(64);
    expect(file!.height).toBe(64);
  });

  test("sets uploaderId and sourceArchive when provided", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "f1", name: "Test", slug: "test", fileCount: 0 });

    const result = await ingestFile({
      buffer: Buffer.from("extracted"),
      fileName: "map.bsp",
      folderSlug: "test",
      folderId: "f1",
      source: "extracted-pak",
      uploaderId: "user-123",
      sourceArchive: "pak0.pak",
    });

    expect(result.isOk()).toBe(true);
    const file = await db.query.files.findFirst({ where: eq(files.path, "test/map.bsp") });
    expect(file!.uploaderId).toBe("user-123");
    expect(file!.sourceArchive).toBe("pak0.pak");
  });

  test("increments folder file count", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "f1", name: "Test", slug: "test", fileCount: 0 });

    await ingestFile({
      buffer: Buffer.from("a"),
      fileName: "a.txt",
      folderSlug: "test",
      folderId: "f1",
      source: "test",
    });

    const folder = await db.query.folders.findFirst({ where: eq(folders.id, "f1") });
    expect(folder!.fileCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/ingest.test.ts` from `apps/web`
Expected: FAIL -- `ingestFile` is not exported from `files.server.ts`

- [ ] **Step 3: Implement `ingestFile`**

Add to `apps/web/src/lib/files.server.ts`, after `insertFileRecord`:

```typescript
export interface IngestFileOptions {
  buffer: Buffer;
  fileName: string;
  folderSlug: string;
  folderId: string;
  source: string;
  status?: "approved" | "pending";
  uploaderId?: string | null;
  sourceArchive?: string | null;
  suggestedFolderId?: string | null;
  processImages?: boolean;
  kind?: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
}

export interface IngestFileResult {
  fileId: string;
  path: string;
  name: string;
  kind: string;
  mimeType: string;
  sha256: string;
  width: number | null;
  height: number | null;
  hasPreview: boolean;
}

export async function ingestFile(
  opts: IngestFileOptions,
): Promise<Result<IngestFileResult, Error>> {
  try {
    const { path: savedPath, name: savedName } = await saveFile(
      opts.buffer,
      opts.folderSlug,
      opts.fileName,
      true,
    );

    const kind = (opts.kind ?? detectKind(savedName)) as FileKind;
    const mimeType = opts.mimeType ?? (await getMimeType(savedName, opts.buffer));

    let width = opts.width ?? null;
    let height = opts.height ?? null;
    let hasPreview = false;

    if (opts.processImages !== false && isImageKind(kind) && opts.width === undefined) {
      const imageInfo = await processImage(savedPath);
      if (imageInfo.isOk()) {
        width = imageInfo.value.width;
        height = imageInfo.value.height;
        hasPreview = imageInfo.value.hasPreview;
      }
    }

    const sha256 = computeSha256(opts.buffer);
    const fileId = nanoid();

    const inserted = await insertFileRecord({
      id: fileId,
      path: savedPath,
      name: savedName,
      mimeType,
      size: opts.buffer.length,
      kind,
      width,
      height,
      hasPreview,
      folderId: opts.folderId,
      uploaderId: opts.uploaderId ?? null,
      source: opts.source,
      sourceArchive: opts.sourceArchive ?? null,
      sha256,
      status: opts.status ?? "approved",
      suggestedFolderId: opts.suggestedFolderId ?? null,
    });

    if (inserted.isErr()) return inserted as Result<never, Error>;

    return Result.ok({
      fileId,
      path: savedPath,
      name: savedName,
      kind,
      mimeType,
      sha256,
      width,
      height,
      hasPreview,
    });
  } catch (error) {
    return Result.err(toError(error));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/ingest.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Run full CI**

Run: `pnpm run ci` from repo root
Expected: All tests pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/files.server.ts apps/web/test/ingest.test.ts
git commit -m "add ingestFile() unified pipeline with 6 tests"
```

---

### Task 2: Migrate web upload routes

**Files:**
- Modify: `apps/web/src/routes/api.upload.tsx`

- [ ] **Step 1: Migrate `handleAdminUpload`**

Replace the save/detect/process/hash/insert block with a single `ingestFile()` call. Keep the nested folder creation logic and the archive handling. Import `ingestFile` from `~/lib/files.server`.

The key change: replace the ~30 lines starting from `const { path: filePath, name: savedName } = await saveFile(...)` through `if (inserted.isErr()) throw inserted.error` with:

```typescript
const ingested = await ingestFile({
  buffer,
  fileName: relativePath ? basename(relativePath) : file.name,
  folderSlug: targetFolderSlug,
  folderId: targetFolderId,
  source: "upload",
  uploaderId: userId,
});
if (ingested.isErr()) throw ingested.error;
```

Then use `ingested.value.fileId`, `ingested.value.path`, `ingested.value.name` for the response and any post-ingest logic.

- [ ] **Step 2: Migrate `handleNonAdminUpload`**

Same pattern but with `status: "pending"` and `suggestedFolderId`:

```typescript
const ingested = await ingestFile({
  buffer,
  fileName: relativePath ? basename(relativePath) : file.name,
  folderSlug: targetFolderSlug,
  folderId: targetFolderId,
  source: "upload",
  status: "pending",
  uploaderId: userId,
  suggestedFolderId: folderId || null,
});
if (ingested.isErr()) throw ingested.error;
```

- [ ] **Step 3: Remove unused imports**

Remove `detectKind`, `getMimeType`, `processImage`, `isImageKind`, `computeSha256`, `insertFileRecord` from the import if no longer used directly. Keep `saveFile` only if archive handling still uses it.

- [ ] **Step 4: Run CI**

Run: `pnpm run ci`
Expected: All tests pass. Existing `contribution.test.ts` tests should still pass since they test the route action end-to-end.

- [ ] **Step 5: Commit**

```bash
git commit -am "migrate web upload routes to ingestFile()"
```

---

### Task 3: Migrate CLI upload routes

**Files:**
- Modify: `apps/web/src/routes/api.cli.upload.tsx`

- [ ] **Step 1: Migrate `handleAdminUpload`**

Replace the save/detect/hash/insert block with:

```typescript
const ingested = await ingestFile({
  buffer,
  fileName,
  folderSlug,
  folderId: folder.id,
  source: "cli-upload",
  uploaderId: userId,
  sourceArchive: fileMeta.sourceArchive ?? null,
  processImages: false,
});
if (ingested.isErr()) {
  errors.push({ path: fileMeta.path, error: ingested.error.message });
  log.error(ingested.error, { step: "insert-record", file: fileMeta.path });
  continue;
}
```

Then use `ingested.value` for BSP job queuing (check `ingested.value.kind === "map"`).

- [ ] **Step 2: Migrate `handleNonAdminUpload`**

Same pattern with `status: "pending"`:

```typescript
const ingested = await ingestFile({
  buffer,
  fileName,
  folderSlug: session.slug,
  folderId: session.id,
  source: "cli-upload",
  status: "pending",
  uploaderId: userId,
  sourceArchive: fileMeta.sourceArchive ?? null,
  suggestedFolderId,
  processImages: false,
});
```

- [ ] **Step 3: Remove unused imports, run CI**

Run: `pnpm run ci`
Expected: All `cli-api.test.ts` tests pass including the end-to-end dirty path test.

- [ ] **Step 4: Commit**

```bash
git commit -am "migrate CLI upload routes to ingestFile()"
```

---

### Task 4: Migrate extract-job handlers

**Files:**
- Modify: `apps/web/src/lib/jobs/extract-job.server.ts`

This file has 4 handlers with 6 `insertFileRecord` call sites. Each one follows the same pattern: `saveFile` -> `detectKind` -> `getMimeType` -> `processImage` -> `computeSha256` -> `insertFileRecord`.

- [ ] **Step 1: Import `ingestFile` from `~/lib/files.server`**

Add `ingestFile` to the existing import from `../files.server`.

- [ ] **Step 2: Migrate `handleExtractJob` main file insertion (around line 186-225)**

Replace with:

```typescript
const ingested = await ingestFile({
  buffer,
  fileName,
  folderSlug,
  folderId,
  source: `extracted-${archive.type}`,
  sourceArchive: originalName,
});
if (ingested.isErr()) throw ingested.error;
```

- [ ] **Step 3: Migrate `handleExtractJob` BSP texture insertion (around line 248-280)**

Replace with:

```typescript
const ingested = await ingestFile({
  buffer: tex.pngBuffer,
  fileName: texFileName,
  folderSlug: texFolderSlug,
  folderId: texFolderId,
  source: "bsp-extracted",
  sourceArchive: savedName,
  kind: "texture",
  mimeType: "image/png",
  width: tex.width,
  height: tex.height,
});
if (ingested.isErr()) throw ingested.error;
```

- [ ] **Step 4: Migrate `handleBatchExtractJob` -- same patterns as Step 2 and 3**

Two insertion sites: main file and BSP texture. Same `ingestFile()` calls with batch-specific variables.

- [ ] **Step 5: Migrate `handleExtractBSPJob` texture insertion**

Replace with `ingestFile()` using pre-computed `kind`, `mimeType`, `width`, `height`.

- [ ] **Step 6: Migrate `handleBatchExtractBSPJob` texture insertion**

Same pattern as Step 5 but inside a loop.

- [ ] **Step 7: Remove unused imports**

Remove direct imports of `detectKind`, `getMimeType`, `computeSha256`, `insertFileRecord` if no longer used. Keep `saveFile` only if still used directly (it shouldn't be after migration).

- [ ] **Step 8: Run CI**

Run: `pnpm run ci`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git commit -am "migrate extract-job handlers to ingestFile()"
```

---

### Task 5: Migrate folder-import-job

**Files:**
- Modify: `apps/web/src/lib/jobs/folder-import-job.server.ts`

- [ ] **Step 1: Replace the save/detect/process/hash/insert block**

Replace with:

```typescript
const ingested = await ingestFile({
  buffer,
  fileName: fileInfo.name,
  folderSlug,
  folderId,
  source: "folder-import",
  sourceArchive: sourcePath,
});
if (ingested.isErr()) {
  log.error(ingested.error, { step: "ingest-file", file: fileInfo.relativePath });
  errors++;
  continue;
}
```

- [ ] **Step 2: Remove unused imports, run CI, commit**

```bash
git commit -am "migrate folder-import-job to ingestFile()"
```

---

### Task 6: Migrate scraper jobs

**Files:**
- Modify: `apps/web/src/lib/jobs/sadgrl-job.server.ts`
- Modify: `apps/web/src/lib/jobs/texturetown-job.server.ts`
- Modify: `apps/web/src/lib/jobs/thejang-job.server.ts`

All three follow the same pattern: download buffer, saveFile, detectKind, getMimeType, processImage, computeSha256, insertFileRecord. Each can be replaced with a single `ingestFile()` call.

- [ ] **Step 1: Migrate sadgrl-job.server.ts**

Replace the per-file save/detect/process/hash/insert block with:

```typescript
const ingested = await ingestFile({
  buffer,
  fileName: filename,
  folderSlug: categoryFolder.slug,
  folderId: categoryFolder.id,
  source: "sadgrl",
  uploaderId: userId || null,
});
if (ingested.isErr()) {
  log.error(ingested.error, { step: "ingest-file", file: filename });
  errors++;
  continue;
}
```

- [ ] **Step 2: Migrate texturetown-job.server.ts**

Same pattern with `source: "texturetown"`.

- [ ] **Step 3: Migrate thejang-job.server.ts**

Same pattern with `source: "texture-station"`.

- [ ] **Step 4: Remove unused imports from all three files, run CI**

Run: `pnpm run ci`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "migrate scraper jobs to ingestFile()"
```

---

### Task 7: Clean up and verify

**Files:**
- Modify: `apps/web/src/lib/files.server.ts` (possibly remove now-unused exports)

- [ ] **Step 1: Check for any remaining direct `insertFileRecord` calls outside `ingestFile`**

Run: `grep -rn "insertFileRecord" apps/web/src/ --include="*.ts" --include="*.tsx" | grep -v "files.server.ts" | grep -v "test/"`

Expected: No results (all callers now use `ingestFile`).

- [ ] **Step 2: Check for direct `computeSha256` + `saveFile` + `insertFileRecord` patterns**

Run: `grep -rn "computeSha256" apps/web/src/ --include="*.ts" --include="*.tsx" | grep -v "files.server.ts" | grep -v "test/"`

Expected: No results outside `files.server.ts`.

- [ ] **Step 3: Run full CI**

Run: `pnpm run format && pnpm run ci`
Expected: All tests pass, no lint errors, no type errors.

- [ ] **Step 4: Final commit**

```bash
git commit -am "remove unused direct insertFileRecord/computeSha256 imports from callers"
```
