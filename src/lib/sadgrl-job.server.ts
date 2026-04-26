/**
 * Sadgrl Tiled Backgrounds import job handler
 * 
 * Imports tiled backgrounds from sadgrl.online archived collection.
 * Images are hosted on sadhost.neocities.org/images/tiles/
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

interface Category {
  name: string;      // Display name
  slug: string;      // URL slug for folder
}

export interface SadgrlImportInput {
  userId?: string;
}

export interface SadgrlImportOutput {
  totalFiles: number;
  totalFolders: number;
  categoriesImported: string[];
  errors: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const PAGE_URL = "https://sadgrlonline.github.io/archived-sadgrl.online/webmastery/downloads/tiledbgs.html";
const PARENT_SLUG = "sadgrl-tiled-backgrounds";
const PARENT_NAME = "Sadgrl Tiled Backgrounds";

// Categories in the order they appear on the page
const CATEGORIES: Category[] = [
  { name: "Reds", slug: "reds" },
  { name: "Yellows & Oranges", slug: "yellows-oranges" },
  { name: "Greens", slug: "greens" },
  { name: "Blues", slug: "blues" },
  { name: "Purples", slug: "purples" },
  { name: "Pinks", slug: "pinks" },
  { name: "Blacks", slug: "blacks" },
  { name: "Grays", slug: "grays" },
  { name: "Whites", slug: "whites" },
  { name: "Transparents", slug: "transparents" },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse HTML to extract image URLs organized by category
 */
function parseImagesByCategory(html: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  
  // Split by category headers
  // Pattern: <strong>CategoryName</strong><br><br> followed by images until next <strong> or end
  const categoryPattern = /<strong>([^<]+)<\/strong>\s*<br>\s*<br>([\s\S]*?)(?=<br>\s*<br>\s*<strong>|<\/div>)/gi;
  
  let match;
  while ((match = categoryPattern.exec(html)) !== null) {
    const categoryName = match[1].trim();
    const imageSection = match[2];
    
    // Find the matching category
    const category = CATEGORIES.find(c => 
      c.name.toLowerCase() === categoryName.toLowerCase()
    );
    
    if (!category) continue;
    
    // Extract image URLs from this section
    const imgPattern = /src="(https:\/\/sadhost\.neocities\.org\/images\/tiles\/[^"]+)"/gi;
    const images: string[] = [];
    
    let imgMatch;
    while ((imgMatch = imgPattern.exec(imageSection)) !== null) {
      const url = imgMatch[1];
      if (!images.includes(url)) {
        images.push(url);
      }
    }
    
    result.set(category.slug, images);
  }
  
  return result;
}

/**
 * Get filename from URL
 */
function getFilenameFromUrl(url: string): string {
  const parts = url.split('/');
  return parts[parts.length - 1];
}

/**
 * Download an image
 */
async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get or create the parent folder
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
    description: "Tiled backgrounds from sadgrl.online archive",
  });

  await ensureDir(slugToPath(PARENT_SLUG));

  return id;
}

/**
 * Get or create a category folder
 */
async function getOrCreateCategoryFolder(
  category: Category,
  parentId: string
): Promise<string> {
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
    description: `${category.name} tiled backgrounds`,
  });

  await ensureDir(slugToPath(slug));

  return id;
}

// ============================================================================
// Job Handler
// ============================================================================

async function handleSadgrlImport(
  job: Job,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { userId } = input as unknown as SadgrlImportInput;

  await updateJobProgress(job.id, 2, "Fetching Sadgrl tiled backgrounds page...");

  // Fetch the page
  const res = await fetch(PAGE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  await updateJobProgress(job.id, 5, "Parsing image categories...");

  // Parse images by category
  const imagesByCategory = parseImagesByCategory(html);
  
  // Count total images
  let totalFiles = 0;
  for (const images of imagesByCategory.values()) {
    totalFiles += images.length;
  }

  await updateJobProgress(
    job.id,
    10,
    `Found ${totalFiles} images in ${imagesByCategory.size} categories`
  );

  // Create parent folder
  const parentFolderId = await getOrCreateParentFolder();
  const createdFolderIds: string[] = [parentFolderId];
  
  let processedFiles = 0;
  let importedFiles = 0;
  const errors: string[] = [];
  const categoriesImported: string[] = [];

  // Process each category
  for (const category of CATEGORIES) {
    const images = imagesByCategory.get(category.slug);
    if (!images || images.length === 0) continue;

    const folderId = await getOrCreateCategoryFolder(category, parentFolderId);
    createdFolderIds.push(folderId);
    categoriesImported.push(category.name);
    
    const folderSlug = `${PARENT_SLUG}/${category.slug}`;

    for (const imageUrl of images) {
      const filename = getFilenameFromUrl(imageUrl);
      
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

        // Download the image
        const buffer = await downloadImage(imageUrl);

        // Save file to disk
        const { path: savedPath, name: savedName } = await saveFile(
          buffer,
          folderSlug,
          filename,
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
          try {
            const imageInfo = await processImage(savedPath);
            if (imageInfo.isErr()) throw imageInfo.error;
            width = imageInfo.value.width;
            height = imageInfo.value.height;
            hasPreview = imageInfo.value.hasPreview;
          } catch (imgErr) {
            // Some formats might fail processing, continue anyway
            console.warn(`[Sadgrl] Image processing failed for ${filename}:`, imgErr);
          }
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
          source: "sadgrl",
          sourceArchive: null,
        });

        importedFiles++;
      } catch (error) {
        const msg = `${category.slug}/${filename}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        console.error(`[Sadgrl] ${msg}`);
      }

      processedFiles++;

      // Update progress every 10 files
      if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
        const progress = 10 + Math.floor((processedFiles / totalFiles) * 85);
        await updateJobProgress(
          job.id,
          progress,
          `Imported ${importedFiles}/${processedFiles} images (${category.name})...`
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
      console.error(`[Sadgrl] Failed to generate preview for folder ${folderId}:`, err);
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
registerJobHandler("sadgrl-import", handleSadgrlImport);

export { handleSadgrlImport };
