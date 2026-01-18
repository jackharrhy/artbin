/**
 * Folder preview generation
 * 
 * Creates a 3x3 grid preview image from textures in a folder using Sharp.
 */

import sharp from "sharp";
import { db, files, folders } from "~/db";
import { eq, inArray, desc } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { UPLOADS_DIR, getFilePath, slugToPath, ensureDir } from "./files.server";

// Preview configuration
const GRID_SIZE = 3;          // 3x3 grid
const THUMB_SIZE = 128;       // Each thumbnail is 128x128
const PREVIEW_SIZE = GRID_SIZE * THUMB_SIZE;  // 384x384 total

/**
 * Get the preview image path for a folder
 */
export function getFolderPreviewPath(folderSlug: string): string {
  return `${folderSlug}/.folder-preview.png`;
}

/**
 * Get the full filesystem path for a folder preview
 */
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
    .limit(GRID_SIZE * GRID_SIZE);

  // Get paths to the actual displayable images
  return textures
    .filter((t) => t.path)
    .map((t) => {
      if (t.hasPreview) {
        return join(UPLOADS_DIR, t.path + ".preview.png");
      }
      return join(UPLOADS_DIR, t.path);
    })
    .filter((p) => existsSync(p));
}

/**
 * Get textures from a folder and all its descendants
 */
async function getPreviewTexturesRecursive(folderId: string): Promise<string[]> {
  // First try to get textures from this folder directly
  const directTextures = await getPreviewTextures(folderId);
  if (directTextures.length >= GRID_SIZE * GRID_SIZE) {
    return directTextures.slice(0, GRID_SIZE * GRID_SIZE);
  }

  // If not enough, also look in child folders
  const childFolders = await db.query.folders.findMany({
    where: eq(folders.parentId, folderId),
  });

  const allTextures = [...directTextures];

  for (const child of childFolders) {
    if (allTextures.length >= GRID_SIZE * GRID_SIZE) break;

    const childTextures = await getPreviewTextures(child.id);
    for (const texture of childTextures) {
      if (allTextures.length >= GRID_SIZE * GRID_SIZE) break;
      if (!allTextures.includes(texture)) {
        allTextures.push(texture);
      }
    }
  }

  return allTextures.slice(0, GRID_SIZE * GRID_SIZE);
}

/**
 * Generate a 3x3 preview grid for a folder
 */
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
    await db
      .update(folders)
      .set({ previewPath })
      .where(eq(folders.id, folderId));

    console.log(`[FolderPreview] Generated preview for: ${folder.slug} (${thumbnails.length} images)`);
    return previewPath;
  } catch (err) {
    console.error(`[FolderPreview] Failed to generate preview for ${folder.slug}:`, err);
    return null;
  }
}

/**
 * Delete a folder's preview image
 */
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

  await db
    .update(folders)
    .set({ previewPath: null })
    .where(eq(folders.id, folderId));
}

/**
 * Regenerate previews for all folders that have textures
 */
export async function regenerateAllFolderPreviews(): Promise<number> {
  const allFolders = await db.query.folders.findMany();
  let generated = 0;

  for (const folder of allFolders) {
    const preview = await generateFolderPreview(folder.id);
    if (preview) generated++;
  }

  return generated;
}
