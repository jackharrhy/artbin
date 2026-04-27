/**
 * Folder preview generation
 *
 * Creates a 3x3 grid preview image from textures in a folder using Sharp.
 */

import sharp from "sharp";
import { db } from "~/db/connection.server";
import { files, folders } from "~/db";
import { eq, inArray, desc } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { UPLOADS_DIR, getFilePath, slugToPath, ensureDir } from "./files.server";

// Preview configuration
const GRID_SIZE = 3; // 3x3 grid
const THUMB_SIZE = 128; // Each thumbnail is 128x128
const PREVIEW_SIZE = GRID_SIZE * THUMB_SIZE; // 384x384 total

export function getFolderPreviewPath(folderSlug: string): string {
  return `${folderSlug}/.folder-preview.png`;
}

export function getFolderPreviewFullPath(folderSlug: string): string {
  return join(UPLOADS_DIR, getFolderPreviewPath(folderSlug));
}

/**
 * Get texture files from a folder for preview generation
 * Returns up to 9 texture files, preferring those with previews
 */
async function getPreviewTextures(folderId: string): Promise<string[]> {
  // Get textures from this folder, preferring ones with previews
  const textures = await db
    .select({
      path: files.path,
      hasPreview: files.hasPreview,
    })
    .from(files)
    .where(eq(files.folderId, folderId))
    .orderBy(desc(files.hasPreview), desc(files.createdAt))
    .limit(GRID_SIZE * GRID_SIZE * 2); // Get more to filter

  // Filter to only image-like files and get paths to displayable images
  return textures
    .filter((t) => {
      if (!t.path) return false;
      const ext = t.path.toLowerCase().split(".").pop();
      return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tga", "pcx"].includes(ext || "");
    })
    .slice(0, GRID_SIZE * GRID_SIZE)
    .map((t) => {
      if (t.hasPreview) {
        return join(UPLOADS_DIR, t.path + ".preview.png");
      }
      return join(UPLOADS_DIR, t.path);
    })
    .filter((p) => existsSync(p));
}

async function getAllDescendantFolderIds(folderId: string): Promise<string[]> {
  const result: string[] = [folderId];

  const childFolders = await db.query.folders.findMany({
    where: eq(folders.parentId, folderId),
  });

  for (const child of childFolders) {
    const descendants = await getAllDescendantFolderIds(child.id);
    result.push(...descendants);
  }

  return result;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get textures from a folder and all its descendants, randomly sampled
 */
async function getPreviewTexturesRecursive(folderId: string): Promise<string[]> {
  // Get all descendant folder IDs
  const allFolderIds = await getAllDescendantFolderIds(folderId);

  // Get only image files (textures) from all these folders
  // Filter by kind to avoid trying to process audio, maps, etc.
  const textures = await db
    .select({
      path: files.path,
      hasPreview: files.hasPreview,
    })
    .from(files)
    .where(inArray(files.folderId, allFolderIds));

  // Filter to only image-like files
  const imageTextures = textures.filter((t) => {
    if (!t.path) return false;
    const ext = t.path.toLowerCase().split(".").pop();
    // Only include known image formats
    return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tga", "pcx"].includes(ext || "");
  });

  if (imageTextures.length === 0) {
    return [];
  }

  // Shuffle to get random sampling across all folders
  const shuffled = shuffleArray(imageTextures);

  // Get paths to the actual displayable images
  const paths: string[] = [];

  for (const t of shuffled) {
    if (paths.length >= GRID_SIZE * GRID_SIZE) break;
    if (!t.path) continue;

    const imgPath = t.hasPreview
      ? join(UPLOADS_DIR, t.path + ".preview.png")
      : join(UPLOADS_DIR, t.path);

    if (existsSync(imgPath) && !paths.includes(imgPath)) {
      paths.push(imgPath);
    }
  }

  return paths;
}

export async function generateFolderPreview(folderId: string): Promise<string | null> {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    console.error(`[FolderPreview] Folder not found: ${folderId}`);
    return null;
  }

  // Get textures for the preview
  const texturePaths = await getPreviewTexturesRecursive(folderId);

  if (texturePaths.length === 0) {
    console.log(`[FolderPreview] No textures found for folder: ${folder.slug}`);
    return null;
  }

  try {
    // Create thumbnail buffers for each texture
    const thumbnails: { input: Buffer; top: number; left: number }[] = [];

    for (let i = 0; i < texturePaths.length && i < GRID_SIZE * GRID_SIZE; i++) {
      const texturePath = texturePaths[i];
      const row = Math.floor(i / GRID_SIZE);
      const col = i % GRID_SIZE;

      try {
        // Resize to thumbnail, cover the area
        const thumb = await sharp(texturePath)
          .resize(THUMB_SIZE, THUMB_SIZE, {
            fit: "cover",
            position: "center",
          })
          .png()
          .toBuffer();

        thumbnails.push({
          input: thumb,
          top: row * THUMB_SIZE,
          left: col * THUMB_SIZE,
        });
      } catch (err) {
        console.error(`[FolderPreview] Failed to process ${texturePath}:`, err);
        // Continue with other images
      }
    }

    if (thumbnails.length === 0) {
      console.log(`[FolderPreview] No valid thumbnails generated for: ${folder.slug}`);
      return null;
    }

    // Create the composite image
    // Start with a gray background
    const composite = sharp({
      create: {
        width: PREVIEW_SIZE,
        height: PREVIEW_SIZE,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .composite(thumbnails)
      .png();

    // Ensure the folder directory exists
    await ensureDir(slugToPath(folder.slug));

    // Save the preview
    const previewPath = getFolderPreviewPath(folder.slug);
    const fullPath = getFolderPreviewFullPath(folder.slug);

    await composite.toFile(fullPath);

    // Update folder record with preview path
    await db.update(folders).set({ previewPath }).where(eq(folders.id, folderId));

    console.log(
      `[FolderPreview] Generated preview for: ${folder.slug} (${thumbnails.length} images)`,
    );
    return previewPath;
  } catch (err) {
    console.error(`[FolderPreview] Failed to generate preview for ${folder.slug}:`, err);
    return null;
  }
}

export async function deleteFolderPreview(folderId: string): Promise<void> {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder || !folder.previewPath) return;

  try {
    const fullPath = join(UPLOADS_DIR, folder.previewPath);
    await unlink(fullPath);
  } catch {
    // Ignore if file doesn't exist
  }

  await db.update(folders).set({ previewPath: null }).where(eq(folders.id, folderId));
}

export async function regenerateAllFolderPreviews(): Promise<number> {
  const allFolders = await db.query.folders.findMany();
  let generated = 0;

  for (const folder of allFolders) {
    const preview = await generateFolderPreview(folder.id);
    if (preview) generated++;
  }

  return generated;
}
