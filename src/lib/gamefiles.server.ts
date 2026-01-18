/**
 * Game file parsing utilities for extracting textures from PAK, PK3, and BSP files.
 *
 * Supported formats:
 * - PAK: Quake 1/2 package files
 * - PK3: Quake 3+ package files (standard ZIP format)
 * - BSP: Quake 1 map files (version 29) with embedded MIPTEX textures
 *
 * References:
 * - qpakman source code (tmp/qpakman/)
 * - Quake specs: https://quakewiki.org/wiki/Quake_BSP_Format
 */

import { createReadStream } from "fs";
import { open, readFile } from "fs/promises";
import { Readable } from "stream";
import { createInflateRaw } from "zlib";

// ============================================================================
// Types
// ============================================================================

export interface GameFileEntry {
  name: string;
  offset: number;
  size: number;
  compressedSize?: number; // For ZIP/PK3
  isDirectory?: boolean;
}

export interface ParsedGameFile {
  type: "pak" | "pk3" | "bsp" | "wad2";
  entries: GameFileEntry[];
  textureCount?: number; // For BSP files
}

export interface ExtractedTexture {
  name: string;
  width: number;
  height: number;
  data: Buffer; // Raw pixel data (palette indices for MIPTEX, or image bytes)
  format: "miptex" | "image"; // miptex needs palette conversion
  mimeType?: string; // For image formats
}

// ============================================================================
// PAK Format Parser (Quake 1/2)
// ============================================================================

const PAK_MAGIC = "PACK";
const PAK_HEADER_SIZE = 12;
const PAK_ENTRY_SIZE = 64;

export async function parsePakFile(filePath: string): Promise<ParsedGameFile> {
  const handle = await open(filePath, "r");

  try {
    // Read header (12 bytes)
    const headerBuf = Buffer.alloc(PAK_HEADER_SIZE);
    await handle.read(headerBuf, 0, PAK_HEADER_SIZE, 0);

    const magic = headerBuf.toString("ascii", 0, 4);
    if (magic !== PAK_MAGIC) {
      throw new Error(`Invalid PAK file: expected magic "PACK", got "${magic}"`);
    }

    const dirOffset = headerBuf.readUInt32LE(4);
    const dirSize = headerBuf.readUInt32LE(8);
    const entryCount = Math.floor(dirSize / PAK_ENTRY_SIZE);

    // Read directory
    const dirBuf = Buffer.alloc(dirSize);
    await handle.read(dirBuf, 0, dirSize, dirOffset);

    const entries: GameFileEntry[] = [];

    for (let i = 0; i < entryCount; i++) {
      const entryOffset = i * PAK_ENTRY_SIZE;

      // Name is 56 bytes, null-terminated
      let nameEnd = 56;
      for (let j = 0; j < 56; j++) {
        if (dirBuf[entryOffset + j] === 0) {
          nameEnd = j;
          break;
        }
      }
      const name = dirBuf.toString("ascii", entryOffset, entryOffset + nameEnd);

      const offset = dirBuf.readUInt32LE(entryOffset + 56);
      const size = dirBuf.readUInt32LE(entryOffset + 60);

      entries.push({ name, offset, size });
    }

    return { type: "pak", entries };
  } finally {
    await handle.close();
  }
}

export async function extractPakEntry(
  filePath: string,
  entry: GameFileEntry
): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(entry.size);
    await handle.read(buf, 0, entry.size, entry.offset);
    return buf;
  } finally {
    await handle.close();
  }
}

// ============================================================================
// PK3 Format Parser (ZIP-based)
// ============================================================================

// ZIP local file header signature
const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_END_SIG = 0x06054b50;

export async function parsePk3File(filePath: string): Promise<ParsedGameFile> {
  const data = await readFile(filePath);

  // Find End of Central Directory (search from end)
  let eocdOffset = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (data.readUInt32LE(i) === ZIP_END_SIG) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid PK3/ZIP file: End of Central Directory not found");
  }

  // Parse EOCD
  const centralDirOffset = data.readUInt32LE(eocdOffset + 16);
  const entryCount = data.readUInt16LE(eocdOffset + 10);

  const entries: GameFileEntry[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (data.readUInt32LE(offset) !== ZIP_CENTRAL_SIG) {
      throw new Error("Invalid central directory entry");
    }

    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLen = data.readUInt16LE(offset + 28);
    const extraLen = data.readUInt16LE(offset + 30);
    const commentLen = data.readUInt16LE(offset + 32);
    const localHeaderOffset = data.readUInt32LE(offset + 42);

    const name = data.toString("utf8", offset + 46, offset + 46 + nameLen);
    const isDirectory = name.endsWith("/");

    entries.push({
      name,
      offset: localHeaderOffset,
      size: uncompressedSize,
      compressedSize,
      isDirectory,
    });

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return { type: "pk3", entries };
}

export async function extractPk3Entry(
  filePath: string,
  entry: GameFileEntry
): Promise<Buffer> {
  const data = await readFile(filePath);

  // Read local file header
  const localOffset = entry.offset;
  if (data.readUInt32LE(localOffset) !== ZIP_LOCAL_SIG) {
    throw new Error("Invalid local file header");
  }

  const compressionMethod = data.readUInt16LE(localOffset + 8);
  const compressedSize = data.readUInt32LE(localOffset + 18);
  const nameLen = data.readUInt16LE(localOffset + 26);
  const extraLen = data.readUInt16LE(localOffset + 28);

  const dataOffset = localOffset + 30 + nameLen + extraLen;
  const compressedData = data.subarray(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) {
    // Stored (no compression)
    return Buffer.from(compressedData);
  } else if (compressionMethod === 8) {
    // Deflate - ZIP uses raw deflate (no zlib header)
    return new Promise((resolve, reject) => {
      const inflate = createInflateRaw();
      const chunks: Buffer[] = [];

      inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
      inflate.on("end", () => resolve(Buffer.concat(chunks)));
      inflate.on("error", reject);

      inflate.write(compressedData);
      inflate.end();
    });
  } else {
    throw new Error(`Unsupported compression method: ${compressionMethod}`);
  }
}

// ============================================================================
// BSP Format Parser (Quake 1 & 2)
// ============================================================================

const BSP_VERSION_Q1 = 29; // 0x1D - Quake 1
const BSP_MAGIC_Q2 = 0x50534249; // "IBSP" - Quake 2/3
const BSP_VERSION_Q2 = 38; // Quake 2 version
const BSP_VERSION_Q3 = 46; // Quake 3 version

// Quake 1 lump indices
const Q1_LUMP_TEXTURES = 2;

// Quake 2 lump indices
const Q2_LUMP_TEXINFO = 5;

const MIPTEX_HEADER_SIZE = 40;

// Quake 2 texinfo structure size (76 bytes)
const Q2_TEXINFO_SIZE = 76;

interface BspLump {
  offset: number;
  length: number;
}

interface MiptexHeader {
  name: string;
  width: number;
  height: number;
  offsets: number[]; // 4 mip level offsets
}

export interface ParsedBspFile extends ParsedGameFile {
  bspType: "q1" | "q2" | "q3";
  textureNames?: string[]; // For Q2/Q3 - external texture references
}

export async function parseBspFile(filePath: string): Promise<ParsedGameFile> {
  const data = await readFile(filePath);
  return parseBspBuffer(data);
}

/**
 * Parse BSP from a buffer (for embedded BSPs in PAK/PK3 files)
 */
export function parseBspBuffer(data: Buffer): ParsedBspFile {
  const firstInt = data.readInt32LE(0);

  // Check for Quake 2/3 format (IBSP magic)
  if (firstInt === BSP_MAGIC_Q2) {
    const version = data.readInt32LE(4);
    if (version === BSP_VERSION_Q2) {
      return parseQ2BspBuffer(data);
    } else if (version === BSP_VERSION_Q3) {
      throw new Error(
        `Quake 3 BSP format (IBSP v${version}) not yet supported. ` +
        `Q3 BSPs use shader references, not direct textures.`
      );
    } else {
      throw new Error(`Unknown IBSP version: ${version}`);
    }
  }

  // Check for Quake 1 format (version number directly)
  if (firstInt === BSP_VERSION_Q1) {
    return parseQ1BspBuffer(data);
  }

  throw new Error(
    `Unsupported BSP format. First bytes: 0x${firstInt.toString(16)}. ` +
    `Supported: Quake 1 (v29), Quake 2 (IBSP v38).`
  );
}

/**
 * Parse Quake 1 BSP (version 29) with embedded MIPTEX textures
 */
function parseQ1BspBuffer(data: Buffer): ParsedBspFile {
  // Get texture lump info (lump 2)
  const texLumpOffset = data.readInt32LE(4 + Q1_LUMP_TEXTURES * 8);
  const texLumpLength = data.readInt32LE(4 + Q1_LUMP_TEXTURES * 8 + 4);

  // Read texture lump header
  const numTextures = data.readInt32LE(texLumpOffset);

  const entries: GameFileEntry[] = [];

  for (let i = 0; i < numTextures; i++) {
    const texOffset = data.readInt32LE(texLumpOffset + 4 + i * 4);

    // Skip unused entries (high bit set)
    if (texOffset < 0 || texOffset === 0x80000000) {
      continue;
    }

    const miptexOffset = texLumpOffset + texOffset;

    // Parse name (16 bytes, null-terminated)
    let nameEnd = 16;
    for (let j = 0; j < 16; j++) {
      if (data[miptexOffset + j] === 0) {
        nameEnd = j;
        break;
      }
    }
    const name = data.toString("ascii", miptexOffset, miptexOffset + nameEnd);

    const width = data.readUInt32LE(miptexOffset + 16);
    const height = data.readUInt32LE(miptexOffset + 20);

    // Calculate total size including all mip levels
    // Mip sizes: w*h + (w/2)*(h/2) + (w/4)*(h/4) + (w/8)*(h/8) = w*h * 85/64
    const totalPixels = Math.floor((width * height * 85) / 64);
    const size = MIPTEX_HEADER_SIZE + totalPixels;

    entries.push({
      name,
      offset: miptexOffset,
      size,
    });
  }

  return { type: "bsp", bspType: "q1", entries, textureCount: numTextures };
}

/**
 * Parse Quake 2 BSP (IBSP v38) - textures are external WAL files
 * Returns texture name references that need to be resolved from PAK/filesystem
 */
function parseQ2BspBuffer(data: Buffer): ParsedBspFile {
  // Q2 BSP header: magic (4) + version (4) + 19 lumps (8 bytes each)
  // Lump format: offset (4) + length (4)
  const headerSize = 8 + 19 * 8;

  // Get texinfo lump (lump 5)
  const texinfoOffset = data.readInt32LE(8 + Q2_LUMP_TEXINFO * 8);
  const texinfoLength = data.readInt32LE(8 + Q2_LUMP_TEXINFO * 8 + 4);

  const numTexinfos = Math.floor(texinfoLength / Q2_TEXINFO_SIZE);

  // Extract unique texture names from texinfo entries
  const textureNames = new Set<string>();
  const entries: GameFileEntry[] = [];

  for (let i = 0; i < numTexinfos; i++) {
    const entryOffset = texinfoOffset + i * Q2_TEXINFO_SIZE;

    // texinfo_t structure:
    // float vecs[2][4] - 32 bytes (texture vectors)
    // int flags - 4 bytes
    // int value - 4 bytes
    // char texture[32] - 32 bytes (texture name, null-terminated)
    // int nexttexinfo - 4 bytes
    // Total: 76 bytes

    const textureNameOffset = entryOffset + 32 + 4 + 4; // After vecs, flags, value

    // Parse texture name (32 bytes, null-terminated)
    let nameEnd = 32;
    for (let j = 0; j < 32; j++) {
      if (data[textureNameOffset + j] === 0) {
        nameEnd = j;
        break;
      }
    }
    const name = data.toString("ascii", textureNameOffset, textureNameOffset + nameEnd);

    // Skip empty names or duplicates
    if (name && !textureNames.has(name)) {
      textureNames.add(name);

      // Create an entry for each unique texture
      // Note: offset/size are not meaningful for Q2 since textures are external
      entries.push({
        name: `textures/${name}.wal`, // Q2 textures are in textures/ folder as .wal files
        offset: 0,
        size: 0,
      });
    }
  }

  return {
    type: "bsp",
    bspType: "q2",
    entries,
    textureCount: entries.length,
    textureNames: Array.from(textureNames),
  };
}

export async function extractBspTexture(
  filePath: string,
  entry: GameFileEntry
): Promise<ExtractedTexture> {
  const data = await readFile(filePath);
  return extractBspTextureFromBuffer(data, entry);
}

/**
 * Extract Q1 BSP texture from a buffer (for embedded BSPs in PAK/PK3 files)
 * Only works for Quake 1 BSPs with embedded MIPTEX
 */
export function extractBspTextureFromBuffer(
  data: Buffer,
  entry: GameFileEntry
): ExtractedTexture {
  const width = data.readUInt32LE(entry.offset + 16);
  const height = data.readUInt32LE(entry.offset + 20);
  const mip0Offset = data.readUInt32LE(entry.offset + 24); // First mip level offset

  // Read only mip level 0 (full resolution)
  const pixelCount = width * height;
  const pixelData = data.subarray(
    entry.offset + mip0Offset,
    entry.offset + mip0Offset + pixelCount
  );

  return {
    name: entry.name,
    width,
    height,
    data: Buffer.from(pixelData), // Copy to avoid issues with subarray
    format: "miptex",
  };
}

// ============================================================================
// WAL Format Parser (Quake 2 textures)
// ============================================================================

/**
 * WAL file header structure (100 bytes):
 * char name[32]      - texture name
 * uint32 width       - texture width
 * uint32 height      - texture height
 * uint32 offsets[4]  - mipmap offsets
 * char animname[32]  - next frame in animation (or empty)
 * int32 flags        - surface flags
 * int32 contents     - content flags
 * int32 value        - light value
 */
const WAL_HEADER_SIZE = 100;

/**
 * Parse a WAL texture file (Quake 2 format)
 */
export function parseWalBuffer(data: Buffer): ExtractedTexture {
  if (data.length < WAL_HEADER_SIZE) {
    throw new Error("WAL file too small");
  }

  // Parse name (32 bytes, null-terminated)
  let nameEnd = 32;
  for (let j = 0; j < 32; j++) {
    if (data[j] === 0) {
      nameEnd = j;
      break;
    }
  }
  const name = data.toString("ascii", 0, nameEnd);

  const width = data.readUInt32LE(32);
  const height = data.readUInt32LE(36);
  const mip0Offset = data.readUInt32LE(40); // First mipmap offset

  // Read mip level 0 (full resolution)
  const pixelCount = width * height;
  const pixelData = data.subarray(mip0Offset, mip0Offset + pixelCount);

  return {
    name,
    width,
    height,
    data: Buffer.from(pixelData),
    format: "miptex", // Uses same palette-indexed format, but with Q2 palette
  };
}

/**
 * Check if an entry is a WAL texture file
 */
export function isWalEntry(entry: GameFileEntry): boolean {
  return entry.name.toLowerCase().endsWith(".wal");
}

/**
 * Filter entries to only WAL texture files
 */
export function filterWalEntries(entries: GameFileEntry[]): GameFileEntry[] {
  return entries.filter((e) => !e.isDirectory && isWalEntry(e));
}

// ============================================================================
// Quake Palettes for MIPTEX/WAL conversion
// ============================================================================

// Standard Quake 1 palette (256 RGB triplets)
const QUAKE1_PALETTE: number[] = [
  0, 0, 0, 15, 15, 15, 31, 31, 31, 47, 47, 47, 63, 63, 63, 75, 75, 75, 91, 91, 91,
  107, 107, 107, 123, 123, 123, 139, 139, 139, 155, 155, 155, 171, 171, 171, 187,
  187, 187, 203, 203, 203, 219, 219, 219, 235, 235, 235, 15, 11, 7, 23, 15, 11,
  31, 23, 11, 39, 27, 15, 47, 35, 19, 55, 43, 23, 63, 47, 23, 75, 55, 27, 83, 59,
  27, 91, 67, 31, 99, 75, 31, 107, 83, 31, 115, 87, 31, 123, 95, 35, 131, 103, 35,
  143, 111, 35, 11, 11, 15, 19, 19, 27, 27, 27, 39, 39, 39, 51, 47, 47, 63, 55,
  55, 75, 63, 63, 87, 71, 71, 103, 79, 79, 115, 91, 91, 127, 99, 99, 139, 107,
  107, 151, 115, 115, 163, 123, 123, 175, 131, 131, 187, 139, 139, 203, 0, 0, 0,
  7, 7, 0, 11, 11, 0, 19, 19, 0, 27, 27, 0, 35, 35, 0, 43, 43, 7, 47, 47, 7, 55,
  55, 7, 63, 63, 7, 71, 71, 7, 75, 75, 11, 83, 83, 11, 91, 91, 11, 99, 99, 11,
  107, 107, 15, 7, 0, 0, 15, 0, 0, 23, 0, 0, 31, 0, 0, 39, 0, 0, 47, 0, 0, 55, 0,
  0, 63, 0, 0, 71, 0, 0, 79, 0, 0, 87, 0, 0, 95, 0, 0, 103, 0, 0, 111, 0, 0, 119,
  0, 0, 127, 0, 0, 19, 19, 0, 27, 27, 0, 35, 35, 0, 47, 43, 0, 55, 47, 0, 67, 55,
  0, 75, 59, 7, 87, 67, 7, 95, 71, 7, 107, 75, 11, 119, 83, 15, 131, 87, 19, 139,
  91, 19, 151, 95, 27, 163, 99, 31, 175, 103, 35, 35, 19, 7, 47, 23, 11, 59, 31,
  15, 75, 35, 19, 87, 43, 23, 99, 47, 31, 115, 55, 35, 127, 59, 43, 143, 67, 51,
  159, 79, 51, 175, 99, 47, 191, 119, 47, 207, 143, 43, 223, 171, 39, 239, 203,
  31, 255, 243, 27, 11, 7, 0, 27, 19, 0, 43, 35, 15, 55, 43, 19, 71, 51, 27, 83,
  55, 35, 99, 63, 43, 111, 71, 51, 127, 83, 63, 139, 95, 71, 155, 107, 83, 167,
  123, 95, 183, 135, 107, 195, 147, 123, 211, 163, 139, 227, 179, 151, 171, 139,
  163, 159, 127, 151, 147, 115, 135, 139, 103, 123, 127, 91, 111, 119, 83, 99,
  107, 75, 87, 95, 63, 75, 87, 55, 67, 75, 47, 55, 67, 39, 47, 55, 31, 35, 43, 23,
  27, 35, 19, 19, 23, 11, 11, 15, 7, 7, 187, 115, 159, 175, 107, 143, 163, 95,
  131, 151, 87, 119, 139, 79, 107, 127, 75, 95, 115, 67, 83, 107, 59, 75, 95, 51,
  63, 83, 43, 55, 71, 35, 43, 59, 31, 35, 47, 23, 27, 35, 19, 19, 23, 11, 11, 15,
  7, 7, 219, 195, 187, 203, 179, 167, 191, 163, 155, 175, 151, 139, 163, 135, 123,
  151, 123, 111, 135, 111, 95, 123, 99, 83, 107, 87, 71, 95, 75, 59, 83, 63, 51,
  67, 51, 39, 55, 43, 31, 39, 31, 23, 27, 19, 15, 15, 11, 7, 111, 131, 123, 103,
  123, 111, 95, 115, 103, 87, 107, 95, 79, 99, 87, 71, 91, 79, 63, 83, 71, 55, 75,
  63, 47, 67, 55, 43, 59, 47, 35, 51, 39, 31, 43, 31, 23, 35, 23, 15, 27, 19, 11,
  19, 11, 7, 11, 7, 255, 243, 27, 239, 223, 23, 219, 203, 19, 203, 183, 15, 187,
  167, 15, 171, 151, 11, 155, 131, 7, 139, 115, 7, 123, 99, 7, 107, 83, 0, 91, 71,
  0, 75, 55, 0, 59, 43, 0, 43, 31, 0, 27, 15, 0, 11, 7, 0, 0, 0, 255, 11, 11, 239,
  19, 19, 223, 27, 27, 207, 35, 35, 191, 43, 43, 175, 47, 47, 159, 47, 47, 143,
  47, 47, 127, 47, 47, 111, 47, 47, 95, 43, 43, 79, 35, 35, 63, 27, 27, 47, 19,
  19, 31, 11, 11, 15, 43, 0, 0, 59, 0, 0, 75, 7, 0, 95, 7, 0, 111, 15, 0, 127, 23,
  7, 147, 31, 7, 163, 39, 11, 183, 51, 15, 195, 75, 27, 207, 99, 43, 219, 127, 59,
  227, 151, 79, 231, 171, 95, 239, 191, 119, 247, 211, 139, 167, 123, 59, 183,
  155, 55, 199, 195, 55, 231, 227, 87, 127, 191, 255, 171, 231, 255, 215, 255,
  255, 103, 0, 0, 139, 0, 0, 179, 0, 0, 215, 0, 0, 255, 0, 0, 255, 243, 147, 255,
  247, 199, 255, 255, 255, 159, 91, 83,
];

// Quake 2 palette (256 RGB triplets) - from colormap.pcx
const QUAKE2_PALETTE: number[] = [
  0, 0, 0, 15, 15, 15, 31, 31, 31, 47, 47, 47, 63, 63, 63, 75, 75, 75, 91, 91, 91,
  107, 107, 107, 123, 123, 123, 139, 139, 139, 155, 155, 155, 171, 171, 171, 187,
  187, 187, 203, 203, 203, 219, 219, 219, 235, 235, 235, 99, 75, 35, 91, 67, 31,
  83, 63, 31, 79, 59, 27, 71, 55, 27, 63, 47, 23, 59, 43, 23, 51, 39, 19, 47, 35,
  19, 43, 31, 19, 39, 27, 15, 35, 23, 15, 27, 19, 11, 23, 15, 11, 19, 15, 7, 15,
  11, 7, 95, 95, 111, 91, 91, 103, 91, 83, 95, 87, 79, 91, 83, 75, 83, 79, 71, 75,
  71, 63, 67, 63, 59, 59, 59, 55, 55, 51, 47, 47, 47, 43, 43, 39, 39, 39, 35, 35,
  35, 27, 27, 27, 23, 23, 23, 19, 19, 19, 143, 119, 83, 123, 99, 67, 115, 91, 59,
  103, 79, 47, 207, 151, 75, 167, 123, 59, 139, 103, 47, 111, 83, 39, 235, 159,
  39, 203, 139, 35, 175, 119, 31, 147, 99, 27, 119, 79, 23, 91, 59, 15, 63, 39,
  11, 35, 23, 7, 167, 59, 43, 159, 47, 35, 151, 43, 27, 139, 39, 19, 127, 31, 15,
  115, 23, 11, 103, 23, 7, 87, 19, 0, 75, 15, 0, 67, 15, 0, 59, 15, 0, 51, 11, 0,
  43, 11, 0, 35, 11, 0, 27, 7, 0, 19, 7, 0, 123, 95, 75, 115, 87, 67, 107, 83, 63,
  103, 79, 59, 95, 71, 55, 87, 67, 51, 83, 63, 47, 75, 55, 43, 67, 51, 39, 63, 47,
  35, 55, 39, 27, 47, 35, 23, 39, 27, 19, 31, 23, 15, 23, 15, 11, 15, 11, 7, 111,
  59, 23, 95, 55, 23, 83, 47, 23, 67, 43, 23, 55, 35, 19, 39, 27, 15, 27, 19, 11,
  15, 11, 7, 179, 91, 79, 191, 123, 111, 203, 155, 147, 215, 187, 183, 203, 215,
  223, 179, 199, 211, 159, 183, 195, 135, 167, 183, 115, 151, 167, 91, 135, 155,
  71, 119, 139, 47, 103, 127, 23, 83, 111, 19, 75, 103, 15, 67, 91, 11, 63, 83, 7,
  55, 75, 7, 47, 63, 7, 39, 51, 0, 31, 43, 0, 23, 31, 0, 15, 19, 0, 7, 11, 0, 0,
  0, 139, 87, 87, 131, 79, 79, 123, 71, 71, 115, 67, 67, 107, 59, 59, 99, 51, 51,
  91, 47, 47, 83, 39, 39, 75, 35, 35, 67, 27, 27, 59, 23, 23, 51, 19, 19, 43, 15,
  15, 35, 11, 11, 27, 7, 7, 19, 0, 0, 0, 151, 159, 123, 143, 151, 115, 135, 139,
  107, 127, 131, 99, 119, 123, 95, 115, 115, 87, 107, 107, 79, 99, 99, 71, 91, 91,
  67, 79, 79, 59, 67, 67, 51, 55, 55, 43, 47, 47, 35, 35, 35, 27, 23, 23, 19, 15,
  15, 11, 159, 75, 63, 147, 67, 55, 139, 59, 47, 127, 55, 39, 119, 47, 35, 107,
  43, 27, 99, 35, 23, 87, 31, 19, 79, 27, 15, 67, 23, 11, 55, 19, 11, 43, 15, 7,
  31, 11, 7, 23, 7, 0, 11, 0, 0, 0, 0, 0, 119, 123, 207, 111, 115, 195, 103, 107,
  183, 99, 99, 167, 91, 91, 155, 83, 87, 143, 75, 79, 127, 71, 71, 115, 63, 63,
  103, 55, 55, 87, 47, 47, 75, 39, 39, 63, 35, 31, 47, 27, 23, 35, 19, 15, 23, 11,
  7, 7, 155, 171, 123, 143, 159, 111, 135, 151, 99, 123, 139, 87, 115, 131, 75,
  103, 119, 67, 95, 111, 59, 87, 103, 51, 75, 91, 39, 63, 79, 27, 55, 67, 19, 47,
  59, 11, 35, 47, 7, 27, 35, 0, 19, 23, 0, 11, 15, 0, 0, 255, 0, 35, 231, 15, 63,
  211, 27, 83, 187, 39, 95, 167, 47, 95, 143, 51, 95, 123, 51, 255, 255, 255, 255,
  255, 211, 255, 255, 167, 255, 255, 127, 255, 255, 83, 255, 255, 39, 255, 235, 31,
  255, 215, 23, 255, 191, 15, 255, 171, 7, 255, 147, 0, 239, 127, 0, 227, 107, 0,
  211, 87, 0, 199, 71, 0, 183, 59, 0, 171, 43, 0, 155, 31, 0, 143, 23, 0, 127, 15,
  0, 115, 7, 0, 95, 0, 0, 71, 0, 0, 47, 0, 0, 27, 0, 0, 239, 0, 0, 55, 55, 255,
  255, 0, 0, 0, 0, 255, 43, 43, 35, 27, 27, 23, 19, 19, 15, 235, 151, 127, 195,
  115, 83, 159, 87, 51, 123, 63, 27, 235, 211, 199, 199, 171, 155, 167, 139, 119,
  135, 107, 87, 159, 91, 83,
];

/**
 * Convert MIPTEX/WAL palette-indexed pixels to PNG buffer
 * @param texture - The extracted texture with palette indices
 * @param useQ2Palette - If true, use Quake 2 palette; otherwise use Quake 1 palette
 */
export async function miptexToPng(
  texture: ExtractedTexture,
  useQ2Palette: boolean = false
): Promise<Buffer> {
  const { width, height, data } = texture;
  const rgba = Buffer.alloc(width * height * 4);
  const palette = useQ2Palette ? QUAKE2_PALETTE : QUAKE1_PALETTE;

  for (let i = 0; i < data.length; i++) {
    const paletteIdx = data[i];
    const r = palette[paletteIdx * 3];
    const g = palette[paletteIdx * 3 + 1];
    const b = palette[paletteIdx * 3 + 2];

    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255; // Alpha
  }

  // Use our simple PNG encoder (no external dependencies)
  return createSimplePng(rgba, width, height);
}

/**
 * Create a simple uncompressed PNG (fallback when sharp not available)
 */
function createSimplePng(rgba: Buffer, width: number, height: number): Buffer {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type (RGBA)
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace

  const ihdrChunk = createPngChunk("IHDR", ihdrData);

  // IDAT chunk (raw uncompressed - this is a simplified version)
  // For proper PNG we'd need zlib compression
  // For now, just store as raw which won't be valid PNG but could work for testing
  // TODO: Use zlib to compress properly

  const { deflateSync } = require("zlib");

  // PNG filter byte (0 = none) before each row
  const filtered = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + width * 4)] = 0; // Filter type: None
    rgba.copy(filtered, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = deflateSync(filtered);
  const idatChunk = createPngChunk("IDAT", compressed);

  // IEND chunk
  const iendChunk = createPngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBytes = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBytes, data]);

  // CRC32 calculation
  const crc = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBytes, data, crcBuf]);
}

// CRC32 lookup table
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============================================================================
// File Type Detection
// ============================================================================

export async function detectGameFileType(
  filePath: string
): Promise<"pak" | "pk3" | "bsp" | "wad2" | "unknown"> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(8);
    await handle.read(buf, 0, 8, 0);

    const magic = buf.toString("ascii", 0, 4);

    if (magic === "PACK") return "pak";
    if (magic === "WAD2") return "wad2";
    if (magic === "IBSP") return "bsp"; // Quake 2/3 BSP

    // Check for ZIP (PK3)
    if (buf[0] === 0x50 && buf[1] === 0x4b) return "pk3";

    // Check for Quake 1 BSP (version number directly)
    const version = buf.readInt32LE(0);
    if (version === 29 || version === 30) return "bsp";

    return "unknown";
  } finally {
    await handle.close();
  }
}

// ============================================================================
// High-Level API
// ============================================================================

export async function parseGameFile(filePath: string): Promise<ParsedGameFile> {
  const type = await detectGameFileType(filePath);

  switch (type) {
    case "pak":
      return parsePakFile(filePath);
    case "pk3":
      return parsePk3File(filePath);
    case "bsp":
      return parseBspFile(filePath);
    default:
      throw new Error(`Unsupported or unknown file type: ${type}`);
  }
}

/**
 * Filter entries to only image/texture files
 */
export function filterTextureEntries(entries: GameFileEntry[]): GameFileEntry[] {
  const textureExts = [".tga", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".pcx", ".wal"];

  return entries.filter((e) => {
    if (e.isDirectory) return false;
    const lower = e.name.toLowerCase();
    return textureExts.some((ext) => lower.endsWith(ext));
  });
}

/**
 * Check if an entry is likely a texture based on path
 */
export function isTextureEntry(entry: GameFileEntry): boolean {
  const lower = entry.name.toLowerCase();

  // BSP textures don't have extensions
  if (!lower.includes(".")) return true;

  const textureExts = [".tga", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".pcx", ".wal"];
  return textureExts.some((ext) => lower.endsWith(ext));
}

/**
 * Check if an entry is a BSP file
 */
export function isBspEntry(entry: GameFileEntry): boolean {
  return entry.name.toLowerCase().endsWith(".bsp");
}

/**
 * Filter entries to only BSP files
 */
export function filterBspEntries(entries: GameFileEntry[]): GameFileEntry[] {
  return entries.filter((e) => !e.isDirectory && isBspEntry(e));
}
