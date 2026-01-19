/**
 * BSP file parser for Quake 1 and Half-Life
 * 
 * Extracts embedded MIPTEX textures from BSP files.
 * Quake 1 BSP version 29, Half-Life BSP version 30.
 */

import sharp from "sharp";

// ============================================================================
// Quake 1 Palette (768 bytes - 256 RGB colors)
// ============================================================================

// Standard Quake 1 palette from gfx/palette.lmp
const QUAKE_PALETTE = new Uint8Array([
  0,0,0,15,15,15,31,31,31,47,47,47,63,63,63,75,75,75,91,91,91,107,107,107,
  123,123,123,139,139,139,155,155,155,171,171,171,187,187,187,203,203,203,
  219,219,219,235,235,235,15,11,7,23,15,11,31,23,11,39,27,15,47,35,19,55,43,
  23,63,47,23,75,55,27,83,59,27,91,67,31,99,75,31,107,83,31,115,87,31,123,95,
  35,131,103,35,143,111,35,11,11,15,19,19,27,27,27,39,39,39,51,47,47,63,55,55,
  75,63,63,87,71,71,103,79,79,115,91,91,127,99,99,139,107,107,151,115,115,163,
  123,123,175,131,131,187,139,139,203,0,0,0,7,7,0,11,11,0,19,19,0,27,27,0,35,
  35,0,43,43,7,47,47,7,55,55,7,63,63,7,71,71,7,75,75,11,83,83,11,91,91,11,99,
  99,11,107,107,15,7,0,0,15,0,0,23,0,0,31,0,0,39,0,0,47,0,0,55,0,0,63,0,0,71,
  0,0,79,0,0,87,0,0,95,0,0,103,0,0,111,0,0,119,0,0,127,0,0,19,19,0,27,27,0,35,
  35,0,47,43,0,55,47,0,67,55,0,75,59,7,87,67,7,95,71,7,107,75,11,119,83,15,131,
  87,19,139,91,19,151,95,27,163,99,31,175,103,35,35,19,7,47,23,11,59,31,15,75,
  35,19,87,43,23,99,47,31,115,55,35,127,59,43,143,67,51,159,79,51,175,99,47,
  191,119,47,207,143,43,223,171,39,239,203,31,255,243,27,11,7,0,27,19,0,43,35,
  15,55,43,19,71,51,27,83,55,35,99,63,43,111,71,51,127,83,63,139,95,71,155,107,
  83,167,123,95,183,135,107,195,147,123,211,163,139,227,179,151,171,139,163,
  159,127,151,147,115,135,139,103,123,127,91,111,119,83,99,107,75,87,95,63,75,
  87,55,67,75,47,55,67,39,47,55,31,35,43,23,27,35,19,19,23,11,11,15,7,7,187,
  115,159,175,107,143,163,95,131,151,87,119,139,79,107,127,75,95,115,67,83,
  107,59,75,95,51,63,83,43,55,71,35,43,59,31,35,47,23,27,35,19,19,23,11,11,15,
  7,7,219,195,187,203,179,167,191,163,155,175,151,139,163,135,123,151,123,111,
  135,111,95,123,99,83,107,87,71,95,75,59,83,63,51,67,51,39,55,43,31,39,31,23,
  27,19,15,15,11,7,111,131,123,103,123,111,95,115,103,87,107,95,79,99,87,71,
  91,79,63,83,71,55,75,63,47,67,55,43,59,47,35,51,39,31,43,31,23,35,23,15,27,
  19,11,19,11,7,11,7,255,243,27,239,223,23,219,203,19,203,183,15,187,167,15,
  171,151,11,155,131,7,139,115,7,123,99,7,107,83,0,91,71,0,75,55,0,59,43,0,43,
  31,0,27,15,0,11,7,0,0,0,255,11,11,239,19,19,223,27,27,207,35,35,191,43,43,
  175,47,47,159,47,47,143,47,47,127,47,47,111,47,47,95,43,43,79,35,35,63,27,
  27,47,19,19,31,11,11,15,43,0,0,59,0,0,75,7,0,95,7,0,111,15,0,127,23,7,147,
  31,7,163,39,11,183,51,15,195,75,27,207,99,43,219,127,59,227,151,79,231,171,
  95,239,191,119,247,211,139,167,123,59,183,155,55,199,195,55,231,227,87,127,
  191,255,171,231,255,215,255,255,103,0,0,139,0,0,179,0,0,215,0,0,255,0,0,255,
  243,147,255,247,199,255,255,255,159,91,83
]);

// ============================================================================
// BSP Types and Constants
// ============================================================================

// BSP version numbers
const BSP_VERSION_QUAKE1 = 29;
const BSP_VERSION_HALFLIFE = 30;

// Lump indices
const LUMP_TEXTURES = 2;

interface BSPHeader {
  version: number;
  lumps: Array<{ offset: number; length: number }>;
}

interface MipTex {
  name: string;
  width: number;
  height: number;
  pixels: Uint8Array;  // Raw indexed pixels (mip0 only)
}

// ============================================================================
// BSP Parsing Functions
// ============================================================================

/**
 * Parse BSP header and lump directory
 */
function parseBSPHeader(buffer: Buffer): BSPHeader | null {
  if (buffer.length < 4) return null;

  const version = buffer.readInt32LE(0);
  
  if (version !== BSP_VERSION_QUAKE1 && version !== BSP_VERSION_HALFLIFE) {
    return null;
  }

  // BSP has 15 lumps
  const lumps: Array<{ offset: number; length: number }> = [];
  for (let i = 0; i < 15; i++) {
    const offset = buffer.readInt32LE(4 + i * 8);
    const length = buffer.readInt32LE(4 + i * 8 + 4);
    lumps.push({ offset, length });
  }

  return { version, lumps };
}

/**
 * Parse MIPTEX textures from the texture lump
 */
function parseMipTextures(buffer: Buffer, header: BSPHeader): MipTex[] {
  const texLump = header.lumps[LUMP_TEXTURES];
  if (!texLump || texLump.length === 0) return [];

  const lumpStart = texLump.offset;
  const numMipTex = buffer.readInt32LE(lumpStart);

  if (numMipTex <= 0 || numMipTex > 10000) return []; // Sanity check

  const textures: MipTex[] = [];

  // Read offset table
  for (let i = 0; i < numMipTex; i++) {
    const offset = buffer.readInt32LE(lumpStart + 4 + i * 4);
    
    // -1 means empty slot
    if (offset === -1) continue;

    const mipTexOffset = lumpStart + offset;
    
    // Bounds check
    if (mipTexOffset + 40 > buffer.length) continue;

    // Read MIPTEX header
    // char name[16], uint32 width, uint32 height, uint32 offsets[4]
    const nameBytes = buffer.subarray(mipTexOffset, mipTexOffset + 16);
    const nullIdx = nameBytes.indexOf(0);
    const name = nameBytes.subarray(0, nullIdx === -1 ? 16 : nullIdx).toString("ascii");

    const width = buffer.readUInt32LE(mipTexOffset + 16);
    const height = buffer.readUInt32LE(mipTexOffset + 20);
    const mip0Offset = buffer.readUInt32LE(mipTexOffset + 24);

    // Sanity checks
    if (width === 0 || height === 0 || width > 4096 || height > 4096) continue;
    if (name.length === 0 || name.startsWith("*")) continue; // Skip special textures

    // Texture pixel data offset (relative to MIPTEX start for embedded textures)
    // For Quake 1/HL BSP, mip0Offset is relative to the MIPTEX structure start
    const pixelOffset = mipTexOffset + mip0Offset;
    const pixelSize = width * height;

    if (pixelOffset + pixelSize > buffer.length) continue;

    const pixels = new Uint8Array(buffer.subarray(pixelOffset, pixelOffset + pixelSize));

    textures.push({ name, width, height, pixels });
  }

  return textures;
}

/**
 * Convert indexed pixels to RGBA using palette
 */
function indexedToRGBA(
  pixels: Uint8Array, 
  width: number, 
  height: number,
  palette: Uint8Array
): Buffer {
  const rgba = Buffer.alloc(width * height * 4);

  for (let i = 0; i < pixels.length; i++) {
    const idx = pixels[i];
    const palOffset = idx * 3;
    rgba[i * 4 + 0] = palette[palOffset + 0]; // R
    rgba[i * 4 + 1] = palette[palOffset + 1]; // G
    rgba[i * 4 + 2] = palette[palOffset + 2]; // B
    rgba[i * 4 + 3] = idx === 255 ? 0 : 255;  // A (index 255 is transparent in Quake)
  }

  return rgba;
}

/**
 * Get palette for Half-Life BSP texture (embedded after mip data)
 */
function getHLPalette(buffer: Buffer, mipTexOffset: number, width: number, height: number): Uint8Array | null {
  // Half-Life MIPTEX has palette after all 4 mips
  // mip0: w*h, mip1: (w/2)*(h/2), mip2: (w/4)*(h/4), mip3: (w/8)*(h/8)
  // Then: 2 bytes (unknown), then 768 bytes palette
  
  const mip0Size = width * height;
  const mip1Size = (width / 2) * (height / 2);
  const mip2Size = (width / 4) * (height / 4);
  const mip3Size = (width / 8) * (height / 8);
  const totalMipSize = mip0Size + mip1Size + mip2Size + mip3Size;
  
  // MIPTEX header is 40 bytes, mip0 offset is at byte 24
  const mip0Offset = buffer.readUInt32LE(mipTexOffset + 24);
  const paletteOffset = mipTexOffset + mip0Offset + totalMipSize + 2;
  
  if (paletteOffset + 768 > buffer.length) return null;
  
  return new Uint8Array(buffer.subarray(paletteOffset, paletteOffset + 768));
}

// ============================================================================
// Public API
// ============================================================================

export interface ExtractedTexture {
  name: string;
  width: number;
  height: number;
  pngBuffer: Buffer;
}

/**
 * Check if a buffer contains a valid Quake 1 or Half-Life BSP file
 */
export function isBSPFile(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const version = buffer.readInt32LE(0);
  return version === BSP_VERSION_QUAKE1 || version === BSP_VERSION_HALFLIFE;
}

/**
 * Extract all textures from a BSP file
 */
export async function extractTexturesFromBSP(buffer: Buffer): Promise<ExtractedTexture[]> {
  const header = parseBSPHeader(buffer);
  if (!header) return [];

  const mipTextures = parseMipTextures(buffer, header);
  const results: ExtractedTexture[] = [];

  for (const tex of mipTextures) {
    try {
      // Use Quake palette for version 29, attempt HL palette for version 30
      let palette = QUAKE_PALETTE;
      
      // For Half-Life, we'd need to extract the embedded palette
      // For now, use Quake palette for both (works reasonably well)
      // TODO: Implement HL palette extraction if needed
      
      const rgba = indexedToRGBA(tex.pixels, tex.width, tex.height, palette);
      
      const pngBuffer = await sharp(rgba, {
        raw: {
          width: tex.width,
          height: tex.height,
          channels: 4,
        },
      })
        .png()
        .toBuffer();

      results.push({
        name: tex.name,
        width: tex.width,
        height: tex.height,
        pngBuffer,
      });
    } catch (error) {
      console.error(`Failed to convert texture ${tex.name}:`, error);
    }
  }

  return results;
}

/**
 * Get BSP version (29 for Quake 1, 30 for Half-Life, 0 for invalid)
 */
export function getBSPVersion(buffer: Buffer): number {
  if (buffer.length < 4) return 0;
  const version = buffer.readInt32LE(0);
  if (version === BSP_VERSION_QUAKE1 || version === BSP_VERSION_HALFLIFE) {
    return version;
  }
  return 0;
}
