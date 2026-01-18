/**
 * Archive extraction job handler
 * 
 * Extracts all files from an archive, preserving directory structure,
 * and creates corresponding folders and file records in the database.
 */

import { db, folders, files, type Job } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { basename, dirname, join } from "path";
import { unlink } from "fs/promises";

import { registerJobHandler, updateJobProgress } from "./jobs.server";
import {
  parseArchive,
  extractEntry,
  getDirectoryPaths,
  getFileEntries,
  type ArchiveEntry,
  type ParsedArchive,
} from "./archives.server";
import {
  saveFile,
  getMimeType,
  detectKind,
  processImage,
  isImageKind,
  TEMP_DIR,
  ensureDir,
  slugToPath,
} from "./files.server";
import { generateFolderPreview } from "./folder-preview.server";

// ============================================================================
// Types
// ============================================================================

export interface ExtractJobInput {
  tempFile: string;           // Path to uploaded archive in temp dir
  originalName: string;       // Original filename
  targetFolderSlug: string;   // Target folder slug (e.g., "thirty-flights")
  targetFolderName: string;   // Display name for folder
  parentFolderId?: string | null; // Parent folder ID if extracting into existing folder
  userId?: string;
  skipTempCleanup?: boolean;  // Don't delete source file (for local imports)
}

export interface BatchExtractJobInput {
  parentFolderSlug: string;   // Parent folder slug (e.g., "thirty-flights")
  parentFolderName: string;   // Display name for parent folder
  archives: Array<{
    path: string;             // Full path to archive file
    subfolderSlug: string;    // Slug for subfolder (e.g., "pak0")
  }>;
  userId?: string;
}

export interface BatchExtractJobOutput {
  parentFolderId: string;
  parentFolderSlug: string;
  totalFiles: number;
  totalArchives: number;
  archiveResults: Array<{
    path: string;
    subfolderSlug: string;
    filesExtracted: number;
    success: boolean;
    error?: string;
  }>;
}

export interface ExtractJobOutput {
  folderId: string;
  folderSlug: string;
  totalFiles: number;
  totalFolders: number;
  filesByKind: Record<string, number>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a folder slug from a path
 */
function pathToSlug(path: string): string {
  return path
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

/**
 * Get or create a folder by slug
 */
async function getOrCreateFolder(
  slug: string,
  name: string,
  parentId: string | null
): Promise<string> {
  // Check if folder exists
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });
  
  if (existing) {
    return existing.id;
  }
  
  // Create folder
  const id = nanoid();
  await db.insert(folders).values({
    id,
    name,
    slug,
    parentId,
  });
  
  // Create directory on disk
  await ensureDir(slugToPath(slug));
  
  return id;
}

/**
 * Create nested folder structure from archive paths
 */
async function createFolderStructure(
  baseSlug: string,
  baseName: string,
  dirPaths: string[],
  parentFolderId?: string | null
): Promise<Map<string, string>> {
  const folderMap = new Map<string, string>(); // path -> folderId
  
  // Create base folder
  const baseId = await getOrCreateFolder(baseSlug, baseName, parentFolderId || null);
  folderMap.set("", baseId);
  
  // Sort paths to ensure parents are created before children
  const sortedPaths = dirPaths.sort((a, b) => a.split("/").length - b.split("/").length);
  
  for (const dirPath of sortedPaths) {
    const fullSlug = `${baseSlug}/${pathToSlug(dirPath)}`;
    const name = basename(dirPath) || dirPath;
    
    // Find parent folder
    const parentPath = dirname(dirPath);
    const parentId = parentPath === "." ? baseId : folderMap.get(parentPath) || baseId;
    
    const folderId = await getOrCreateFolder(fullSlug, name, parentId);
    folderMap.set(dirPath, folderId);
  }
  
  return folderMap;
}

// ============================================================================
// Job Handler
// ============================================================================

async function handleExtractJob(
  job: Job,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const {
    tempFile,
    originalName,
    targetFolderSlug,
    targetFolderName,
    parentFolderId,
    skipTempCleanup,
  } = input as unknown as ExtractJobInput;
  
  const archiveName = basename(originalName, "." + originalName.split(".").pop());
  
  await updateJobProgress(job.id, 5, "Parsing archive...");
  
  // Parse archive
  const archive = await parseArchive(tempFile);
  const fileEntries = getFileEntries(archive.entries);
  const dirPaths = getDirectoryPaths(archive.entries);
  
  await updateJobProgress(job.id, 10, `Found ${fileEntries.length} files in ${dirPaths.length} directories`);
  
  // Create folder structure
  await updateJobProgress(job.id, 15, "Creating folder structure...");
  const folderMap = await createFolderStructure(targetFolderSlug, targetFolderName, dirPaths, parentFolderId);
  
  // Extract files
  const totalFiles = fileEntries.length;
  let processedFiles = 0;
  const filesByKind: Record<string, number> = {};
  
  for (const entry of fileEntries) {
    try {
      // Extract file content
      const buffer = await extractEntry(tempFile, entry, archive.type);
      
      // Determine folder for this file
      const entryDir = dirname(entry.name);
      const folderSlug = entryDir === "." 
        ? targetFolderSlug 
        : `${targetFolderSlug}/${pathToSlug(entryDir)}`;
      const folderId = folderMap.get(entryDir) || folderMap.get("")!;
      
      // Save file to disk
      const fileName = basename(entry.name);
      const { path: filePath, name: savedName } = await saveFile(buffer, folderSlug, fileName, true);
      
      // Detect kind and mime type
      const kind = detectKind(savedName);
      const mimeType = await getMimeType(savedName, buffer);
      
      // Process images to get dimensions and generate previews
      let width: number | null = null;
      let height: number | null = null;
      let hasPreview = false;
      
      if (isImageKind(kind)) {
        const imageInfo = await processImage(filePath);
        width = imageInfo.width;
        height = imageInfo.height;
        hasPreview = imageInfo.hasPreview;
      }
      
      // Create file record
      await db.insert(files).values({
        id: nanoid(),
        path: filePath,
        name: savedName,
        mimeType,
        size: buffer.length,
        kind,
        width,
        height,
        hasPreview,
        folderId,
        source: `extracted-${archive.type}`,
        sourceArchive: originalName,
      });
      
      // Track stats
      filesByKind[kind] = (filesByKind[kind] || 0) + 1;
      processedFiles++;
      
      // Update progress
      const progress = 15 + Math.floor((processedFiles / totalFiles) * 80);
      if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
        await updateJobProgress(
          job.id,
          progress,
          `Extracted ${processedFiles}/${totalFiles} files...`
        );
      }
    } catch (error) {
      console.error(`Failed to extract ${entry.name}:`, error);
      // Continue with other files
    }
  }
  
  // Clean up temp file (unless it's a local import)
  if (!skipTempCleanup) {
    await updateJobProgress(job.id, 95, "Cleaning up...");
    try {
      await unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
  
  // Generate folder previews for all created folders
  await updateJobProgress(job.id, 97, "Generating folder previews...");
  for (const [, folderId] of folderMap) {
    try {
      await generateFolderPreview(folderId);
    } catch (err) {
      console.error(`Failed to generate preview for folder ${folderId}:`, err);
      // Continue with other folders
    }
  }
  
  return {
    folderId: folderMap.get("")!,
    folderSlug: targetFolderSlug,
    totalFiles: processedFiles,
    totalFolders: folderMap.size,
    filesByKind,
  };
}

// Register the job handler
registerJobHandler("extract-archive", handleExtractJob);

// ============================================================================
// Batch Extract Job Handler
// ============================================================================

async function handleBatchExtractJob(
  job: Job,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const {
    parentFolderSlug,
    parentFolderName,
    archives,
  } = input as unknown as BatchExtractJobInput;

  await updateJobProgress(job.id, 2, "Creating parent folder...");

  // Create parent folder
  const parentFolderId = await getOrCreateFolder(parentFolderSlug, parentFolderName, null);

  const totalArchives = archives.length;
  let processedArchives = 0;
  let totalFilesExtracted = 0;
  const archiveResults: BatchExtractJobOutput["archiveResults"] = [];

  for (const archiveInfo of archives) {
    const archiveName = basename(archiveInfo.path);
    const subfolderName = archiveInfo.path.split("/").pop()?.replace(/\.[^.]+$/, "") || archiveInfo.subfolderSlug;
    const subfolderSlug = `${parentFolderSlug}/${archiveInfo.subfolderSlug}`;

    await updateJobProgress(
      job.id,
      5 + Math.floor((processedArchives / totalArchives) * 90),
      `Extracting ${archiveName} (${processedArchives + 1}/${totalArchives})...`
    );

    try {
      // Parse archive
      const archive = await parseArchive(archiveInfo.path);
      const fileEntries = getFileEntries(archive.entries);
      const dirPaths = getDirectoryPaths(archive.entries);

      // Create subfolder structure under the parent
      const folderMap = await createFolderStructure(
        subfolderSlug,
        subfolderName,
        dirPaths,
        parentFolderId
      );

      // Extract files
      let filesExtracted = 0;

      for (const entry of fileEntries) {
        try {
          // Extract file content
          const buffer = await extractEntry(archiveInfo.path, entry, archive.type);

          // Determine folder for this file
          const entryDir = dirname(entry.name);
          const folderSlug = entryDir === "."
            ? subfolderSlug
            : `${subfolderSlug}/${pathToSlug(entryDir)}`;
          const folderId = folderMap.get(entryDir) || folderMap.get("")!;

          // Save file to disk
          const fileName = basename(entry.name);
          const { path: filePath, name: savedName } = await saveFile(buffer, folderSlug, fileName, true);

          // Detect kind and mime type
          const kind = detectKind(savedName);
          const mimeType = await getMimeType(savedName, buffer);

          // Process images to get dimensions and generate previews
          let width: number | null = null;
          let height: number | null = null;
          let hasPreview = false;

          if (isImageKind(kind)) {
            const imageInfo = await processImage(filePath);
            width = imageInfo.width;
            height = imageInfo.height;
            hasPreview = imageInfo.hasPreview;
          }

          // Create file record
          await db.insert(files).values({
            id: nanoid(),
            path: filePath,
            name: savedName,
            mimeType,
            size: buffer.length,
            kind,
            width,
            height,
            hasPreview,
            folderId,
            source: `extracted-${archive.type}`,
            sourceArchive: archiveName,
          });

          filesExtracted++;
        } catch (error) {
          console.error(`Failed to extract ${entry.name} from ${archiveName}:`, error);
          // Continue with other files
        }
      }

      // Generate folder previews for all created folders
      for (const [, folderId] of folderMap) {
        try {
          await generateFolderPreview(folderId);
        } catch (err) {
          console.error(`Failed to generate preview for folder ${folderId}:`, err);
        }
      }

      totalFilesExtracted += filesExtracted;
      archiveResults.push({
        path: archiveInfo.path,
        subfolderSlug: archiveInfo.subfolderSlug,
        filesExtracted,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to extract archive ${archiveName}:`, error);
      archiveResults.push({
        path: archiveInfo.path,
        subfolderSlug: archiveInfo.subfolderSlug,
        filesExtracted: 0,
        success: false,
        error: errorMessage,
      });
    }

    processedArchives++;
  }

  // Generate preview for parent folder
  await updateJobProgress(job.id, 97, "Generating parent folder preview...");
  try {
    await generateFolderPreview(parentFolderId);
  } catch (err) {
    console.error(`Failed to generate preview for parent folder ${parentFolderId}:`, err);
  }

  return {
    parentFolderId,
    parentFolderSlug,
    totalFiles: totalFilesExtracted,
    totalArchives: processedArchives,
    archiveResults,
  } satisfies BatchExtractJobOutput;
}

registerJobHandler("batch-extract-archive", handleBatchExtractJob);

// Export for type checking
export { handleExtractJob, handleBatchExtractJob };
