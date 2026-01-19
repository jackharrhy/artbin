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
import { isBSPFile, extractTexturesFromBSP } from "./bsp.server";

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
 * Get folder slug by ID
 */
async function getFolderSlug(folderId: string): Promise<string | null> {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });
  return folder?.slug ?? null;
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

      // Extract textures from BSP files (Quake 1 / Half-Life maps)
      if (savedName.toLowerCase().endsWith(".bsp") && isBSPFile(buffer)) {
        try {
          const bspTextures = await extractTexturesFromBSP(buffer);
          
          if (bspTextures.length > 0) {
            // Create a textures subfolder for this BSP
            const bspBaseName = savedName.replace(/\.bsp$/i, "");
            const texFolderSlug = `${folderSlug}/${pathToSlug(bspBaseName)}-textures`;
            const texFolderName = `${bspBaseName} textures`;
            const texFolderId = await getOrCreateFolder(texFolderSlug, texFolderName, folderId);
            folderMap.set(`${entryDir}/${bspBaseName}-textures`, texFolderId);
            
            for (const tex of bspTextures) {
              try {
                const texFileName = `${tex.name}.png`;
                const { path: texFilePath, name: texSavedName } = await saveFile(
                  tex.pngBuffer, 
                  texFolderSlug, 
                  texFileName, 
                  true
                );
                
                // Process for preview
                const texImageInfo = await processImage(texFilePath);
                
                await db.insert(files).values({
                  id: nanoid(),
                  path: texFilePath,
                  name: texSavedName,
                  mimeType: "image/png",
                  size: tex.pngBuffer.length,
                  kind: "texture",
                  width: tex.width,
                  height: tex.height,
                  hasPreview: texImageInfo.hasPreview,
                  folderId: texFolderId,
                  source: `bsp-extracted`,
                  sourceArchive: savedName,
                });
                
                filesByKind["texture"] = (filesByKind["texture"] || 0) + 1;
              } catch (texError) {
                console.error(`Failed to save BSP texture ${tex.name}:`, texError);
              }
            }
            
            console.log(`Extracted ${bspTextures.length} textures from ${savedName}`);
          }
        } catch (bspError) {
          console.error(`Failed to extract textures from BSP ${savedName}:`, bspError);
        }
      }
      
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
  
  // Get the actual parent folder slug (may differ from input if folder existed)
  const actualParentSlug = await getFolderSlug(parentFolderId) || parentFolderSlug;

  const totalArchives = archives.length;
  let processedArchives = 0;
  let totalFilesExtracted = 0;
  const archiveResults: BatchExtractJobOutput["archiveResults"] = [];

  for (const archiveInfo of archives) {
    const archiveName = basename(archiveInfo.path);
    const subfolderName = archiveInfo.path.split("/").pop()?.replace(/\.[^.]+$/, "") || archiveInfo.subfolderSlug;
    const subfolderSlug = `${actualParentSlug}/${archiveInfo.subfolderSlug}`;

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

          // Extract textures from BSP files (Quake 1 / Half-Life maps)
          if (savedName.toLowerCase().endsWith(".bsp") && isBSPFile(buffer)) {
            try {
              const bspTextures = await extractTexturesFromBSP(buffer);
              
              if (bspTextures.length > 0) {
                // Create a textures subfolder for this BSP
                const bspBaseName = savedName.replace(/\.bsp$/i, "");
                const texFolderSlug = `${folderSlug}/${pathToSlug(bspBaseName)}-textures`;
                const texFolderName = `${bspBaseName} textures`;
                const texFolderId = await getOrCreateFolder(texFolderSlug, texFolderName, folderId);
                folderMap.set(`${entryDir}/${bspBaseName}-textures`, texFolderId);
                
                for (const tex of bspTextures) {
                  try {
                    const texFileName = `${tex.name}.png`;
                    const { path: texFilePath, name: texSavedName } = await saveFile(
                      tex.pngBuffer, 
                      texFolderSlug, 
                      texFileName, 
                      true
                    );
                    
                    // Process for preview
                    const texImageInfo = await processImage(texFilePath);
                    
                    await db.insert(files).values({
                      id: nanoid(),
                      path: texFilePath,
                      name: texSavedName,
                      mimeType: "image/png",
                      size: tex.pngBuffer.length,
                      kind: "texture",
                      width: tex.width,
                      height: tex.height,
                      hasPreview: texImageInfo.hasPreview,
                      folderId: texFolderId,
                      source: `bsp-extracted`,
                      sourceArchive: savedName,
                    });
                    
                    filesExtracted++;
                  } catch (texError) {
                    console.error(`Failed to save BSP texture ${tex.name}:`, texError);
                  }
                }
                
                console.log(`Extracted ${bspTextures.length} textures from ${savedName}`);
              }
            } catch (bspError) {
              console.error(`Failed to extract textures from BSP ${savedName}:`, bspError);
            }
          }
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

// ============================================================================
// Standalone BSP Extract Job Handler
// ============================================================================

import { readFile } from "fs/promises";

export interface ExtractBSPJobInput {
  bspPath: string;              // Path to BSP file on disk
  targetFolderSlug: string;     // Target folder slug
  targetFolderName: string;     // Display name for folder
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
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const {
    bspPath,
    targetFolderSlug,
    targetFolderName,
  } = input as unknown as ExtractBSPJobInput;

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

  // Create the target folder
  const folderId = await getOrCreateFolder(targetFolderSlug, targetFolderName, null);

  // Save each texture
  let savedTextures = 0;
  for (const tex of bspTextures) {
    try {
      const texFileName = `${tex.name}.png`;
      const { path: texFilePath, name: texSavedName } = await saveFile(
        tex.pngBuffer,
        targetFolderSlug,
        texFileName,
        true
      );

      // Process for preview
      const texImageInfo = await processImage(texFilePath);

      await db.insert(files).values({
        id: nanoid(),
        path: texFilePath,
        name: texSavedName,
        mimeType: "image/png",
        size: tex.pngBuffer.length,
        kind: "texture",
        width: tex.width,
        height: tex.height,
        hasPreview: texImageInfo.hasPreview,
        folderId,
        source: "bsp-extracted",
        sourceArchive: bspName,
      });

      savedTextures++;

      // Update progress
      const progress = 30 + Math.floor((savedTextures / bspTextures.length) * 60);
      if (savedTextures % 10 === 0 || savedTextures === bspTextures.length) {
        await updateJobProgress(
          job.id,
          progress,
          `Saved ${savedTextures}/${bspTextures.length} textures...`
        );
      }
    } catch (texError) {
      console.error(`Failed to save BSP texture ${tex.name}:`, texError);
    }
  }

  // Generate folder preview
  await updateJobProgress(job.id, 95, "Generating folder preview...");
  try {
    await generateFolderPreview(folderId);
  } catch (err) {
    console.error(`Failed to generate preview for folder ${folderId}:`, err);
  }

  return {
    folderId,
    folderSlug: targetFolderSlug,
    totalTextures: savedTextures,
    bspName,
  } satisfies ExtractBSPJobOutput;
}

registerJobHandler("extract-bsp", handleExtractBSPJob);

// ============================================================================
// Batch BSP Extract Job Handler
// ============================================================================

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
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const {
    parentFolderSlug,
    parentFolderName,
    bspFiles,
  } = input as unknown as BatchExtractBSPJobInput;

  await updateJobProgress(job.id, 2, "Creating parent folder...");

  // Create parent folder
  const parentFolderId = await getOrCreateFolder(parentFolderSlug, parentFolderName, null);
  
  // Get the actual parent folder slug (may differ from input if folder existed)
  const actualParentSlug = await getFolderSlug(parentFolderId) || parentFolderSlug;

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
      `Extracting ${bspName} (${processedBSPs + 1}/${totalBSPs})...`
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
          const { path: texFilePath, name: texSavedName } = await saveFile(
            tex.pngBuffer,
            subfolderSlug,
            texFileName,
            true
          );

          // Process for preview
          const texImageInfo = await processImage(texFilePath);

          await db.insert(files).values({
            id: nanoid(),
            path: texFilePath,
            name: texSavedName,
            mimeType: "image/png",
            size: tex.pngBuffer.length,
            kind: "texture",
            width: tex.width,
            height: tex.height,
            hasPreview: texImageInfo.hasPreview,
            folderId: subFolderId,
            source: "bsp-extracted",
            sourceArchive: bspName,
          });

          texturesExtracted++;
        } catch (texError) {
          console.error(`Failed to save texture ${tex.name} from ${bspName}:`, texError);
        }
      }

      // Generate preview for subfolder
      try {
        await generateFolderPreview(subFolderId);
      } catch (err) {
        console.error(`Failed to generate preview for folder ${subFolderId}:`, err);
      }

      totalTexturesExtracted += texturesExtracted;
      bspResults.push({
        path: bspInfo.path,
        subfolderSlug: bspInfo.subfolderSlug,
        texturesExtracted,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to extract BSP ${bspName}:`, error);
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
    totalTextures: totalTexturesExtracted,
    totalBSPs: processedBSPs,
    bspResults,
  } satisfies BatchExtractBSPJobOutput;
}

registerJobHandler("batch-extract-bsp", handleBatchExtractBSPJob);

// Export for type checking
export { handleExtractJob, handleBatchExtractJob, handleExtractBSPJob, handleBatchExtractBSPJob };
