import sharp from "sharp";

import { indexedToRGBA, QUAKE_PALETTE, type ExtractedTexture } from "./bsp";

const WAD_HEADER_SIZE = 12;
const WAD_DIRECTORY_ENTRY_SIZE = 32;
const MIPTEX_HEADER_SIZE = 40;
const MAX_LUMPS = 100_000;
const MAX_TEXTURE_DIMENSION = 4096;

export type WADVersion = "WAD2" | "WAD3";

export interface WADHeader {
  version: WADVersion;
  lumpCount: number;
  directoryOffset: number;
}

export interface WADLump {
  name: string;
  offset: number;
  diskSize: number;
  size: number;
  type: number;
  compression: number;
}

function readNullTerminatedAscii(buffer: Buffer, start: number, length: number): string {
  const bytes = buffer.subarray(start, start + length);
  const nullIndex = bytes.indexOf(0);
  return bytes.subarray(0, nullIndex === -1 ? length : nullIndex).toString("ascii");
}

export function parseWADHeader(buffer: Buffer): WADHeader | null {
  if (buffer.length < WAD_HEADER_SIZE) return null;

  const version = buffer.toString("ascii", 0, 4);
  if (version !== "WAD2" && version !== "WAD3") return null;

  const lumpCount = buffer.readInt32LE(4);
  const directoryOffset = buffer.readInt32LE(8);
  const directorySize = lumpCount * WAD_DIRECTORY_ENTRY_SIZE;

  if (
    lumpCount < 0 ||
    lumpCount > MAX_LUMPS ||
    directoryOffset < WAD_HEADER_SIZE ||
    directoryOffset > buffer.length ||
    directorySize > buffer.length - directoryOffset
  ) {
    return null;
  }

  return { version, lumpCount, directoryOffset };
}

export function parseWADLumps(buffer: Buffer, header: WADHeader): WADLump[] {
  const lumps: WADLump[] = [];

  for (let index = 0; index < header.lumpCount; index++) {
    const entryOffset = header.directoryOffset + index * WAD_DIRECTORY_ENTRY_SIZE;
    const offset = buffer.readInt32LE(entryOffset);
    const diskSize = buffer.readInt32LE(entryOffset + 4);
    const size = buffer.readInt32LE(entryOffset + 8);
    const type = buffer[entryOffset + 12];
    const compression = buffer[entryOffset + 13];
    const name = readNullTerminatedAscii(buffer, entryOffset + 16, 16);

    if (
      offset < WAD_HEADER_SIZE ||
      diskSize < 0 ||
      size < 0 ||
      offset > buffer.length ||
      diskSize > buffer.length - offset
    ) {
      continue;
    }

    lumps.push({ name, offset, diskSize, size, type, compression });
  }

  return lumps;
}

function parseMipTexture(
  buffer: Buffer,
  version: WADVersion,
  lump: WADLump,
): {
  name: string;
  width: number;
  height: number;
  pixels: Uint8Array;
  palette: Uint8Array;
  hasEmbeddedPalette: boolean;
  isTransparent: boolean;
} | null {
  // GoldSource WAD compression is not used in practice and requires a
  // different decoder. Refuse it instead of interpreting compressed bytes.
  if (lump.compression !== 0 || lump.diskSize < MIPTEX_HEADER_SIZE) return null;

  const end = lump.offset + lump.diskSize;
  const name = readNullTerminatedAscii(buffer, lump.offset, 16) || lump.name;
  const width = buffer.readUInt32LE(lump.offset + 16);
  const height = buffer.readUInt32LE(lump.offset + 20);
  const mip0Offset = buffer.readUInt32LE(lump.offset + 24);

  if (
    !name ||
    width === 0 ||
    height === 0 ||
    width > MAX_TEXTURE_DIMENSION ||
    height > MAX_TEXTURE_DIMENSION ||
    mip0Offset < MIPTEX_HEADER_SIZE
  ) {
    return null;
  }

  const pixelCount = width * height;
  const pixelOffset = lump.offset + mip0Offset;
  if (pixelOffset > end || pixelCount > end - pixelOffset) return null;

  let palette = QUAKE_PALETTE;
  let hasEmbeddedPalette = false;

  if (version === "WAD3") {
    const mip1Size = Math.floor(width / 2) * Math.floor(height / 2);
    const mip2Size = Math.floor(width / 4) * Math.floor(height / 4);
    const mip3Size = Math.floor(width / 8) * Math.floor(height / 8);
    const paletteCountOffset = pixelOffset + pixelCount + mip1Size + mip2Size + mip3Size;

    if (paletteCountOffset + 2 > end) return null;
    const paletteEntries = buffer.readUInt16LE(paletteCountOffset);
    const paletteOffset = paletteCountOffset + 2;
    const paletteSize = paletteEntries * 3;

    if (paletteEntries < 256 || paletteOffset > end || paletteSize > end - paletteOffset) {
      return null;
    }

    palette = new Uint8Array(buffer.subarray(paletteOffset, paletteOffset + 256 * 3));
    hasEmbeddedPalette = true;
  }

  return {
    name,
    width,
    height,
    pixels: new Uint8Array(buffer.subarray(pixelOffset, pixelOffset + pixelCount)),
    palette,
    hasEmbeddedPalette,
    isTransparent: name.startsWith("{"),
  };
}

export function isWADFile(buffer: Buffer): boolean {
  return parseWADHeader(buffer) !== null;
}

/** Extract WAD2/WAD3 MIP textures as browser-viewable PNGs. */
export async function extractTexturesFromWAD(buffer: Buffer): Promise<ExtractedTexture[]> {
  const header = parseWADHeader(buffer);
  if (!header) return [];

  const results: ExtractedTexture[] = [];
  for (const lump of parseWADLumps(buffer, header)) {
    const texture = parseMipTexture(buffer, header.version, lump);
    if (!texture) continue;

    const rgba = indexedToRGBA(
      texture.pixels,
      texture.width,
      texture.height,
      texture.palette,
      texture.isTransparent,
      texture.hasEmbeddedPalette,
    );
    const pngBuffer = await sharp(rgba, {
      raw: { width: texture.width, height: texture.height, channels: 4 },
    })
      .png()
      .toBuffer();

    results.push({
      name: texture.name,
      width: texture.width,
      height: texture.height,
      pngBuffer,
    });
  }

  return results;
}
