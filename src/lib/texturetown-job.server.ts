/**
 * TextureTown import job handler
 * 
 * Imports textures from TextureTown (textures.neocities.org) into artbin.
 * Creates folders for each category and downloads all textures.
 */

import { db, folders, files, type Job } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { registerJobHandler, updateJobProgress } from "./jobs.server";
import {
  saveFile,
  getMimeType,
  detectKind,
  processImage,
  isImageKind,
  ensureDir,
  slugToPath,
  recalculateFolderCounts,
} from "./files.server";
import { generateFolderPreview } from "./folder-preview.server";

// ============================================================================
// Types
// ============================================================================

interface TextureTownManifest {
  info: {
    base_url: string;
    textures_folder: string;
    texture_count: number;
  };
  catalogue: Array<{
    name: string;
    niceName: string;
    files: string[];
  }>;
}

export interface TextureTownImportInput {
  categories?: string[];  // If empty/undefined, import all categories
  userId?: string;
}

export interface TextureTownImportOutput {
  totalFiles: number;
  totalFolders: number;
  categoriesImported: string[];
  errors: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

const TEXTURETOWN_MANIFEST_URL = "https://textures.neocities.org/manifest.json";
const TEXTURETOWN_BASE_URL = "https://textures.neocities.org";

/**
 * Fetch the TextureTown manifest
 */
async function fetchManifest(): Promise<TextureTownManifest> {
  const res = await fetch(TEXTURETOWN_MANIFEST_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const TEXTURETOWN_PARENT_SLUG = "texturetown";
const TEXTURETOWN_PARENT_NAME = "TextureTown";

/**
 * Create slug from category name (nested under parent)
 */
function categoryToSlug(categoryName: string): string {
  const catSlug = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${TEXTURETOWN_PARENT_SLUG}/${catSlug}`;
}

/**
 * Get or create the parent TextureTown folder
 */
async function getOrCreateParentFolder(): Promise<string> {
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, TEXTURETOWN_PARENT_SLUG),
  });

  if (existing) {
    return existing.id;
  }

  const id = nanoid();
  await db.insert(folders).values({
    id,
    name: TEXTURETOWN_PARENT_NAME,
    slug: TEXTURETOWN_PARENT_SLUG,
    description: "Textures imported from textures.neocities.org",
  });

  await ensureDir(slugToPath(TEXTURETOWN_PARENT_SLUG));

  return id;
}

/**
 * Get or create a folder for a TextureTown category
 */
async function getOrCreateCategoryFolder(
  slug: string,
  name: string,
  parentId: string
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
    parentId,
    description: `${name} textures from TextureTown`,
  });

  await ensureDir(slugToPath(slug));

  return id;
}

/**
 * Download a single texture file
 */
async function downloadTexture(
  baseUrl: string,
  texturesFolder: string,
  categoryName: string,
  fileName: string
): Promise<Buffer> {
  const url = `${baseUrl}/${texturesFolder}/${categoryName}/${fileName}`;
  const res = await fetch(url);
  
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ============================================================================
// Job Handler
// ============================================================================

async function handleTextureTownImport(
  job: Job,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { categories: requestedCategories, userId } = input as unknown as TextureTownImportInput;

  await updateJobProgress(job.id, 2, "Fetching TextureTown manifest...");

  const manifest = await fetchManifest();
  const { base_url, textures_folder } = manifest.info;

  // Filter categories if specific ones were requested
  let categoriesToImport = manifest.catalogue;
  if (requestedCategories && requestedCategories.length > 0) {
    categoriesToImport = manifest.catalogue.filter((cat) =>
      requestedCategories.includes(cat.name)
    );
  }

  if (categoriesToImport.length === 0) {
    throw new Error("No categories to import");
  }

  // Count total files for progress tracking
  const totalFiles = categoriesToImport.reduce((sum, cat) => sum + cat.files.length, 0);
  let processedFiles = 0;
  let importedFiles = 0;
  const errors: string[] = [];
  const categoriesImported: string[] = [];

  await updateJobProgress(
    job.id,
    5,
    `Found ${totalFiles} textures in ${categoriesToImport.length} categories`
  );

  // Create parent TextureTown folder
  const parentFolderId = await getOrCreateParentFolder();
  const createdFolderIds: string[] = [parentFolderId];

  for (const category of categoriesToImport) {
    const folderSlug = categoryToSlug(category.name);
    const folderId = await getOrCreateCategoryFolder(folderSlug, category.niceName, parentFolderId);
    createdFolderIds.push(folderId);
    categoriesImported.push(category.niceName);

    for (const fileName of category.files) {
      try {
        // Check if file already exists
        const filePath = `${folderSlug}/${fileName}`;
        const existing = await db.query.files.findFirst({
          where: eq(files.path, filePath),
        });

        if (existing) {
          processedFiles++;
          continue; // Skip already imported files
        }

        // Download the texture
        const buffer = await downloadTexture(
          base_url,
          textures_folder,
          category.name,
          fileName
        );

        // Save file to disk
        const { path: savedPath, name: savedName } = await saveFile(
          buffer,
          folderSlug,
          fileName,
          true
        );

        // Detect kind and mime type
        const kind = detectKind(savedName);
        const mimeType = await getMimeType(savedName, buffer);

        // Process images
        let width: number | null = null;
        let height: number | null = null;
        let hasPreview = false;

        if (isImageKind(kind)) {
          const imageInfo = await processImage(savedPath);
          width = imageInfo.width;
          height = imageInfo.height;
          hasPreview = imageInfo.hasPreview;
        }

        // Create file record
        await db.insert(files).values({
          id: nanoid(),
          path: savedPath,
          name: savedName,
          mimeType,
          size: buffer.length,
          kind,
          width,
          height,
          hasPreview,
          folderId,
          uploaderId: userId || null,
          source: "texturetown",
          sourceArchive: null,
        });

        importedFiles++;
      } catch (error) {
        const msg = `${category.name}/${fileName}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        console.error(`[TextureTown] ${msg}`);
      }

      processedFiles++;

      // Update progress every 10 files
      if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
        const progress = 5 + Math.floor((processedFiles / totalFiles) * 90);
        await updateJobProgress(
          job.id,
          progress,
          `Imported ${importedFiles}/${processedFiles} textures (${category.niceName})...`
        );
      }
    }
  }

  // Recalculate folder counts and generate previews
  await updateJobProgress(job.id, 95, "Updating folder counts...");
  await recalculateFolderCounts(createdFolderIds);

  await updateJobProgress(job.id, 96, "Generating folder previews...");
  for (const folderId of createdFolderIds) {
    try {
      await generateFolderPreview(folderId);
    } catch (err) {
      console.error(`[TextureTown] Failed to generate preview for folder ${folderId}:`, err);
    }
  }

  return {
    totalFiles: importedFiles,
    totalFolders: categoriesImported.length,
    categoriesImported,
    errors: errors.slice(0, 50), // Limit errors in output
  };
}

// Register the job handler
registerJobHandler("texturetown-import", handleTextureTownImport);

export { handleTextureTownImport };
