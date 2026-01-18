/**
 * Folder operations - move, rename, etc.
 */

import { db, folders, files, type Folder } from "~/db";
import { eq, like, sql } from "drizzle-orm";
import { rename, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { UPLOADS_DIR, ensureDir } from "./files.server";
import { generateFolderPreview } from "./folder-preview.server";

// ============================================================================
// Types
// ============================================================================

export interface MoveFolderResult {
  success: boolean;
  error?: string;
  folder?: Folder;
  movedFolders: number;
  movedFiles: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all descendant folders (children, grandchildren, etc.)
 */
async function getDescendantFolders(folderId: string): Promise<Folder[]> {
  const descendants: Folder[] = [];
  const queue = [folderId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await db.query.folders.findMany({
      where: eq(folders.parentId, parentId),
    });

    for (const child of children) {
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

/**
 * Check if moving folder would create a cycle (folder can't be moved into its own descendant)
 */
async function wouldCreateCycle(folderId: string, newParentId: string | null): Promise<boolean> {
  if (!newParentId) return false;

  // Check if newParentId is the folder itself
  if (newParentId === folderId) return true;

  // Check if newParentId is a descendant of folderId
  const descendants = await getDescendantFolders(folderId);
  return descendants.some((d) => d.id === newParentId);
}

/**
 * Generate a URL-safe slug from a name
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ============================================================================
// Main Operations
// ============================================================================

/**
 * Move a folder to a new parent (or to root if newParentId is null)
 * 
 * This updates:
 * - The folder's parentId and slug
 * - All descendant folders' slugs
 * - All files' paths in the affected folders
 * - The actual filesystem directories
 */
export async function moveFolder(
  folderId: string,
  newParentId: string | null
): Promise<MoveFolderResult> {
  // Get the folder to move
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    return { success: false, error: "Folder not found", movedFolders: 0, movedFiles: 0 };
  }

  // If already at this parent, nothing to do
  if (folder.parentId === newParentId) {
    return { success: true, folder, movedFolders: 0, movedFiles: 0 };
  }

  // Check for cycles
  if (await wouldCreateCycle(folderId, newParentId)) {
    return { success: false, error: "Cannot move folder into its own descendant", movedFolders: 0, movedFiles: 0 };
  }

  // Get the new parent folder (if not moving to root)
  let newParentSlug = "";
  if (newParentId) {
    const newParent = await db.query.folders.findFirst({
      where: eq(folders.id, newParentId),
    });
    if (!newParent) {
      return { success: false, error: "Parent folder not found", movedFolders: 0, movedFiles: 0 };
    }
    newParentSlug = newParent.slug;
  }

  // Calculate new slug for the folder
  const folderBaseName = folder.slug.includes("/")
    ? folder.slug.split("/").pop()!
    : folder.slug;
  const newSlug = newParentSlug ? `${newParentSlug}/${folderBaseName}` : folderBaseName;

  // Check if new slug already exists
  if (newSlug !== folder.slug) {
    const existingFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, newSlug),
    });
    if (existingFolder) {
      return { success: false, error: `A folder already exists at "${newSlug}"`, movedFolders: 0, movedFiles: 0 };
    }
  }

  // Get all descendants that need slug updates
  const descendants = await getDescendantFolders(folderId);
  const oldSlug = folder.slug;

  // Prepare filesystem paths
  const oldPath = join(UPLOADS_DIR, oldSlug);
  const newPath = join(UPLOADS_DIR, newSlug);

  // Ensure the new parent directory exists
  if (newParentSlug) {
    await ensureDir(join(UPLOADS_DIR, newParentSlug));
  }

  // Check filesystem state
  if (!existsSync(oldPath)) {
    // Directory doesn't exist - just update DB
    console.warn(`[moveFolder] Source directory doesn't exist: ${oldPath}`);
  } else if (existsSync(newPath)) {
    return { success: false, error: `Directory already exists at "${newSlug}"`, movedFolders: 0, movedFiles: 0 };
  }

  let movedFolders = 0;
  let movedFiles = 0;

  try {
    // Update database - folder and all descendants
    // We need to update slugs by replacing the old prefix with the new one
    
    // Update the main folder
    await db
      .update(folders)
      .set({
        parentId: newParentId,
        slug: newSlug,
      })
      .where(eq(folders.id, folderId));
    movedFolders++;

    // Update all descendant folders' slugs
    for (const descendant of descendants) {
      const descendantNewSlug = descendant.slug.replace(oldSlug, newSlug);
      await db
        .update(folders)
        .set({ slug: descendantNewSlug })
        .where(eq(folders.id, descendant.id));
      movedFolders++;
    }

    // Update all files in the moved folder and its descendants
    // Files have path like "old-slug/subdir/file.png" that needs to become "new-slug/subdir/file.png"
    const affectedFolderIds = [folderId, ...descendants.map((d) => d.id)];
    
    for (const affectedFolderId of affectedFolderIds) {
      // Get all files in this folder
      const folderFiles = await db.query.files.findMany({
        where: eq(files.folderId, affectedFolderId),
      });

      for (const file of folderFiles) {
        const newFilePath = file.path.replace(oldSlug, newSlug);
        await db
          .update(files)
          .set({ path: newFilePath })
          .where(eq(files.id, file.id));
        movedFiles++;
      }
    }

    // Move the actual directory on the filesystem
    if (existsSync(oldPath)) {
      await rename(oldPath, newPath);
    }

    // Regenerate preview for the folder (and new parent if applicable)
    try {
      await generateFolderPreview(folderId);
      if (newParentId) {
        await generateFolderPreview(newParentId);
      }
      // Also regenerate for old parent if it had one
      if (folder.parentId) {
        await generateFolderPreview(folder.parentId);
      }
    } catch (err) {
      console.error("[moveFolder] Failed to regenerate previews:", err);
      // Non-fatal, continue
    }

    // Fetch the updated folder
    const updatedFolder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });

    return {
      success: true,
      folder: updatedFolder || undefined,
      movedFolders,
      movedFiles,
    };
  } catch (error) {
    console.error("[moveFolder] Error:", error);
    return {
      success: false,
      error: `Move failed: ${error instanceof Error ? error.message : String(error)}`,
      movedFolders,
      movedFiles,
    };
  }
}

/**
 * Create a new folder and optionally move existing folders into it
 */
export async function createFolderAndMoveChildren(
  name: string,
  parentId: string | null,
  childFolderIds: string[]
): Promise<MoveFolderResult> {
  const { nanoid } = await import("nanoid");

  // Generate slug
  let parentSlug = "";
  if (parentId) {
    const parent = await db.query.folders.findFirst({
      where: eq(folders.id, parentId),
    });
    if (!parent) {
      return { success: false, error: "Parent folder not found", movedFolders: 0, movedFiles: 0 };
    }
    parentSlug = parent.slug;
  }

  const baseSlug = slugify(name);
  const newSlug = parentSlug ? `${parentSlug}/${baseSlug}` : baseSlug;

  // Check if slug exists
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, newSlug),
  });
  if (existing) {
    return { success: false, error: `Folder "${newSlug}" already exists`, movedFolders: 0, movedFiles: 0 };
  }

  // Create the folder
  const newFolderId = nanoid();
  await db.insert(folders).values({
    id: newFolderId,
    name,
    slug: newSlug,
    parentId,
  });

  // Create directory on filesystem
  await ensureDir(join(UPLOADS_DIR, newSlug));

  let totalMovedFolders = 1; // Count the new folder
  let totalMovedFiles = 0;

  // Move each child folder into the new folder
  for (const childId of childFolderIds) {
    const result = await moveFolder(childId, newFolderId);
    if (!result.success) {
      // Log but continue with others
      console.error(`[createFolderAndMoveChildren] Failed to move ${childId}: ${result.error}`);
    } else {
      totalMovedFolders += result.movedFolders;
      totalMovedFiles += result.movedFiles;
    }
  }

  const newFolder = await db.query.folders.findFirst({
    where: eq(folders.id, newFolderId),
  });

  return {
    success: true,
    folder: newFolder || undefined,
    movedFolders: totalMovedFolders,
    movedFiles: totalMovedFiles,
  };
}
