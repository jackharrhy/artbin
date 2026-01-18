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
import type { FileKind } from "~/db/schema";

const execAsync = promisify(exec);

// Base directories
export const UPLOADS_DIR = join(process.cwd(), "public", "uploads");
export const TEMP_DIR = join(process.cwd(), "tmp", "uploads");

// ============================================================================
// File Kind Detection
// ============================================================================

const KIND_EXTENSIONS: Record<FileKind, string[]> = {
  texture: ["png", "jpg", "jpeg", "gif", "webp", "tga", "bmp", "pcx", "wal", "vtf", "dds"],
  model: ["gltf", "glb", "obj", "fbx", "md2", "md3", "mdl", "iqm", "blend"],
  audio: ["wav", "mp3", "ogg", "flac", "m4a", "aiff"],
  map: ["bsp", "map", "vmf", "rmf"],
  archive: ["pk3", "pak", "wad", "zip", "7z", "rar", "tar", "gz"],
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
 * Get MIME type for a file, using magic bytes if available
 */
export async function getMimeType(filename: string, buffer?: Buffer): Promise<string> {
  // Try magic bytes first if buffer provided
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
  
  // Custom mappings for game formats
  const ext = extname(filename).toLowerCase().slice(1);
  const customMimes: Record<string, string> = {
    wal: "image/x-wal",
    pcx: "image/x-pcx",
    tga: "image/x-tga",
    vtf: "image/x-vtf",
    dds: "image/x-dds",
    bsp: "application/x-bsp",
    pak: "application/x-pak",
    pk3: "application/x-pk3",
    wad: "application/x-wad",
    mdl: "model/x-mdl",
    md2: "model/x-md2",
    md3: "model/x-md3",
    cfg: "text/plain",
  };
  
  return customMimes[ext] || "application/octet-stream";
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
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")  // Windows forbidden chars
    .replace(/\s+/g, "_")                      // Spaces to underscores
    .replace(/_+/g, "_")                       // Collapse multiple underscores
    .replace(/^\.+/, "")                       // Remove leading dots
    .slice(0, 255);                            // Max filename length
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
  overwrite = true
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
  filePath: string
): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execAsync(
      `magick identify -format "%w %h" "${filePath}[0]"`
    );
    const [width, height] = stdout.trim().split(" ").map(Number);
    if (width && height) {
      return { width, height };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a PNG preview for a legacy format image
 */
export async function generatePreview(inputPath: string): Promise<boolean> {
  const outputPath = inputPath + ".preview.png";
  
  try {
    await execAsync(`magick "${inputPath}" "${outputPath}"`);
    return true;
  } catch (error) {
    console.error(`Failed to generate preview for ${inputPath}:`, error);
    return false;
  }
}

/**
 * Process an uploaded image file:
 * - Get dimensions
 * - Generate preview if needed
 */
export async function processImage(filePath: string): Promise<{
  width: number | null;
  height: number | null;
  hasPreview: boolean;
}> {
  const fullPath = getFilePath(filePath);
  let hasPreview = false;
  
  // Generate preview for legacy formats
  if (needsPreview(filePath)) {
    hasPreview = await generatePreview(fullPath);
  }
  
  // Get dimensions from preview if it exists, otherwise from original
  const dimensionPath = hasPreview ? fullPath + ".preview.png" : fullPath;
  const dims = await getImageDimensions(dimensionPath);
  
  return {
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    hasPreview,
  };
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
