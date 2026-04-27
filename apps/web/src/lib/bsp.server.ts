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
} from "@artbin/core/parsers";
export type { BSPHeader, MipTexture, ExtractedTexture } from "@artbin/core/parsers";
