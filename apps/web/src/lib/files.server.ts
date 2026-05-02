import { mkdir, writeFile, unlink, rename, stat, readdir, readFile } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { join, dirname, basename, extname } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { Result } from "better-result";
import {
  detectKind,
  isImageKind,
  needsPreview,
  isWebImage,
  type FileKind,
} from "@artbin/core/detection/kind";
import { getMimeType } from "@artbin/core/detection/mime";
import { sanitizeFilename } from "@artbin/core/detection/filenames";
import { nanoid } from "nanoid";

const execAsync = promisify(exec);

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// Re-export shared detection utilities for backward compatibility
export {
  detectKind,
  isImageKind,
  needsPreview,
  isWebImage,
  getMimeType,
  sanitizeFilename,
  type FileKind,
};

// Base directories
export const UPLOADS_DIR = join(process.cwd(), "public", "uploads");
export const TEMP_DIR = join(process.cwd(), "tmp", "uploads");

export function slugToPath(slug: string): string {
  return join(UPLOADS_DIR, slug);
}

export function getFilePath(filePath: string): string {
  return join(UPLOADS_DIR, filePath);
}

export function getPreviewPath(filePath: string): string {
  return join(UPLOADS_DIR, filePath + ".preview.png");
}

/** Compute sha256 hex digest from a Buffer. */
export function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Compute sha256 hex digest by streaming a file from disk. */
export function computeSha256FromFile(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function filePathToUrl(filePath: string): string {
  return `/uploads/${filePath}`;
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

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

export async function deleteFolder(folderSlug: string): Promise<void> {
  const dirPath = slugToPath(folderSlug);

  if (!existsSync(dirPath)) {
    return;
  }

  // Use rm -rf for simplicity
  await execAsync(`rm -rf "${dirPath}"`);
}

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

export async function generatePreview(inputPath: string): Promise<Result<boolean, Error>> {
  const outputPath = inputPath + ".preview.png";

  try {
    await execAsync(`magick "${inputPath}" "${outputPath}"`);
    return Result.ok(true);
  } catch (error) {
    return Result.err(toError(error));
  }
}

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

  // Generate preview for legacy formats (non-fatal if it fails)
  if (needsPreview(filePath)) {
    const preview = await generatePreview(fullPath);
    if (preview.isOk()) {
      hasPreview = preview.value;
    }
    // If preview generation fails (e.g. ImageMagick not installed),
    // continue without a preview rather than failing the entire upload
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

export async function saveTempFile(buffer: Buffer, filename: string): Promise<string> {
  await ensureDir(TEMP_DIR);
  const sanitized = sanitizeFilename(filename);
  const tempPath = join(TEMP_DIR, `${Date.now()}_${sanitized}`);
  await writeFile(tempPath, buffer);
  return tempPath;
}

export async function cleanupTempFile(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch {
    // Ignore errors
  }
}

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

import { db } from "~/db/connection.server";
import { files, folders } from "~/db";
import { eq, inArray, sql } from "drizzle-orm";

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
  sha256?: string | null;
  status?: "pending" | "approved" | "rejected";
  suggestedFolderId?: string | null;
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
      sha256: record.sha256 ?? null,
      status: record.status ?? "approved",
      suggestedFolderId: record.suggestedFolderId ?? null,
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

/**
 * Unified file ingestion: save to disk, detect type, process images, hash, and insert DB record.
 * Orchestrates the 6 common steps every file upload pathway performs.
 */
export async function ingestFile(
  opts: IngestFileOptions,
): Promise<Result<IngestFileResult, Error>> {
  try {
    // 1. Save file to disk
    const { path: savedPath, name: savedName } = await saveFile(
      opts.buffer,
      opts.folderSlug,
      opts.fileName,
      true,
    );

    // 2. Detect file kind (unless pre-computed)
    const kind: FileKind = (opts.kind as FileKind) ?? detectKind(savedName);

    // 3. Detect MIME type (unless pre-computed)
    const mimeType = opts.mimeType ?? (await getMimeType(savedName, opts.buffer));

    // 4. Process image (generate preview + get dimensions)
    let width: number | null = opts.width ?? null;
    let height: number | null = opts.height ?? null;
    let hasPreview = false;

    const dimensionsPreComputed = opts.width !== undefined && opts.height !== undefined;
    const shouldProcessImages = opts.processImages !== false;

    if (isImageKind(kind) && shouldProcessImages && !dimensionsPreComputed) {
      const imageInfo = await processImage(savedPath);
      if (imageInfo.isOk()) {
        width = imageInfo.value.width;
        height = imageInfo.value.height;
        hasPreview = imageInfo.value.hasPreview;
      }
    } else if (isImageKind(kind) && !shouldProcessImages && needsPreview(savedName)) {
      // Even when full image processing is skipped (e.g. CLI uploads for speed),
      // still generate previews for non-web-native formats (TGA, BMP, PCX, etc.)
      // since browsers cannot render them at all without a PNG preview.
      const preview = await generatePreview(getFilePath(savedPath));
      if (preview.isOk()) {
        hasPreview = preview.value;
      }
    }

    // 5. Hash the file contents
    const sha256 = computeSha256(opts.buffer);

    // 6. Create the DB record
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
    if (inserted.isErr()) return Result.err(inserted.error);

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

export async function incrementFolderFileCount(folderId: string, count: number = 1): Promise<void> {
  await db
    .update(folders)
    .set({ fileCount: sql`file_count + ${count}` })
    .where(eq(folders.id, folderId));
}

export async function recalculateFolderCounts(folderIds: string[]): Promise<void> {
  for (const folderId of folderIds) {
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)` })
      .from(files)
      .where(eq(files.folderId, folderId));

    await db.update(folders).set({ fileCount: c }).where(eq(folders.id, folderId));
  }
}

/**
 * Sentinel value for `getOrCreateFolder` parentId parameter.
 * Use this instead of `null` to explicitly mark a folder as root-level.
 * This prevents accidental root-level folder creation when a parentId
 * is simply missing or forgotten.
 */
export const ROOT_FOLDER = Symbol.for("ROOT_FOLDER");

/**
 * Get an existing folder by slug, or create one if it doesn't exist.
 * `parentId` is required -- pass `ROOT_FOLDER` for root-level folders,
 * or a parent folder ID string for nested folders.
 */
export async function getOrCreateFolder(
  slug: string,
  name: string,
  parentId: typeof ROOT_FOLDER | string,
  description?: string,
): Promise<string> {
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (existing) {
    return existing.id;
  }

  const id = nanoid();
  await db.insert(folders).values({
    id,
    name,
    slug,
    parentId: parentId === ROOT_FOLDER ? null : parentId,
    ...(description ? { description } : {}),
  });

  await ensureDir(slugToPath(slug));

  return id;
}
