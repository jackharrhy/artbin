import { mkdir, writeFile, unlink, rename, stat, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, basename, extname } from "path";
import { exec } from "child_process";
import { promisify } from "util";
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
import { files, folders, fileTags, tags } from "~/db";
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
