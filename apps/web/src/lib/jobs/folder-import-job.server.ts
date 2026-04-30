/**
 * Folder import job handler
 *
 * Recursively scans a local folder and imports all supported asset files,
 * preserving the directory structure.
 */

import { db } from "~/db/connection.server";
import { folders, type Job } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { basename, dirname, join, extname, relative } from "path";
import { readdir, stat, readFile } from "fs/promises";
import { existsSync } from "fs";
import { createRequestLogger } from "evlog";

import { registerJobHandler, updateJobProgress } from "../jobs.server";
import {
  saveFile,
  getMimeType,
  detectKind,
  processImage,
  isImageKind,
  ensureDir,
  slugToPath,
  recalculateFolderCounts,
  insertFileRecord,
  computeSha256,
} from "../files.server";
import { generateFolderPreview } from "../folder-preview.server";

/**
 * File extensions we know how to import directly.
 * These are files that artbin can store and potentially display/preview.
 */
const IMPORTABLE_EXTENSIONS = new Set([
  // Images / Textures
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "tga",
  "bmp",
  "pcx",
  "wal",
  "vtf",
  "dds",

  // Audio
  "wav",
  "mp3",
  "ogg",
  "flac",
  "m4a",
  "aiff",

  // Models (for reference/storage)
  "gltf",
  "glb",
  "obj",
  "fbx",
  "md2",
  "md3",
  "mdl",
  "iqm",
  "md5mesh",
  "md5anim",
  "ase", // id Tech 4 formats

  // Maps (for reference/storage)
  "map",
  "vmf",
  "rmf",

  // Config files (sometimes useful)
  "cfg",
  "def",
  "mtr",
  "skin",
  "gui",
  "script",
]);

/**
 * Check if a file extension is importable
 */
function isImportableFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return IMPORTABLE_EXTENSIONS.has(ext);
}

export interface FolderImportJobInput {
  sourcePath: string; // Absolute path to source folder
  targetFolderSlug: string; // Target folder slug (e.g., "skin-deep")
  targetFolderName: string; // Display name for folder
  userId?: string;
}

export interface FolderImportJobOutput {
  folderId: string;
  folderSlug: string;
  totalFiles: number;
  totalFolders: number;
  filesByKind: Record<string, number>;
  skippedFiles: number;
}

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
  parentId: string | null,
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
 * Recursively find all importable files in a directory
 */
async function findImportableFiles(
  basePath: string,
  currentPath: string = "",
): Promise<Array<{ relativePath: string; absolutePath: string; size: number }>> {
  const results: Array<{
    relativePath: string;
    absolutePath: string;
    size: number;
  }> = [];
  const fullPath = currentPath ? join(basePath, currentPath) : basePath;

  try {
    const entries = await readdir(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelPath = currentPath ? join(currentPath, entry.name) : entry.name;
      const entryAbsPath = join(fullPath, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and common non-asset directories
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "__pycache__"
        ) {
          continue;
        }

        // Recurse into subdirectory
        const subResults = await findImportableFiles(basePath, entryRelPath);
        results.push(...subResults);
      } else if (entry.isFile()) {
        // Check if file is importable
        if (isImportableFile(entry.name)) {
          const stats = await stat(entryAbsPath);
          results.push({
            relativePath: entryRelPath,
            absolutePath: entryAbsPath,
            size: stats.size,
          });
        }
      }
    }
  } catch {
    // Skip directories we can't read (permissions, etc)
  }

  return results;
}

/**
 * Extract unique directory paths from file list
 */
function getDirectoryPaths(files: Array<{ relativePath: string }>): string[] {
  const dirs = new Set<string>();

  for (const file of files) {
    const dir = dirname(file.relativePath);
    if (dir !== ".") {
      // Add this directory and all parent directories
      const parts = dir.split("/");
      for (let i = 1; i <= parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"));
      }
    }
  }

  return Array.from(dirs).sort((a, b) => a.split("/").length - b.split("/").length);
}

// ============================================================================
// Job Handler
// ============================================================================

async function handleFolderImportJob(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });
  const { sourcePath, targetFolderSlug, targetFolderName } =
    input as unknown as FolderImportJobInput;

  // Validate source path exists
  if (!existsSync(sourcePath)) {
    throw new Error(`Source path does not exist: ${sourcePath}`);
  }

  const sourceStats = await stat(sourcePath);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Source path is not a directory: ${sourcePath}`);
  }

  await updateJobProgress(job.id, 2, "Scanning folder for importable files...");

  // Find all importable files
  const importableFiles = await findImportableFiles(sourcePath);

  if (importableFiles.length === 0) {
    throw new Error("No importable files found in the specified folder");
  }

  await updateJobProgress(job.id, 5, `Found ${importableFiles.length} files to import`);

  // Get unique directory paths
  const dirPaths = getDirectoryPaths(importableFiles);

  await updateJobProgress(job.id, 8, `Creating ${dirPaths.length + 1} folders...`);

  // Create folder structure
  const folderMap = new Map<string, string>(); // relativePath -> folderId

  // Create base folder
  const baseFolderId = await getOrCreateFolder(targetFolderSlug, targetFolderName, null);
  folderMap.set("", baseFolderId);

  // Create subfolders
  for (const dirPath of dirPaths) {
    const fullSlug = `${targetFolderSlug}/${pathToSlug(dirPath)}`;
    const name = basename(dirPath) || dirPath;

    // Find parent folder
    const parentPath = dirname(dirPath);
    const parentId = parentPath === "." ? baseFolderId : folderMap.get(parentPath) || baseFolderId;

    const folderId = await getOrCreateFolder(fullSlug, name, parentId);
    folderMap.set(dirPath, folderId);
  }

  await updateJobProgress(job.id, 10, `Importing ${importableFiles.length} files...`);

  // Import files
  const totalFiles = importableFiles.length;
  let processedFiles = 0;
  let skippedFiles = 0;
  const filesByKind: Record<string, number> = {};

  for (const fileInfo of importableFiles) {
    try {
      // Read file content
      const buffer = await readFile(fileInfo.absolutePath);

      // Determine folder for this file
      const fileDir = dirname(fileInfo.relativePath);
      const folderSlug =
        fileDir === "." ? targetFolderSlug : `${targetFolderSlug}/${pathToSlug(fileDir)}`;
      const folderId = folderMap.get(fileDir) || folderMap.get("")!;

      // Save file to disk
      const fileName = basename(fileInfo.relativePath);
      const { path: filePath, name: savedName } = await saveFile(
        buffer,
        folderSlug,
        fileName,
        true,
      );

      // Detect kind and mime type
      const kind = detectKind(savedName);
      const mimeType = await getMimeType(savedName, buffer);

      // Process images to get dimensions and generate previews
      let width: number | null = null;
      let height: number | null = null;
      let hasPreview = false;

      if (isImageKind(kind)) {
        const imageInfo = await processImage(filePath);
        if (imageInfo.isErr()) throw imageInfo.error;
        width = imageInfo.value.width;
        height = imageInfo.value.height;
        hasPreview = imageInfo.value.hasPreview;
      }

      // Create file record
      const inserted = await insertFileRecord({
        id: nanoid(),
        path: filePath,
        name: savedName,
        mimeType,
        size: buffer.length,
        kind,
        sha256: computeSha256(buffer),
        width,
        height,
        hasPreview,
        folderId,
        source: "folder-import",
        sourceArchive: sourcePath,
      });
      if (inserted.isErr()) throw inserted.error;

      // Track stats
      filesByKind[kind] = (filesByKind[kind] || 0) + 1;
      processedFiles++;

      // Update progress
      const progress = 10 + Math.floor((processedFiles / totalFiles) * 85);
      if (processedFiles % 50 === 0 || processedFiles === totalFiles) {
        await updateJobProgress(
          job.id,
          progress,
          `Imported ${processedFiles}/${totalFiles} files...`,
        );
      }
    } catch (error) {
      log.error(error instanceof Error ? error : new Error(String(error)), {
        step: "import-file",
        file: fileInfo.relativePath,
      });
      skippedFiles++;
      // Continue with other files
    }
  }

  // Recalculate file counts for all created folders
  await updateJobProgress(job.id, 96, "Updating folder counts...");
  await recalculateFolderCounts(Array.from(folderMap.values()));

  // Generate folder previews for all created folders
  await updateJobProgress(job.id, 97, "Generating folder previews...");
  for (const [, folderId] of folderMap) {
    try {
      await generateFolderPreview(folderId);
    } catch (err) {
      log.error(err instanceof Error ? err : new Error(String(err)), {
        step: "generate-preview",
        folderId,
      });
      // Continue with other folders
    }
  }

  log.emit();

  return {
    folderId: baseFolderId,
    folderSlug: targetFolderSlug,
    totalFiles: processedFiles,
    totalFolders: folderMap.size,
    filesByKind,
    skippedFiles,
  } satisfies FolderImportJobOutput;
}

// Register the job handler
registerJobHandler("folder-import", handleFolderImportJob);

// Export for type checking
export { handleFolderImportJob };
