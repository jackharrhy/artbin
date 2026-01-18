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
const LUMP_TEXTURES = 2;
const MIPTEX_HEADER_SIZE = 40;
const MIP_LEVELS = 4;

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

export async function parseBspFile(filePath: string): Promise<ParsedGameFile> {
  const data = await readFile(filePath);
  return parseBspBuffer(data);
}

/**
 * Parse BSP from a buffer (for embedded BSPs in PAK/PK3 files)
 */
export function parseBspBuffer(data: Buffer): ParsedGameFile {
  const firstInt = data.readInt32LE(0);

  // Check for Quake 2 format (IBSP magic)
  if (firstInt === BSP_MAGIC_Q2) {
    const q2Version = data.readInt32LE(4);
    throw new Error(
      `Quake 2/3 BSP format (IBSP v${q2Version}) not yet supported. ` +
      `Quake 2+ BSPs store textures externally in WAL files, not embedded in the BSP.`
    );
  }

  // Check for Quake 1 format (version number directly)
  if (firstInt !== BSP_VERSION_Q1) {
    throw new Error(
      `Unsupported BSP version: ${firstInt}. ` +
      `Only Quake 1 BSP (version 29) with embedded textures is currently supported.`
    );
  }

  // Get texture lump info (lump 2)
  const texLumpOffset = data.readInt32LE(4 + LUMP_TEXTURES * 8);
  const texLumpLength = data.readInt32LE(4 + LUMP_TEXTURES * 8 + 4);

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

  return { type: "bsp", entries, textureCount: numTextures };
}

export async function extractBspTexture(
  filePath: string,
  entry: GameFileEntry
): Promise<ExtractedTexture> {
  const data = await readFile(filePath);
  return extractBspTextureFromBuffer(data, entry);
}

/**
 * Extract BSP texture from a buffer (for embedded BSPs in PAK/PK3 files)
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
// Quake Palette for MIPTEX conversion
// ============================================================================

// Standard Quake 1 palette (256 RGB triplets)
// This is the default quake palette - textures use indices into this
const QUAKE_PALETTE: number[] = [
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

/**
 * Convert MIPTEX palette-indexed pixels to PNG buffer
 */
export async function miptexToPng(texture: ExtractedTexture): Promise<Buffer> {
  // We'll create a simple PNG manually or use a library
  // For now, let's create raw RGBA data and use sharp if available
  // Fallback: create a BMP or raw buffer

  const { width, height, data } = texture;
  const rgba = Buffer.alloc(width * height * 4);

  for (let i = 0; i < data.length; i++) {
    const paletteIdx = data[i];
    const r = QUAKE_PALETTE[paletteIdx * 3];
    const g = QUAKE_PALETTE[paletteIdx * 3 + 1];
    const b = QUAKE_PALETTE[paletteIdx * 3 + 2];

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
    const buf = Buffer.alloc(4);
    await handle.read(buf, 0, 4, 0);

    const magic = buf.toString("ascii", 0, 4);

    if (magic === "PACK") return "pak";
    if (magic === "WAD2") return "wad2";

    // Check for ZIP (PK3)
    if (buf[0] === 0x50 && buf[1] === 0x4b) return "pk3";

    // Check for BSP (version number)
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
