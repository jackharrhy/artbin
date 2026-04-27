/**
 * File utilities for artbin
 *
 * Handles file storage, mime type detection, preview generation, and path management.
 */

import { mkdir, writeFile, unlink, rename, stat, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, basename, extname } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import mime from "mime-types";
import { fileTypeFromBuffer } from "file-type";
import { Result } from "better-result";
import type { FileKind } from "~/db/schema";

const execAsync = promisify(exec);

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// Base directories
export const UPLOADS_DIR = join(process.cwd(), "public", "uploads");
export const TEMP_DIR = join(process.cwd(), "tmp", "uploads");

// ============================================================================
// File Kind Detection
// ============================================================================

const KIND_EXTENSIONS: Record<FileKind, string[]> = {
  texture: ["png", "jpg", "jpeg", "gif", "webp", "tga", "bmp", "pcx", "wal", "vtf", "dds"],
  model: [
    "gltf",
    "glb",
    "obj",
    "fbx",
    "md2",
    "md3",
    "mdl",
    "md5mesh",
    "md5anim",
    "ase",
    "lwo",
    "iqm",
    "blend",
  ],
  audio: ["wav", "mp3", "ogg", "flac", "m4a", "aiff"],
  map: ["bsp", "map", "vmf", "rmf"],
  archive: ["pk3", "pk4", "pak", "wad", "zip", "7z", "rar", "tar", "gz"],
  config: ["cfg", "txt", "json", "xml", "ini", "yaml", "yml", "toml", "rc", "conf"],
  other: [],
};

/**
 * Detect file kind based on extension
 */
export function detectKind(filename: string): FileKind {
  const ext = extname(filename).toLowerCase().slice(1);

  for (const [kind, extensions] of Object.entries(KIND_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return kind as FileKind;
    }
  }

  return "other";
}

/**
 * Check if a file kind is displayable as an image
 */
export function isImageKind(kind: FileKind): boolean {
  return kind === "texture";
}

/**
 * Check if a file needs preview generation (legacy formats)
 */
export function needsPreview(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return ["tga", "bmp", "pcx", "wal", "vtf", "dds"].includes(ext);
}

/**
 * Check if a file is a web-native image format
 */
export function isWebImage(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
}

// ============================================================================
// MIME Type Detection
// ============================================================================

/**
 * Custom MIME mappings for game/asset formats
 */
const CUSTOM_MIME_TYPES: Record<string, string> = {
  // Images
  wal: "image/x-wal",
  pcx: "image/x-pcx",
  tga: "image/x-tga",
  vtf: "image/x-vtf",
  dds: "image/x-dds",

  // Archives
  bsp: "application/x-bsp",
  pak: "application/x-pak",
  pk3: "application/x-pk3",
  pk4: "application/x-pk4",
  wad: "application/x-wad",

  // Models
  mdl: "model/x-mdl",
  md2: "model/x-md2",
  md3: "model/x-md3",
  md5mesh: "model/x-md5mesh",
  md5anim: "model/x-md5anim",
  ase: "model/x-ase",
  iqm: "model/x-iqm",
  lwo: "model/x-lwo",

  // Text/config files (game-specific)
  cfg: "text/plain",
  def: "text/plain",
  mtr: "text/plain",
  script: "text/plain",
  gui: "text/plain",
  skin: "text/plain",
  sndshd: "text/plain",
  af: "text/plain",
  pda: "text/plain",
  lang: "text/plain",
  dict: "text/plain",
  fx: "text/plain",
  particle: "text/plain",
  vfp: "text/plain",
  vp: "text/plain",
  fp: "text/plain",
  glsl: "text/plain",
  vert: "text/x-glsl",
  frag: "text/x-glsl",

  // Source map formats
  map: "text/plain",
  vmf: "text/plain",
  rmf: "application/x-rmf",

  // Compiled formats
  proc: "application/x-proc",
  cm: "application/x-cm",
  aas24: "application/x-aas",
  aas32: "application/x-aas",
  aas48: "application/x-aas",
  aas32_flybot: "application/x-aas",
  aas_cat: "application/x-aas",
  aas_mech: "application/x-aas",
};

/**
 * Check if a buffer appears to be text content.
 * Looks for common text patterns and absence of binary indicators.
 */
function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  // Sample the first 8KB max
  const sampleSize = Math.min(buffer.length, 8192);
  const sample = buffer.subarray(0, sampleSize);

  let nullCount = 0;
  let controlCount = 0;
  let printableCount = 0;

  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];

    // Null bytes are a strong binary indicator
    if (byte === 0) {
      nullCount++;
      // More than a few nulls = probably binary
      if (nullCount > 2) return false;
    }
    // Control characters (except common whitespace)
    else if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlCount++;
    }
    // Printable ASCII or high bytes (could be UTF-8)
    else if ((byte >= 32 && byte < 127) || byte >= 128) {
      printableCount++;
    }
  }

  // If more than 5% control characters, probably binary
  if (controlCount > sampleSize * 0.05) return false;

  // If less than 70% printable, probably binary
  if (printableCount < sampleSize * 0.7) return false;

  return true;
}

/**
 * Get MIME type for a file, using magic bytes if available
 */
export async function getMimeType(filename: string, buffer?: Buffer): Promise<string> {
  const ext = extname(filename).toLowerCase().slice(1);

  // Check custom mappings first (game formats we know about)
  if (CUSTOM_MIME_TYPES[ext]) {
    return CUSTOM_MIME_TYPES[ext];
  }

  // Try magic bytes if buffer provided
  if (buffer) {
    const detected = await fileTypeFromBuffer(buffer);
    if (detected) {
      return detected.mime;
    }
  }

  // Fall back to extension-based lookup
  const mimeType = mime.lookup(filename);
  if (mimeType) {
    return mimeType;
  }

  // If we have buffer content and couldn't identify it,
  // check if it looks like text
  if (buffer && looksLikeText(buffer)) {
    return "text/plain";
  }

  return "application/octet-stream";
}

// ============================================================================
// Path Management
// ============================================================================

/**
 * Convert a folder slug to a filesystem path
 */
export function slugToPath(slug: string): string {
  return join(UPLOADS_DIR, slug);
}

/**
 * Get the full filesystem path for a file
 */
export function getFilePath(filePath: string): string {
  return join(UPLOADS_DIR, filePath);
}

/**
 * Get the preview path for a file (adds .preview.png)
 */
export function getPreviewPath(filePath: string): string {
  return join(UPLOADS_DIR, filePath + ".preview.png");
}

/**
 * Convert a file path relative to uploads to a URL path
 */
export function filePathToUrl(filePath: string): string {
  return `/uploads/${filePath}`;
}

/**
 * Ensure a directory exists, creating it recursively if needed
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Sanitize a filename to be filesystem-safe
 */
export function sanitizeFilename(filename: string): string {
  // Replace problematic characters but keep extension
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") // Windows forbidden chars
    .replace(/\s+/g, "_") // Spaces to underscores
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^\.+/, "") // Remove leading dots
    .slice(0, 255); // Max filename length
}

/**
 * Generate a unique filename if file already exists
 */
export async function getUniqueFilename(dirPath: string, filename: string): Promise<string> {
  const fullPath = join(dirPath, filename);

  if (!existsSync(fullPath)) {
    return filename;
  }

  const ext = extname(filename);
  const base = basename(filename, ext);
  let counter = 1;
  let newFilename: string;

  do {
    newFilename = `${base}_${counter}${ext}`;
    counter++;
  } while (existsSync(join(dirPath, newFilename)));

  return newFilename;
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Save a file to the uploads directory
 */
export async function saveFile(
  buffer: Buffer,
  folderSlug: string,
  filename: string,
  overwrite = true,
): Promise<{ path: string; name: string }> {
  const sanitized = sanitizeFilename(filename);
  const dirPath = slugToPath(folderSlug);

  await ensureDir(dirPath);

  const finalName = overwrite ? sanitized : await getUniqueFilename(dirPath, sanitized);
  const fullPath = join(dirPath, finalName);

  await writeFile(fullPath, buffer);

  return {
    path: join(folderSlug, finalName),
    name: finalName,
  };
}

/**
 * Delete a file and its preview if it exists
 */
export async function deleteFile(filePath: string): Promise<void> {
  const fullPath = getFilePath(filePath);
  const previewPath = getPreviewPath(filePath);

  try {
    await unlink(fullPath);
  } catch {
    // File may not exist
  }

  try {
    await unlink(previewPath);
  } catch {
    // Preview may not exist
  }
}

/**
 * Move a file from one location to another
 */
export async function moveFile(fromPath: string, toPath: string): Promise<void> {
  const fullFromPath = getFilePath(fromPath);
  const fullToPath = getFilePath(toPath);

  await ensureDir(dirname(fullToPath));
  await rename(fullFromPath, fullToPath);

  // Also move preview if it exists
  const fromPreview = getPreviewPath(fromPath);
  const toPreview = getPreviewPath(toPath);

  try {
    await rename(fromPreview, toPreview);
  } catch {
    // Preview may not exist
  }
}

/**
 * Delete an entire folder and its contents from disk
 */
export async function deleteFolder(folderSlug: string): Promise<void> {
  const dirPath = slugToPath(folderSlug);

  if (!existsSync(dirPath)) {
    return;
  }

  // Use rm -rf for simplicity
  await execAsync(`rm -rf "${dirPath}"`);
}

// ============================================================================
// Image Processing
// ============================================================================

/**
 * Get image dimensions using ImageMagick
 */
export async function getImageDimensions(
  filePath: string,
): Promise<Result<{ width: number; height: number }, Error>> {
  try {
    const { stdout } = await execAsync(`magick identify -format "%w %h" "${filePath}[0]"`);
    const [width, height] = stdout.trim().split(" ").map(Number);
    if (width && height) {
      return Result.ok({ width, height });
    }
    return Result.err(new Error(`Could not read image dimensions for ${filePath}`));
  } catch (error) {
    return Result.err(toError(error));
  }
}

/**
 * Generate a PNG preview for a legacy format image
 */
export async function generatePreview(inputPath: string): Promise<Result<boolean, Error>> {
  const outputPath = inputPath + ".preview.png";

  try {
    await execAsync(`magick "${inputPath}" "${outputPath}"`);
    return Result.ok(true);
  } catch (error) {
    return Result.err(toError(error));
  }
}

/**
 * Process an uploaded image file:
 * - Get dimensions
 * - Generate preview if needed
 */
export async function processImage(filePath: string): Promise<
  Result<
    {
      width: number | null;
      height: number | null;
      hasPreview: boolean;
    },
    Error
  >
> {
  const fullPath = getFilePath(filePath);
  let hasPreview = false;

  // Generate preview for legacy formats
  if (needsPreview(filePath)) {
    const preview = await generatePreview(fullPath);
    if (preview.isErr()) {
      return Result.err(preview.error);
    }
    hasPreview = preview.value;
  }

  // Get dimensions from preview if it exists, otherwise from original
  const dimensionPath = hasPreview ? fullPath + ".preview.png" : fullPath;
  const dims = await getImageDimensions(dimensionPath);

  return Result.ok({
    width: dims.isOk() ? dims.value.width : null,
    height: dims.isOk() ? dims.value.height : null,
    hasPreview,
  });
}

// ============================================================================
// Temp File Management
// ============================================================================

/**
 * Save a file to the temp directory for processing
 */
export async function saveTempFile(buffer: Buffer, filename: string): Promise<string> {
  await ensureDir(TEMP_DIR);
  const sanitized = sanitizeFilename(filename);
  const tempPath = join(TEMP_DIR, `${Date.now()}_${sanitized}`);
  await writeFile(tempPath, buffer);
  return tempPath;
}

/**
 * Clean up a temp file
 */
export async function cleanupTempFile(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch {
    // Ignore errors
  }
}

/**
 * Clean up old temp files (older than 1 hour)
 */
export async function cleanupOldTempFiles(): Promise<void> {
  if (!existsSync(TEMP_DIR)) return;

  const files = await readdir(TEMP_DIR);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  for (const file of files) {
    const filePath = join(TEMP_DIR, file);
    try {
      const stats = await stat(filePath);
      if (stats.mtimeMs < oneHourAgo) {
        await unlink(filePath);
      }
    } catch {
      // Ignore errors
    }
  }
}

// ============================================================================
// File Browsing & Search
// ============================================================================

import { db, files, folders, fileTags, tags } from "~/db";
import { eq, like, and, or, inArray, desc, lt, sql } from "drizzle-orm";

export interface SearchFilesOptions {
  kind?: FileKind | FileKind[]; // Filter by file kind(s)
  query?: string; // Search filename
  tagSlug?: string; // Filter by tag
  folderIds?: string[]; // Limit to these folders (for subtree queries)
  cursor?: string; // Cursor for pagination (file ID)
  limit?: number; // Results per page
}

export interface SearchFilesResult {
  files: {
    id: string;
    path: string;
    name: string;
    kind: string | null;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    hasPreview: boolean | null;
    folderId: string;
  }[];
  nextCursor: string | null;
  total: number;
}

/**
 * Search and filter files with pagination
 */
export async function searchFiles(options: SearchFilesOptions): Promise<SearchFilesResult> {
  const { kind, query, tagSlug, folderIds, cursor, limit = 50 } = options;

  // Build conditions array
  const conditions: any[] = [];

  // Kind filter
  if (kind) {
    if (Array.isArray(kind)) {
      conditions.push(inArray(files.kind, kind));
    } else {
      conditions.push(eq(files.kind, kind));
    }
  }

  // Search query
  if (query) {
    conditions.push(like(files.name, `%${query}%`));
  }

  // Folder filter
  if (folderIds && folderIds.length > 0) {
    conditions.push(inArray(files.folderId, folderIds));
  }

  // Tag filter - need a subquery
  if (tagSlug) {
    const tag = await db.query.tags.findFirst({
      where: eq(tags.slug, tagSlug),
    });

    if (tag) {
      const taggedFileIds = await db
        .select({ fileId: fileTags.fileId })
        .from(fileTags)
        .where(eq(fileTags.tagId, tag.id));

      const ids = taggedFileIds.map((r) => r.fileId);
      if (ids.length > 0) {
        conditions.push(inArray(files.id, ids));
      } else {
        // No files have this tag, return empty
        return { files: [], nextCursor: null, total: 0 };
      }
    } else {
      // Tag doesn't exist, return empty
      return { files: [], nextCursor: null, total: 0 };
    }
  }

  // Cursor pagination
  if (cursor) {
    // Get the createdAt of cursor file for consistent ordering
    const cursorFile = await db.query.files.findFirst({
      where: eq(files.id, cursor),
    });
    if (cursorFile && cursorFile.createdAt) {
      conditions.push(
        or(
          lt(files.createdAt, cursorFile.createdAt),
          and(eq(files.createdAt, cursorFile.createdAt), lt(files.id, cursor)),
        ),
      );
    }
  }

  // Execute query
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: files.id,
      path: files.path,
      name: files.name,
      kind: files.kind,
      mimeType: files.mimeType,
      size: files.size,
      width: files.width,
      height: files.height,
      hasPreview: files.hasPreview,
      folderId: files.folderId,
    })
    .from(files)
    .where(whereClause)
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(limit + 1); // Fetch one extra to check if there's more

  // Get total count (without cursor/limit)
  const countConditions = conditions.filter((_, i) => {
    // Remove cursor condition for total count
    return !cursor || i < conditions.length - 1;
  });
  const countWhere = countConditions.length > 0 ? and(...countConditions) : undefined;

  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(files)
    .where(countWhere);

  // Check if there's more
  const hasMore = results.length > limit;
  const returnedFiles = hasMore ? results.slice(0, limit) : results;
  const nextCursor = hasMore ? returnedFiles[returnedFiles.length - 1].id : null;

  return {
    files: returnedFiles,
    nextCursor,
    total,
  };
}

/**
 * Get all descendant folder IDs for a folder (recursive)
 */
export async function getDescendantFolderIds(folderId: string): Promise<string[]> {
  const result: string[] = [folderId];

  async function collectChildren(parentId: string) {
    const children = await db.query.folders.findMany({
      where: eq(folders.parentId, parentId),
    });

    for (const child of children) {
      result.push(child.id);
      await collectChildren(child.id);
    }
  }

  await collectChildren(folderId);
  return result;
}

/**
 * Get counts of files by kind, optionally scoped to folder IDs
 */
export async function getFileCountsByKind(folderIds?: string[]): Promise<Record<string, number>> {
  const condition =
    folderIds && folderIds.length > 0 ? inArray(files.folderId, folderIds) : undefined;

  const results = await db
    .select({
      kind: files.kind,
      count: sql<number>`count(*)`,
    })
    .from(files)
    .where(condition)
    .groupBy(files.kind);

  const counts: Record<string, number> = {
    texture: 0,
    model: 0,
    audio: 0,
    map: 0,
    archive: 0,
    config: 0,
    other: 0,
  };

  let total = 0;
  for (const row of results) {
    if (row.kind) {
      counts[row.kind] = row.count;
      total += row.count;
    }
  }
  counts.all = total;

  return counts;
}

// ============================================================================
// File Record Management (with folder count sync)
// ============================================================================

export interface CreateFileRecord {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
  kind: FileKind;
  width?: number | null;
  height?: number | null;
  hasPreview?: boolean;
  folderId: string;
  uploaderId?: string | null;
  source?: string | null;
  sourceArchive?: string | null;
}

/**
 * Insert a file record and increment the parent folder's file count.
 * Use this instead of direct db.insert(files) to keep counts in sync.
 */
export async function insertFileRecord(record: CreateFileRecord): Promise<Result<void, Error>> {
  try {
    await db.insert(files).values({
      id: record.id,
      path: record.path,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      kind: record.kind,
      width: record.width ?? null,
      height: record.height ?? null,
      hasPreview: record.hasPreview ?? false,
      folderId: record.folderId,
      uploaderId: record.uploaderId ?? null,
      source: record.source ?? null,
      sourceArchive: record.sourceArchive ?? null,
    });

    // Increment folder's file count
    if (record.folderId) {
      await db
        .update(folders)
        .set({ fileCount: sql`file_count + 1` })
        .where(eq(folders.id, record.folderId));
    }

    return Result.ok(undefined);
  } catch (error) {
    return Result.err(toError(error));
  }
}

/**
 * Delete a file record and decrement the parent folder's file count.
 */
export async function deleteFileRecord(fileId: string): Promise<Result<void, Error>> {
  try {
    // Get the file first to know which folder to update
    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });

    if (!file) return Result.ok(undefined);

    // Delete the file record
    await db.delete(files).where(eq(files.id, fileId));

    // Decrement folder's file count
    if (file.folderId) {
      await db
        .update(folders)
        .set({ fileCount: sql`MAX(0, file_count - 1)` })
        .where(eq(folders.id, file.folderId));
    }

    return Result.ok(undefined);
  } catch (error) {
    return Result.err(toError(error));
  }
}

/**
 * Bulk increment folder file count (for batch imports)
 */
export async function incrementFolderFileCount(folderId: string, count: number = 1): Promise<void> {
  await db
    .update(folders)
    .set({ fileCount: sql`file_count + ${count}` })
    .where(eq(folders.id, folderId));
}

/**
 * Recalculate file counts for a set of folders.
 * Call this after batch file operations to sync counts.
 */
export async function recalculateFolderCounts(folderIds: string[]): Promise<void> {
  for (const folderId of folderIds) {
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)` })
      .from(files)
      .where(eq(files.folderId, folderId));

    await db.update(folders).set({ fileCount: c }).where(eq(folders.id, folderId));
  }
}
