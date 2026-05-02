/**
 * Texture Station (TheJang) import job handler
 *
 * Imports textures from thejang.com/textures/ into artbin.
 * Scrapes HTML pages to find texture images, creates folders for each category.
 */

import { db } from "~/db/connection.server";
import { folders, files, type Job } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createRequestLogger } from "evlog";

import { registerJobHandler, updateJobProgress } from "../jobs.server";
import { ingestFile, ensureDir, slugToPath, recalculateFolderCounts } from "../files.server";
import { generateFolderPreview } from "../folder-preview.server";

interface Category {
  page: string; // HTML page filename
  name: string; // Display name
  slug: string; // URL slug for folder
}

export interface TextureStationImportInput {
  categories?: string[]; // If empty/undefined, import all categories
  userId?: string;
}

export interface TextureStationImportOutput {
  totalFiles: number;
  totalFolders: number;
  categoriesImported: string[];
  errors: string[];
}

const BASE_URL = "https://thejang.com/textures";
const PARENT_SLUG = "texture-station";
const PARENT_NAME = "Texture Station";

const CATEGORIES: Category[] = [
  { page: "backgrounds_blue.htm", name: "Blue (Dark)", slug: "blue-dark" },
  { page: "backgrounds_lt_blue.htm", name: "Blue (Light)", slug: "blue-light" },
  { page: "backgrounds_cyan.htm", name: "Cyan", slug: "cyan" },
  { page: "backgrounds_dk_gray.htm", name: "Gray (Dark)", slug: "gray-dark" },
  { page: "backgrounds_lt_gray.htm", name: "Gray (Light)", slug: "gray-light" },
  { page: "backgrounds_green.htm", name: "Green", slug: "green" },
  { page: "backgrounds_purple.htm", name: "Purples", slug: "purples" },
  {
    page: "backgrounds_red_yellow.htm",
    name: "Reds & Yellows",
    slug: "reds-yellows",
  },
  { page: "backgrounds_brown.htm", name: "Browns & Tans", slug: "browns-tans" },
  {
    page: "backgrounds_multicolor.htm",
    name: "MultiColor",
    slug: "multicolor",
  },
  {
    page: "backgrounds_miscrock.htm",
    name: "Stones & Rocks",
    slug: "stones-rocks",
  },
  { page: "backgrounds_wood.htm", name: "Wood", slug: "wood" },
  { page: "backgrounds_other.htm", name: "Other", slug: "other" },
];

/**
 * Parse HTML page to extract texture image filenames from i2/ directory
 */
function parseTextureImages(html: string): string[] {
  const images: string[] = [];

  // Match IMG tags with SRC pointing to i2/ directory
  // Pattern: <IMG SRC="i2/Texture_xxx_nnn.jpg" or .gif
  const imgRegex = /SRC="(i2\/Texture_[^"]+\.(?:jpg|gif))"/gi;

  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const imgPath = match[1];
    // Extract just the filename
    const filename = imgPath.replace("i2/", "");
    if (!images.includes(filename)) {
      images.push(filename);
    }
  }

  return images;
}

/**
 * Fetch a category page and extract texture filenames
 */
async function fetchCategoryTextures(page: string): Promise<string[]> {
  const url = `${BASE_URL}/${page}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  return parseTextureImages(html);
}

/**
 * Download a texture file
 */
async function downloadTexture(filename: string): Promise<Buffer> {
  const url = `${BASE_URL}/i2/${filename}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get or create the parent Texture Station folder
 */
async function getOrCreateParentFolder(): Promise<string> {
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, PARENT_SLUG),
  });

  if (existing) {
    return existing.id;
  }

  const id = nanoid();
  await db.insert(folders).values({
    id,
    name: PARENT_NAME,
    slug: PARENT_SLUG,
    description: "Textures imported from thejang.com/textures (Texture Station)",
  });

  await ensureDir(slugToPath(PARENT_SLUG));

  return id;
}

/**
 * Get or create a category folder
 */
async function getOrCreateCategoryFolder(category: Category, parentId: string): Promise<string> {
  const slug = `${PARENT_SLUG}/${category.slug}`;

  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (existing) {
    return existing.id;
  }

  const id = nanoid();
  await db.insert(folders).values({
    id,
    name: category.name,
    slug,
    parentId,
    description: `${category.name} textures from Texture Station`,
  });

  await ensureDir(slugToPath(slug));

  return id;
}

async function handleTextureStationImport(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });
  const { categories: requestedCategories, userId } = input as unknown as TextureStationImportInput;

  await updateJobProgress(job.id, 2, "Scanning Texture Station categories...");

  // Filter categories if specific ones were requested
  let categoriesToImport = CATEGORIES;
  if (requestedCategories && requestedCategories.length > 0) {
    categoriesToImport = CATEGORIES.filter((cat) => requestedCategories.includes(cat.slug));
  }

  if (categoriesToImport.length === 0) {
    throw new Error("No categories to import");
  }

  // First pass: fetch all category pages to count total textures
  await updateJobProgress(job.id, 5, "Fetching category pages...");

  const categoryTextures: Map<Category, string[]> = new Map();
  let totalFiles = 0;

  for (const category of categoriesToImport) {
    try {
      const textures = await fetchCategoryTextures(category.page);
      categoryTextures.set(category, textures);
      totalFiles += textures.length;
    } catch (error) {
      log.error(error instanceof Error ? error : new Error(String(error)), {
        step: "fetch-category",
        page: category.page,
      });
      categoryTextures.set(category, []);
    }
  }

  await updateJobProgress(
    job.id,
    10,
    `Found ${totalFiles} textures in ${categoriesToImport.length} categories`,
  );

  // Create parent folder
  const parentFolderId = await getOrCreateParentFolder();
  const createdFolderIds: string[] = [parentFolderId];

  let processedFiles = 0;
  let importedFiles = 0;
  const errors: string[] = [];
  const categoriesImported: string[] = [];

  // Process each category
  for (const category of categoriesToImport) {
    const textures = categoryTextures.get(category) || [];
    if (textures.length === 0) continue;

    const folderId = await getOrCreateCategoryFolder(category, parentFolderId);
    createdFolderIds.push(folderId);
    categoriesImported.push(category.name);

    const folderSlug = `${PARENT_SLUG}/${category.slug}`;

    for (const filename of textures) {
      try {
        // Check if file already exists
        const filePath = `${folderSlug}/${filename}`;
        const existing = await db.query.files.findFirst({
          where: eq(files.path, filePath),
        });

        if (existing) {
          processedFiles++;
          continue; // Skip already imported files
        }

        // Download the texture
        const buffer = await downloadTexture(filename);

        // Ingest file (save, detect, process, hash, insert)
        const ingested = await ingestFile({
          buffer,
          fileName: filename,
          folderSlug,
          folderId,
          source: "texture-station",
          uploaderId: userId || null,
        });
        if (ingested.isErr()) throw ingested.error;

        importedFiles++;
      } catch (error) {
        const msg = `${category.slug}/${filename}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        log.error(error instanceof Error ? error : new Error(String(error)), {
          step: "import-texture",
          file: filename,
          category: category.slug,
        });
      }

      processedFiles++;

      // Update progress every 10 files
      if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
        const progress = 10 + Math.floor((processedFiles / totalFiles) * 85);
        await updateJobProgress(
          job.id,
          progress,
          `Imported ${importedFiles}/${processedFiles} textures (${category.name})...`,
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
      log.error(err instanceof Error ? err : new Error(String(err)), {
        step: "generate-preview",
        folderId,
      });
    }
  }

  log.emit();

  return {
    totalFiles: importedFiles,
    totalFolders: categoriesImported.length,
    categoriesImported,
    errors: errors.slice(0, 50), // Limit errors in output
  };
}

// Register the job handler
registerJobHandler("texture-station-import", handleTextureStationImport);

export { handleTextureStationImport };
