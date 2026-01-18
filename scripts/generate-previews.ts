/**
 * Batch generate PNG previews for legacy texture formats (TGA, PCX, BMP)
 * 
 * Usage: npx tsx scripts/generate-previews.ts [--dry-run]
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, isNull, or, like } from "drizzle-orm";
import { join } from "path";
import { access } from "fs/promises";
import * as schema from "../src/db/schema";
import { convertToPng, getImageDimensions } from "../src/lib/images.server";

const sqlite = new Database("artbin.db");
const db = drizzle(sqlite, { schema });

const UPLOADS_DIR = join(process.cwd(), "public/uploads");
const DRY_RUN = process.argv.includes("--dry-run");

async function generatePreviews() {
  console.log("🔍 Finding textures that need PNG previews...\n");

  // Find all textures without preview_filename that have legacy extensions
  const allTextures = await db
    .select({
      id: schema.textures.id,
      filename: schema.textures.filename,
      originalName: schema.textures.originalName,
      previewFilename: schema.textures.previewFilename,
      width: schema.textures.width,
      height: schema.textures.height,
    })
    .from(schema.textures)
    .where(isNull(schema.textures.previewFilename));

  // Filter to legacy formats
  const legacyTextures = allTextures.filter((t) => {
    const ext = t.filename.split(".").pop()?.toLowerCase();
    return ext && ["tga", "pcx", "bmp"].includes(ext);
  });

  console.log(`Found ${legacyTextures.length} legacy textures needing preview generation\n`);

  if (legacyTextures.length === 0) {
    console.log("✨ Nothing to do!");
    sqlite.close();
    return;
  }

  if (DRY_RUN) {
    console.log("🔸 DRY RUN - No changes will be made\n");
    for (const texture of legacyTextures) {
      console.log(`  Would convert: ${texture.filename} (${texture.originalName})`);
    }
    console.log(`\nWould process ${legacyTextures.length} files`);
    sqlite.close();
    return;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const texture of legacyTextures) {
    const inputPath = join(UPLOADS_DIR, texture.filename);
    const baseName = texture.filename.replace(/\.[^.]+$/, "");
    const previewFilename = `${baseName}.png`;
    const outputPath = join(UPLOADS_DIR, previewFilename);

    process.stdout.write(`Converting ${texture.filename}... `);

    // Check if source file exists
    try {
      await access(inputPath);
    } catch {
      console.log("SKIP (source missing)");
      skipped++;
      continue;
    }

    // Check if preview already exists (maybe from a previous partial run)
    try {
      await access(outputPath);
      // File exists, just update the database
      const dimensions = await getImageDimensions(outputPath);
      await db
        .update(schema.textures)
        .set({
          previewFilename,
          width: dimensions?.width ?? texture.width,
          height: dimensions?.height ?? texture.height,
        })
        .where(eq(schema.textures.id, texture.id));
      console.log("OK (already converted, updated DB)");
      success++;
      continue;
    } catch {
      // File doesn't exist, proceed with conversion
    }

    // Convert to PNG
    const converted = await convertToPng(inputPath, outputPath);
    if (!converted) {
      console.log("FAILED");
      failed++;
      continue;
    }

    // Get dimensions from the new PNG
    const dimensions = await getImageDimensions(outputPath);

    // Update database
    await db
      .update(schema.textures)
      .set({
        previewFilename,
        width: dimensions?.width ?? texture.width,
        height: dimensions?.height ?? texture.height,
      })
      .where(eq(schema.textures.id, texture.id));

    console.log("OK");
    success++;
  }

  console.log("\n" + "=".repeat(50));
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log("=".repeat(50));

  sqlite.close();
}

generatePreviews().catch((err) => {
  console.error("Fatal error:", err);
  sqlite.close();
  process.exit(1);
});
