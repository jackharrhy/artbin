# Unified File Ingest Pipeline Design

**Goal:** Replace 14 separate file upload/import code paths with a single `ingestFile()` function that handles the common save-detect-process-hash-insert pipeline, configured via an options object.

**Context:** The codebase has 14 pathways that all do the same 6 steps in slightly different orders with slightly different options. Bugs (missing sha256, skipped image processing, wrong folder assignment, inconsistent source strings) have been introduced because fixes to one pathway don't propagate to the others. The `insertFileRecord` function is already a single insertion point, but the 5 steps before it are duplicated everywhere.

## Current State

Every pathway does these steps:

1. **Save to disk** -- `saveFile(buffer, folderSlug, fileName, true)`
2. **Detect kind** -- `detectKind(savedName)`
3. **Detect MIME** -- `getMimeType(savedName, buffer)`
4. **Process image** -- `processImage(filePath)` for dimensions + preview (some pathways skip this)
5. **Hash** -- `computeSha256(buffer)`
6. **Insert record** -- `insertFileRecord({ ... })`

The differences between pathways are configuration, not logic:

| Dimension | Values |
|-----------|--------|
| `source` | `"upload"`, `"cli-upload"`, `"extracted-pk3"`, `"extracted-pak"`, `"bsp-extracted"`, `"folder-import"`, `"sadgrl"`, `"texturetown"`, `"texture-station"` |
| `status` | `"approved"` (default), `"pending"` (non-admin uploads) |
| `processImages` | `true` (default), `false` (CLI uploads skip for speed) |
| `uploaderId` | set for user-initiated uploads, null for jobs |
| `sourceArchive` | set when file came from an archive, null otherwise |
| `suggestedFolderId` | set for non-admin uploads, null otherwise |
| Pre-computed values | BSP texture extraction provides `width`/`height` directly from the BSP data |

## Design

### `ingestFile()` function

Lives in `apps/web/src/lib/files.server.ts` alongside the existing `saveFile`, `insertFileRecord`, etc.

```typescript
interface IngestFileOptions {
  // Required
  buffer: Buffer;
  fileName: string;
  folderSlug: string;
  folderId: string;
  source: string;

  // Optional behavior controls
  status?: "approved" | "pending";         // default: "approved"
  uploaderId?: string | null;              // default: null
  sourceArchive?: string | null;           // default: null
  suggestedFolderId?: string | null;       // default: null
  processImages?: boolean;                 // default: true

  // Pre-computed values (skip detection if provided)
  kind?: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
}

interface IngestFileResult {
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
```

Implementation (pseudocode):

```typescript
export async function ingestFile(opts: IngestFileOptions): Promise<Result<IngestFileResult, Error>> {
  // 1. Save to disk
  const { path: savedPath, name: savedName } = await saveFile(
    opts.buffer, opts.folderSlug, opts.fileName, true
  );

  // 2. Detect kind + mime (skip if pre-computed)
  const kind = opts.kind ?? detectKind(savedName);
  const mimeType = opts.mimeType ?? await getMimeType(savedName, opts.buffer);

  // 3. Process image (skip if disabled or pre-computed dimensions)
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

  // 4. Hash
  const sha256 = computeSha256(opts.buffer);

  // 5. Insert record
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

  if (inserted.isErr()) return inserted;

  return Result.ok({
    fileId, path: savedPath, name: savedName, kind, mimeType,
    sha256, width, height, hasPreview,
  });
}
```

### What stays in callers

Each pathway retains its own:
- **File byte acquisition** -- form upload parsing, archive extraction, HTTP download, disk read
- **Folder resolution** -- slug lookup, folder creation, inbox session, `getOrCreateFolder`
- **Error handling** -- per-file try/catch, progress reporting, batch counting
- **Post-ingest actions** -- BSP job queuing, folder preview generation, folder count recalculation

The callers simplify from ~30 lines of save/detect/process/hash/insert to a single `ingestFile()` call.

### Migration per pathway

| Pathway | What changes |
|---------|-------------|
| Web admin upload | Replace lines 150-187 with `ingestFile({ processImages: true, source: "upload" })` |
| Web non-admin upload | Replace lines 231-309 with `ingestFile({ status: "pending", source: "upload", suggestedFolderId })` |
| CLI admin upload | Replace lines 111-139 with `ingestFile({ processImages: false, source: "cli-upload" })` |
| CLI non-admin upload | Replace lines 212-242 with `ingestFile({ processImages: false, status: "pending", source: "cli-upload" })` |
| Extract-archive job | Replace per-file block with `ingestFile({ source: "extracted-" + type, sourceArchive })` |
| Extract-BSP job | Replace per-texture block with `ingestFile({ source: "bsp-extracted", kind: "texture", mimeType: "image/png", width: tex.width, height: tex.height })` |
| Batch-extract jobs | Same as single-archive/BSP but in loops |
| Folder import job | Replace per-file block with `ingestFile({ source: "folder-import", sourceArchive: sourcePath })` |
| Sadgrl job | Replace per-file block with `ingestFile({ source: "sadgrl" })` |
| TextureTown job | Replace per-file block with `ingestFile({ source: "texturetown" })` |
| TheJang job | Replace per-file block with `ingestFile({ source: "texture-station" })` |

### Testing

- Unit test `ingestFile()` directly with mocked `saveFile`/`processImage`
- Test with `processImages: false` to verify image processing is skipped
- Test with pre-computed `kind`/`mimeType` to verify detection is skipped
- Test with `status: "pending"` to verify non-approved records
- Verify existing pathway tests still pass (they exercise callers which now delegate to `ingestFile`)

### What this does NOT change

- The `insertFileRecord` function stays as-is (it's already the single DB insertion point)
- The `saveFile` function stays as-is
- Folder creation logic stays in callers
- The scraper jobs keep their own folder resolution + HTTP download logic
- No schema changes
