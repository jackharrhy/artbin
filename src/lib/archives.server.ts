/**
 * Archive extraction utilities for artbin
 * 
 * Handles PK3 (ZIP), PAK, and other game archive formats.
 */

import { createReadStream } from "fs";
import { open, readFile } from "fs/promises";
import { createInflateRaw } from "zlib";
import { Readable } from "stream";
import { basename, dirname, join } from "path";

// ============================================================================
// Types
// ============================================================================

export interface ArchiveEntry {
  name: string;           // Full path within archive: "textures/wall/brick.jpg"
  size: number;           // Uncompressed size
  compressedSize?: number;// Compressed size (for ZIP/PK3)
  offset: number;         // Offset in archive
  isDirectory: boolean;
}

export interface ParsedArchive {
  type: "pk3" | "pak" | "zip" | "unknown";
  entries: ArchiveEntry[];
}

// ============================================================================
// Archive Type Detection
// ============================================================================

/**
 * Detect archive type from file extension and magic bytes
 */
export async function detectArchiveType(filePath: string): Promise<ParsedArchive["type"]> {
  const ext = filePath.split(".").pop()?.toLowerCase();
  
  // Check extension first
  if (ext === "pk3" || ext === "pk4" || ext === "zip") return "pk3";
  if (ext === "pak") return "pak";
  
  // Check magic bytes
  const handle = await open(filePath, "r");
  const buffer = Buffer.alloc(4);
  await handle.read(buffer, 0, 4, 0);
  await handle.close();
  
  const magic = buffer.toString("ascii", 0, 4);
  
  if (magic === "PK\x03\x04" || magic === "PK\x05\x06") return "pk3";
  if (magic === "PACK") return "pak";
  
  return "unknown";
}

// ============================================================================
// PK3/ZIP Parsing
// ============================================================================

/**
 * Parse a PK3/ZIP archive and return its entries
 */
export async function parsePk3(filePath: string): Promise<ArchiveEntry[]> {
  const data = await readFile(filePath);
  const entries: ArchiveEntry[] = [];
  
  // Find end of central directory
  let eocdOffset = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  
  if (eocdOffset === -1) {
    throw new Error("Invalid PK3/ZIP: End of central directory not found");
  }
  
  // Read central directory info
  const cdEntries = data.readUInt16LE(eocdOffset + 10);
  const cdSize = data.readUInt32LE(eocdOffset + 12);
  const cdOffset = data.readUInt32LE(eocdOffset + 16);
  
  // Parse central directory
  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (
      data[pos] !== 0x50 ||
      data[pos + 1] !== 0x4b ||
      data[pos + 2] !== 0x01 ||
      data[pos + 3] !== 0x02
    ) {
      break;
    }
    
    const compressedSize = data.readUInt32LE(pos + 20);
    const uncompressedSize = data.readUInt32LE(pos + 24);
    const nameLength = data.readUInt16LE(pos + 28);
    const extraLength = data.readUInt16LE(pos + 30);
    const commentLength = data.readUInt16LE(pos + 32);
    const localHeaderOffset = data.readUInt32LE(pos + 42);
    
    const name = data.toString("utf8", pos + 46, pos + 46 + nameLength);
    const isDirectory = name.endsWith("/");
    
    entries.push({
      name: name.replace(/\/$/, ""),
      size: uncompressedSize,
      compressedSize,
      offset: localHeaderOffset,
      isDirectory,
    });
    
    pos += 46 + nameLength + extraLength + commentLength;
  }
  
  return entries;
}

/**
 * Extract a single entry from a PK3/ZIP archive
 */
export async function extractPk3Entry(
  filePath: string,
  entry: ArchiveEntry
): Promise<Buffer> {
  const data = await readFile(filePath);
  
  // Read local file header
  const pos = entry.offset;
  if (
    data[pos] !== 0x50 ||
    data[pos + 1] !== 0x4b ||
    data[pos + 2] !== 0x03 ||
    data[pos + 3] !== 0x04
  ) {
    throw new Error("Invalid local file header");
  }
  
  const compressionMethod = data.readUInt16LE(pos + 8);
  const compressedSize = data.readUInt32LE(pos + 18);
  const nameLength = data.readUInt16LE(pos + 26);
  const extraLength = data.readUInt16LE(pos + 28);
  
  const dataOffset = pos + 30 + nameLength + extraLength;
  const compressed = data.subarray(dataOffset, dataOffset + compressedSize);
  
  // No compression
  if (compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  
  // Deflate compression
  if (compressionMethod === 8) {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const inflate = createInflateRaw();
      
      inflate.on("data", (chunk) => chunks.push(chunk));
      inflate.on("end", () => resolve(Buffer.concat(chunks)));
      inflate.on("error", reject);
      
      inflate.write(compressed);
      inflate.end();
    });
  }
  
  throw new Error(`Unsupported compression method: ${compressionMethod}`);
}

// ============================================================================
// PAK Parsing (Quake 1/2)
// ============================================================================

/**
 * Parse a PAK archive and return its entries
 */
export async function parsePak(filePath: string): Promise<ArchiveEntry[]> {
  const handle = await open(filePath, "r");
  
  try {
    // Read header
    const header = Buffer.alloc(12);
    await handle.read(header, 0, 12, 0);
    
    const magic = header.toString("ascii", 0, 4);
    if (magic !== "PACK") {
      throw new Error("Invalid PAK file: Bad magic");
    }
    
    const dirOffset = header.readInt32LE(4);
    const dirSize = header.readInt32LE(8);
    const numEntries = dirSize / 64;
    
    // Read directory
    const dir = Buffer.alloc(dirSize);
    await handle.read(dir, 0, dirSize, dirOffset);
    
    const entries: ArchiveEntry[] = [];
    
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = i * 64;
      
      // Name is 56 bytes, null-terminated
      let nameEnd = entryOffset;
      while (nameEnd < entryOffset + 56 && dir[nameEnd] !== 0) {
        nameEnd++;
      }
      const name = dir.toString("ascii", entryOffset, nameEnd);
      
      const fileOffset = dir.readInt32LE(entryOffset + 56);
      const fileSize = dir.readInt32LE(entryOffset + 60);
      
      entries.push({
        name,
        size: fileSize,
        offset: fileOffset,
        isDirectory: false,
      });
    }
    
    return entries;
  } finally {
    await handle.close();
  }
}

/**
 * Extract a single entry from a PAK archive
 */
export async function extractPakEntry(
  filePath: string,
  entry: ArchiveEntry
): Promise<Buffer> {
  const handle = await open(filePath, "r");
  
  try {
    const buffer = Buffer.alloc(entry.size);
    await handle.read(buffer, 0, entry.size, entry.offset);
    return buffer;
  } finally {
    await handle.close();
  }
}

// ============================================================================
// Unified API
// ============================================================================

/**
 * Parse any supported archive type
 */
export async function parseArchive(filePath: string): Promise<ParsedArchive> {
  const type = await detectArchiveType(filePath);
  
  let entries: ArchiveEntry[];
  
  switch (type) {
    case "pk3":
      entries = await parsePk3(filePath);
      break;
    case "pak":
      entries = await parsePak(filePath);
      break;
    default:
      throw new Error(`Unsupported archive type: ${type}`);
  }
  
  return { type, entries };
}

/**
 * Extract a single entry from any supported archive type
 */
export async function extractEntry(
  filePath: string,
  entry: ArchiveEntry,
  archiveType: ParsedArchive["type"]
): Promise<Buffer> {
  switch (archiveType) {
    case "pk3":
      return extractPk3Entry(filePath, entry);
    case "pak":
      return extractPakEntry(filePath, entry);
    default:
      throw new Error(`Unsupported archive type: ${archiveType}`);
  }
}

/**
 * Get all unique directory paths from archive entries
 */
export function getDirectoryPaths(entries: ArchiveEntry[]): string[] {
  const dirs = new Set<string>();
  
  for (const entry of entries) {
    if (entry.isDirectory) {
      dirs.add(entry.name);
    } else {
      // Add parent directories
      const dir = dirname(entry.name);
      if (dir && dir !== ".") {
        // Add all parent paths
        const parts = dir.split("/");
        for (let i = 1; i <= parts.length; i++) {
          dirs.add(parts.slice(0, i).join("/"));
        }
      }
    }
  }
  
  return Array.from(dirs).sort();
}

/**
 * Filter entries to only files (no directories)
 */
export function getFileEntries(entries: ArchiveEntry[]): ArchiveEntry[] {
  return entries.filter((e) => !e.isDirectory && e.size > 0);
}
