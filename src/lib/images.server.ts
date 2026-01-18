import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { access } from "fs/promises";

const execAsync = promisify(exec);

// Legacy formats that need conversion for browser preview
const LEGACY_FORMATS = ["tga", "pcx", "bmp"];

/**
 * Check if a file extension is a legacy format that needs conversion
 */
export function isLegacyFormat(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? LEGACY_FORMATS.includes(ext) : false;
}

/**
 * Get MIME type for a file extension
 */
export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    tga: "image/x-tga",
    pcx: "image/x-pcx",
    bmp: "image/bmp",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

/**
 * Convert a legacy image format to PNG using ImageMagick
 * Returns the preview filename if conversion succeeds, null otherwise
 */
export async function convertToPng(
  inputPath: string,
  outputPath: string
): Promise<boolean> {
  try {
    // Use ImageMagick 7's magick command
    await execAsync(`magick "${inputPath}" "${outputPath}"`);
    
    // Verify the output file exists
    await access(outputPath);
    return true;
  } catch (error) {
    console.error("Image conversion failed:", error);
    return false;
  }
}

/**
 * Get image dimensions using ImageMagick
 */
export async function getImageDimensions(
  filePath: string
): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execAsync(
      `magick identify -format "%w %h" "${filePath}[0]"`
    );
    const [width, height] = stdout.trim().split(" ").map(Number);
    if (width && height) {
      return { width, height };
    }
    return null;
  } catch (error) {
    console.error("Failed to get image dimensions:", error);
    return null;
  }
}

/**
 * Process an uploaded texture file:
 * - For legacy formats (TGA, PCX, BMP): convert to PNG for preview
 * - Get dimensions for all formats
 * Returns preview filename if conversion was done
 */
export async function processTextureUpload(
  uploadsDir: string,
  filename: string
): Promise<{
  previewFilename: string | null;
  width: number | null;
  height: number | null;
}> {
  const inputPath = join(uploadsDir, filename);
  let previewFilename: string | null = null;
  
  // Convert legacy formats to PNG
  if (isLegacyFormat(filename)) {
    const baseName = filename.replace(/\.[^.]+$/, "");
    previewFilename = `${baseName}.png`;
    const outputPath = join(uploadsDir, previewFilename);
    
    const success = await convertToPng(inputPath, outputPath);
    if (!success) {
      previewFilename = null;
    }
  }
  
  // Get dimensions (from preview if available, otherwise from original)
  const dimensionPath = previewFilename 
    ? join(uploadsDir, previewFilename)
    : inputPath;
  const dimensions = await getImageDimensions(dimensionPath);
  
  return {
    previewFilename,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}
