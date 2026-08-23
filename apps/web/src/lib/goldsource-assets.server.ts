import { basename, extname } from "node:path";

import { extractTexturesFromBSP, isBSPFile } from "@artbin/core/parsers/bsp";
import { eq } from "drizzle-orm";

import { db } from "~/db/connection.server";
import { files } from "~/db";
import { getOrCreateFolder, ingestFile, sanitizeFilename } from "./files.server";

export interface GoldSourceTextureExtractionInput {
  buffer: Buffer;
  fileName: string;
  parentFolderSlug: string;
  parentFolderId: string;
  uploaderId?: string | null;
}

export interface GoldSourceTextureExtractionResult {
  textureCount: number;
  folderId: string | null;
  errors: string[];
}

function slugifySegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "textures"
  );
}

export async function extractGoldSourceTextures(
  input: GoldSourceTextureExtractionInput,
): Promise<GoldSourceTextureExtractionResult> {
  const extension = extname(input.fileName).toLowerCase();
  if (extension !== ".bsp" || !isBSPFile(input.buffer)) {
    return { textureCount: 0, folderId: null, errors: [] };
  }

  const source = "bsp-extracted";
  const textures = await extractTexturesFromBSP(input.buffer);
  if (textures.length === 0) return { textureCount: 0, folderId: null, errors: [] };

  const baseName = basename(input.fileName, extension);
  const folderSlug = `${input.parentFolderSlug}/${slugifySegment(baseName)}-textures`;
  const folderId = await getOrCreateFolder(
    folderSlug,
    `${baseName} textures`,
    input.parentFolderId,
  );
  const errors: string[] = [];
  let textureCount = 0;

  for (const texture of textures) {
    const fileName = sanitizeFilename(`${texture.name}.png`);
    const path = `${folderSlug}/${fileName}`;
    const existing = await db.query.files.findFirst({ where: eq(files.path, path) });
    if (existing) continue;

    const ingested = await ingestFile({
      buffer: texture.pngBuffer,
      fileName,
      folderSlug,
      folderId,
      uploaderId: input.uploaderId ?? null,
      source,
      sourceArchive: input.fileName,
      kind: "texture",
      mimeType: "image/png",
      width: texture.width,
      height: texture.height,
    });

    if (ingested.isErr()) {
      errors.push(`${texture.name}: ${ingested.error.message}`);
    } else {
      textureCount++;
    }
  }

  return { textureCount, folderId, errors };
}
