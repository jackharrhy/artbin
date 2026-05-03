/**
 * Archive extraction job handler
 *
 * Extracts all files from an archive, preserving directory structure,
 * and creates corresponding folders and file records in the database.
 */

import { db } from "~/db/connection.server";
import { folders, type Job } from "~/db";
import { eq } from "drizzle-orm";
import { basename, dirname } from "path";
import { unlink } from "fs/promises";
import { createRequestLogger, type AuditableLogger } from "evlog";

import { registerJobHandler, updateJobProgress } from "../jobs.server";
import {
  parseArchive,
  extractEntry,
  getDirectoryPaths,
  getFileEntries,
  type ArchiveEntry,
  type ParsedArchive,
} from "../archives.server";
import { ingestFile, finalizeFolders, getOrCreateFolder, ROOT_FOLDER } from "../files.server";
import { isBSPFile, extractTexturesFromBSP } from "../bsp.server";

export interface ExtractJobInput {
  tempFile: string; // Path to uploaded archive in temp dir
  originalName: string; // Original filename
  targetFolderSlug: string; // Target folder slug (e.g., "thirty-flights")
  targetFolderName: string; // Display name for folder
  parentFolderId?: string | null; // Parent folder ID if extracting into existing folder
  userId?: string;
  skipTempCleanup?: boolean; // Don't delete source file (for local imports)
}

export interface BatchExtractJobInput {
  parentFolderSlug: string; // Parent folder slug (e.g., "thirty-flights")
  parentFolderName: string; // Display name for parent folder
  archives: Array<{
    path: string; // Full path to archive file
    subfolderSlug: string; // Slug for subfolder (e.g., "pak0")
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

// ---------------------------------------------------------------------------
// Shared helpers (extracted to deduplicate handler code)
// ---------------------------------------------------------------------------

/**
 * Resolve the parent folder ID from a slug that may contain slashes.
 * If the slug has no slashes the parent is ROOT_FOLDER.
 */
async function resolveParentFromSlug(slug: string): Promise<string | typeof ROOT_FOLDER> {
  if (!slug.includes("/")) return ROOT_FOLDER;
  const grandparentSlug = slug.split("/").slice(0, -1).join("/");
  const grandparent = await db.query.folders.findFirst({
    where: eq(folders.slug, grandparentSlug),
  });
  return grandparent?.id ?? ROOT_FOLDER;
}

/**
 * Extract textures embedded in a BSP file and ingest them into a textures
 * subfolder. Returns the number of textures successfully saved.
 */
async function extractBSPTextures(
  buffer: Buffer,
  bspFileName: string,
  parentFolderSlug: string,
  parentFolderId: string,
  folderMap: Map<string, string>,
  entryDir: string,
  log: AuditableLogger,
  archiveName?: string,
): Promise<{ textureCount: number }> {
  let textureCount = 0;
  if (!isBSPFile(buffer)) return { textureCount };

  try {
    const bspTextures = await extractTexturesFromBSP(buffer);
    if (bspTextures.length === 0) return { textureCount };

    // Create a textures subfolder for this BSP
    const bspBaseName = bspFileName.replace(/\.bsp$/i, "");
    const texFolderSlug = `${parentFolderSlug}/${pathToSlug(bspBaseName)}-textures`;
    const texFolderName = `${bspBaseName} textures`;
    const texFolderId = await getOrCreateFolder(texFolderSlug, texFolderName, parentFolderId);
    folderMap.set(`${entryDir}/${bspBaseName}-textures`, texFolderId);

    for (const tex of bspTextures) {
      try {
        const texFileName = `${tex.name}.png`;
        const texIngested = await ingestFile({
          buffer: tex.pngBuffer,
          fileName: texFileName,
          folderSlug: texFolderSlug,
          folderId: texFolderId,
          source: "bsp-extracted",
          sourceArchive: bspFileName,
          kind: "texture",
          mimeType: "image/png",
          width: tex.width,
          height: tex.height,
        });
        if (texIngested.isErr()) throw texIngested.error;
        textureCount++;
      } catch (texError) {
        log.error(texError instanceof Error ? texError : new Error(String(texError)), {
          step: "save-bsp-texture",
          file: tex.name,
          ...(archiveName ? { archive: archiveName } : {}),
        });
      }
    }

    log.set({ bsp: { file: bspFileName, texturesExtracted: bspTextures.length } });
  } catch (bspError) {
    log.error(bspError instanceof Error ? bspError : new Error(String(bspError)), {
      step: "extract-bsp-textures",
      file: bspFileName,
      ...(archiveName ? { archive: archiveName } : {}),
    });
  }

  return { textureCount };
}

function previewErrorHandler(log: AuditableLogger) {
  return (err: Error, folderId: string) => log.error(err, { step: "generate-preview", folderId });
}

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

function pathToSlug(path: string): string {
  return path
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

async function getFolderSlug(folderId: string): Promise<string | null> {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });
  return folder?.slug ?? null;
}

async function createFolderStructure(
  baseSlug: string,
  baseName: string,
  dirPaths: string[],
  parentFolderId?: typeof ROOT_FOLDER | string,
): Promise<Map<string, string>> {
  const folderMap = new Map<string, string>(); // path -> folderId

  // Create base folder
  const baseId = await getOrCreateFolder(baseSlug, baseName, parentFolderId || ROOT_FOLDER);
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

async function handleExtractJob(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });
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

  const archive = await parseArchive(tempFile);
  const fileEntries = getFileEntries(archive.entries);
  const dirPaths = getDirectoryPaths(archive.entries);

  await updateJobProgress(
    job.id,
    10,
    `Found ${fileEntries.length} files in ${dirPaths.length} directories`,
  );

  // Create folder structure
  await updateJobProgress(job.id, 15, "Creating folder structure...");
  const folderMap = await createFolderStructure(
    targetFolderSlug,
    targetFolderName,
    dirPaths,
    parentFolderId || ROOT_FOLDER,
  );

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
      const folderSlug =
        entryDir === "." ? targetFolderSlug : `${targetFolderSlug}/${pathToSlug(entryDir)}`;
      const folderId = folderMap.get(entryDir) || folderMap.get("")!;

      // Ingest file (save, detect, process, hash, insert)
      const fileName = basename(entry.name);
      const ingested = await ingestFile({
        buffer,
        fileName,
        folderSlug,
        folderId,
        source: `extracted-${archive.type}`,
        sourceArchive: originalName,
      });
      if (ingested.isErr()) throw ingested.error;

      // Track stats
      filesByKind[ingested.value.kind] = (filesByKind[ingested.value.kind] || 0) + 1;
      processedFiles++;

      // Extract textures from BSP files (Quake 1 / Half-Life maps)
      if (ingested.value.name.toLowerCase().endsWith(".bsp")) {
        const { textureCount } = await extractBSPTextures(
          buffer,
          ingested.value.name,
          folderSlug,
          folderId,
          folderMap,
          entryDir,
          log,
        );
        filesByKind["texture"] = (filesByKind["texture"] || 0) + textureCount;
      }

      // Update progress
      const progress = 15 + Math.floor((processedFiles / totalFiles) * 80);
      if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
        await updateJobProgress(
          job.id,
          progress,
          `Extracted ${processedFiles}/${totalFiles} files...`,
        );
      }
    } catch (error) {
      log.error(error instanceof Error ? error : new Error(String(error)), {
        step: "extract-entry",
        file: entry.name,
      });
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

  // Recalculate file counts and generate folder previews
  await updateJobProgress(job.id, 96, "Updating folder counts...");
  await updateJobProgress(job.id, 97, "Generating folder previews...");
  await finalizeFolders(Array.from(folderMap.values()), previewErrorHandler(log));

  log.emit();

  return {
    folderId: folderMap.get("")!,
    folderSlug: targetFolderSlug,
    totalFiles: processedFiles,
    totalFolders: folderMap.size,
    filesByKind,
  };
}

registerJobHandler("extract-archive", handleExtractJob);

async function handleBatchExtractJob(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });
  const { parentFolderSlug, parentFolderName, archives } = input as unknown as BatchExtractJobInput;

  await updateJobProgress(job.id, 2, "Creating parent folder...");

  // Create parent folder, deriving parent from the slug
  const parentFolderId = await getOrCreateFolder(
    parentFolderSlug,
    parentFolderName,
    await resolveParentFromSlug(parentFolderSlug),
  );

  // Get the actual parent folder slug (may differ from input if folder existed)
  const actualParentSlug = (await getFolderSlug(parentFolderId)) || parentFolderSlug;

  const totalArchives = archives.length;
  let processedArchives = 0;
  let totalFilesExtracted = 0;
  const archiveResults: BatchExtractJobOutput["archiveResults"] = [];

  for (const archiveInfo of archives) {
    const archiveName = basename(archiveInfo.path);
    const subfolderName =
      archiveInfo.path
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") || archiveInfo.subfolderSlug;
    const subfolderSlug = `${actualParentSlug}/${archiveInfo.subfolderSlug}`;

    await updateJobProgress(
      job.id,
      5 + Math.floor((processedArchives / totalArchives) * 90),
      `Extracting ${archiveName} (${processedArchives + 1}/${totalArchives})...`,
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
        parentFolderId,
      );

      // Extract files
      let filesExtracted = 0;

      for (const entry of fileEntries) {
        try {
          // Extract file content
          const buffer = await extractEntry(archiveInfo.path, entry, archive.type);

          // Determine folder for this file
          const entryDir = dirname(entry.name);
          const folderSlug =
            entryDir === "." ? subfolderSlug : `${subfolderSlug}/${pathToSlug(entryDir)}`;
          const folderId = folderMap.get(entryDir) || folderMap.get("")!;

          // Ingest file (save, detect, process, hash, insert)
          const fileName = basename(entry.name);
          const ingested = await ingestFile({
            buffer,
            fileName,
            folderSlug,
            folderId,
            source: `extracted-${archive.type}`,
            sourceArchive: archiveName,
          });
          if (ingested.isErr()) throw ingested.error;

          filesExtracted++;

          // Extract textures from BSP files (Quake 1 / Half-Life maps)
          if (ingested.value.name.toLowerCase().endsWith(".bsp")) {
            const { textureCount } = await extractBSPTextures(
              buffer,
              ingested.value.name,
              folderSlug,
              folderId,
              folderMap,
              entryDir,
              log,
              archiveName,
            );
            filesExtracted += textureCount;
          }
        } catch (error) {
          log.error(error instanceof Error ? error : new Error(String(error)), {
            step: "extract-entry",
            file: entry.name,
            archive: archiveName,
          });
          // Continue with other files
        }
      }

      // Recalculate file counts and generate folder previews
      await finalizeFolders(Array.from(folderMap.values()), previewErrorHandler(log));

      totalFilesExtracted += filesExtracted;
      archiveResults.push({
        path: archiveInfo.path,
        subfolderSlug: archiveInfo.subfolderSlug,
        filesExtracted,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(error instanceof Error ? error : new Error(errorMessage), {
        step: "extract-archive",
        archive: archiveName,
      });
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

  // Update parent folder count and generate preview
  await updateJobProgress(job.id, 97, "Generating parent folder preview...");
  await finalizeFolders([parentFolderId], previewErrorHandler(log));

  log.emit();

  return {
    parentFolderId,
    parentFolderSlug,
    totalFiles: totalFilesExtracted,
    totalArchives: processedArchives,
    archiveResults,
  } satisfies BatchExtractJobOutput;
}

registerJobHandler("batch-extract-archive", handleBatchExtractJob);

import { readFile } from "fs/promises";

export interface ExtractBSPJobInput {
  bspPath: string; // Path to BSP file on disk
  targetFolderSlug: string; // Target folder slug
  targetFolderName: string; // Display name for folder
  userId?: string;
}

export interface ExtractBSPJobOutput {
  folderId: string;
  folderSlug: string;
  totalTextures: number;
  bspName: string;
}

/**
 * Extract textures from a standalone BSP file (not inside an archive)
 */
async function handleExtractBSPJob(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });
  const { bspPath, targetFolderSlug, targetFolderName } = input as unknown as ExtractBSPJobInput;

  const bspName = basename(bspPath);
  const bspBaseName = bspName.replace(/\.bsp$/i, "");

  await updateJobProgress(job.id, 5, `Reading BSP file: ${bspName}...`);

  // Read the BSP file
  const buffer = await readFile(bspPath);

  if (!isBSPFile(buffer)) {
    throw new Error(`${bspName} is not a valid Quake/Half-Life BSP file`);
  }

  await updateJobProgress(job.id, 15, "Extracting textures from BSP...");

  // Extract textures
  const bspTextures = await extractTexturesFromBSP(buffer);

  if (bspTextures.length === 0) {
    throw new Error(`No textures found in ${bspName}`);
  }

  await updateJobProgress(job.id, 30, `Found ${bspTextures.length} textures, creating folder...`);

  // Create the target folder, parented to the BSP's folder
  const folderId = await getOrCreateFolder(
    targetFolderSlug,
    targetFolderName,
    await resolveParentFromSlug(targetFolderSlug),
  );

  // Save each texture
  let savedTextures = 0;
  for (const tex of bspTextures) {
    try {
      const texFileName = `${tex.name}.png`;
      const texIngested = await ingestFile({
        buffer: tex.pngBuffer,
        fileName: texFileName,
        folderSlug: targetFolderSlug,
        folderId,
        source: "bsp-extracted",
        sourceArchive: bspName,
        kind: "texture",
        mimeType: "image/png",
        width: tex.width,
        height: tex.height,
      });
      if (texIngested.isErr()) throw texIngested.error;

      savedTextures++;

      // Update progress
      const progress = 30 + Math.floor((savedTextures / bspTextures.length) * 60);
      if (savedTextures % 10 === 0 || savedTextures === bspTextures.length) {
        await updateJobProgress(
          job.id,
          progress,
          `Saved ${savedTextures}/${bspTextures.length} textures...`,
        );
      }
    } catch (texError) {
      log.error(texError instanceof Error ? texError : new Error(String(texError)), {
        step: "save-bsp-texture",
        file: tex.name,
      });
    }
  }

  // Update folder count and generate preview
  await updateJobProgress(job.id, 95, "Generating folder preview...");
  await finalizeFolders([folderId], previewErrorHandler(log));

  log.emit();

  return {
    folderId,
    folderSlug: targetFolderSlug,
    totalTextures: savedTextures,
    bspName,
  } satisfies ExtractBSPJobOutput;
}

registerJobHandler("extract-bsp", handleExtractBSPJob);

export interface BatchExtractBSPJobInput {
  parentFolderSlug: string;
  parentFolderName: string;
  bspFiles: Array<{
    path: string;
    subfolderSlug: string;
  }>;
  userId?: string;
}

export interface BatchExtractBSPJobOutput {
  parentFolderId: string;
  parentFolderSlug: string;
  totalTextures: number;
  totalBSPs: number;
  bspResults: Array<{
    path: string;
    subfolderSlug: string;
    texturesExtracted: number;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Extract textures from multiple BSP files into subfolders
 */
async function handleBatchExtractBSPJob(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });
  const { parentFolderSlug, parentFolderName, bspFiles } =
    input as unknown as BatchExtractBSPJobInput;

  await updateJobProgress(job.id, 2, "Creating parent folder...");

  // Create parent folder, deriving parent from the slug
  const parentFolderId = await getOrCreateFolder(
    parentFolderSlug,
    parentFolderName,
    await resolveParentFromSlug(parentFolderSlug),
  );

  // Get the actual parent folder slug (may differ from input if folder existed)
  const actualParentSlug = (await getFolderSlug(parentFolderId)) || parentFolderSlug;

  const totalBSPs = bspFiles.length;
  let processedBSPs = 0;
  let totalTexturesExtracted = 0;
  const bspResults: BatchExtractBSPJobOutput["bspResults"] = [];

  for (const bspInfo of bspFiles) {
    const bspName = basename(bspInfo.path);
    const bspBaseName = bspName.replace(/\.bsp$/i, "");
    const subfolderSlug = `${actualParentSlug}/${bspInfo.subfolderSlug}`;

    await updateJobProgress(
      job.id,
      5 + Math.floor((processedBSPs / totalBSPs) * 90),
      `Extracting ${bspName} (${processedBSPs + 1}/${totalBSPs})...`,
    );

    try {
      // Read the BSP file
      const buffer = await readFile(bspInfo.path);

      if (!isBSPFile(buffer)) {
        throw new Error("Not a valid BSP file");
      }

      // Extract textures
      const bspTextures = await extractTexturesFromBSP(buffer);

      if (bspTextures.length === 0) {
        // No textures - still mark as success but with 0 textures
        bspResults.push({
          path: bspInfo.path,
          subfolderSlug: bspInfo.subfolderSlug,
          texturesExtracted: 0,
          success: true,
        });
        processedBSPs++;
        continue;
      }

      // Create subfolder for this BSP's textures
      const subFolderId = await getOrCreateFolder(subfolderSlug, bspBaseName, parentFolderId);

      // Save each texture
      let texturesExtracted = 0;
      for (const tex of bspTextures) {
        try {
          const texFileName = `${tex.name}.png`;
          const texIngested = await ingestFile({
            buffer: tex.pngBuffer,
            fileName: texFileName,
            folderSlug: subfolderSlug,
            folderId: subFolderId,
            source: "bsp-extracted",
            sourceArchive: bspName,
            kind: "texture",
            mimeType: "image/png",
            width: tex.width,
            height: tex.height,
          });
          if (texIngested.isErr()) throw texIngested.error;

          texturesExtracted++;
        } catch (texError) {
          log.error(texError instanceof Error ? texError : new Error(String(texError)), {
            step: "save-bsp-texture",
            file: tex.name,
            bsp: bspName,
          });
        }
      }

      // Update folder count and generate preview for subfolder
      await finalizeFolders([subFolderId], previewErrorHandler(log));

      totalTexturesExtracted += texturesExtracted;
      bspResults.push({
        path: bspInfo.path,
        subfolderSlug: bspInfo.subfolderSlug,
        texturesExtracted,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(error instanceof Error ? error : new Error(errorMessage), {
        step: "extract-bsp",
        file: bspName,
      });
      bspResults.push({
        path: bspInfo.path,
        subfolderSlug: bspInfo.subfolderSlug,
        texturesExtracted: 0,
        success: false,
        error: errorMessage,
      });
    }

    processedBSPs++;
  }

  // Update parent folder count and generate preview
  await updateJobProgress(job.id, 97, "Generating parent folder preview...");
  await finalizeFolders([parentFolderId], previewErrorHandler(log));

  log.emit();

  return {
    parentFolderId,
    parentFolderSlug,
    totalTextures: totalTexturesExtracted,
    totalBSPs: processedBSPs,
    bspResults,
  } satisfies BatchExtractBSPJobOutput;
}

registerJobHandler("batch-extract-bsp", handleBatchExtractBSPJob);

export { handleExtractJob, handleBatchExtractJob, handleExtractBSPJob, handleBatchExtractBSPJob };
