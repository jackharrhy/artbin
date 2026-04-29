/**
 * BSP file parser for Quake 1 and Half-Life
 *
 * Re-exports from @artbin/core for backward compatibility.
 */

export {
  parseBSPHeader,
  parseMipTextures,
  extractTexturesFromBSP,
  isBSPFile,
  getBSPVersion,
  type BSPHeader,
  type MipTexture,
  type ExtractedTexture,
} from "@artbin/core/parsers/bsp";
