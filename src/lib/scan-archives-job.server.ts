/**
 * Local archive scanner job handler
 * 
 * Scans the filesystem for game archives (PAK, PK3, WAD, ZIP) using fd.
 * Results are stored in job output for display in the admin UI.
 */

import { type Job } from "~/db";
import { exec } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import { basename, dirname } from "path";
import { registerJobHandler, updateJobProgress } from "./jobs.server";
import { homedir } from "os";

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface ScanArchivesInput {
  rootPath?: string;  // Defaults to home directory
}

export interface FoundArchive {
  path: string;       // Full path to file
  name: string;       // Filename
  size: number;       // File size in bytes
  type: string;       // pak, pk3, wad, zip
  parentDir: string;  // Immediate parent directory name
  gameDir: string | null;  // Known game directory if found in path
}

export interface ScanArchivesOutput {
  archives: FoundArchive[];
  totalFound: number;
  scanDuration: number;
  rootPath: string;
}

// ============================================================================
// Known Game Directories
// ============================================================================

// Directories that indicate game content
const KNOWN_GAME_DIRS = new Set([
  // Quake 1
  "id1", "hipnotic", "rogue", "quoth", "ad", "alkaline",
  // Quake 2
  "baseq2", "ctf", "rogue", "xatrix",
  // Quake 3
  "baseq3", "missionpack", "cpma", "defrag",
  // Half-Life
  "valve", "cstrike", "tfc", "dod", "gearbox", "bshift",
  // Doom
  "doom", "doom2", "plutonia", "tnt",
  // General
  "data", "pak", "paks", "base", "main",
]);

// Directories to exclude from search
const EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  ".npm",
  ".cache",
  ".Trash",
  "Library/Caches",
  "Library/Logs", 
  "Library/Developer",
  ".local/share/Trash",
  "__pycache__",
  ".venv",
  "venv",
  ".cargo/registry",
  ".rustup",
  "go/pkg",
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find a known game directory in the file path
 */
function findGameDir(filePath: string): string | null {
  const parts = filePath.toLowerCase().split("/");
  for (const part of parts) {
    if (KNOWN_GAME_DIRS.has(part)) {
      return part;
    }
  }
  return null;
}

/**
 * Get file extension without the dot, lowercase
 */
function getExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ext;
}

/**
 * Build fd command for scanning archives
 */
function buildFdCommand(rootPath: string): string {
  // Build exclusion patterns
  const excludeArgs = EXCLUDE_DIRS.map(dir => `-E "${dir}"`).join(" ");
  
  // Search for pak, pk3, wad, zip files
  // Use regex to match extensions (case insensitive with fd)
  const pattern = "\\.(pak|pk3|wad|zip)$";
  
  return `fd "${pattern}" --type f --ignore-case ${excludeArgs} "${rootPath}" 2>/dev/null`;
}

// ============================================================================
// Job Handler
// ============================================================================

async function handleScanArchives(
  job: Job,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { rootPath: inputPath } = input as unknown as ScanArchivesInput;
  const rootPath = inputPath || homedir();
  
  const startTime = Date.now();
  
  await updateJobProgress(job.id, 5, `Scanning ${rootPath} for game archives...`);
  
  // Run fd to find archives
  const fdCommand = buildFdCommand(rootPath);
  
  let stdout = "";
  try {
    const result = await execAsync(fdCommand, { 
      maxBuffer: 50 * 1024 * 1024,  // 50MB buffer for large result sets
      timeout: 5 * 60 * 1000,       // 5 minute timeout
    });
    stdout = result.stdout;
  } catch (error: any) {
    // fd returns exit code 1 if no matches found, which is fine
    if (error.stdout) {
      stdout = error.stdout;
    } else if (error.code !== 1) {
      throw new Error(`fd command failed: ${error.message}`);
    }
  }
  
  const filePaths = stdout.trim().split("\n").filter(Boolean);
  
  await updateJobProgress(
    job.id, 
    30, 
    `Found ${filePaths.length} potential archives, gathering details...`
  );
  
  // Gather file details
  const archives: FoundArchive[] = [];
  let processed = 0;
  
  for (const filePath of filePaths) {
    try {
      const stats = await stat(filePath);
      const name = basename(filePath);
      const ext = getExtension(name);
      
      // Skip very small files (likely not real game archives)
      if (stats.size < 1024) {
        processed++;
        continue;
      }
      
      // For zip files, only include if in a known game directory
      if (ext === "zip") {
        const gameDir = findGameDir(filePath);
        if (!gameDir) {
          processed++;
          continue;
        }
      }
      
      archives.push({
        path: filePath,
        name,
        size: stats.size,
        type: ext,
        parentDir: basename(dirname(filePath)),
        gameDir: findGameDir(filePath),
      });
    } catch {
      // Skip files we can't stat (permissions, etc)
    }
    
    processed++;
    
    // Update progress periodically
    if (processed % 100 === 0) {
      const progress = 30 + Math.floor((processed / filePaths.length) * 60);
      await updateJobProgress(
        job.id,
        progress,
        `Processing ${processed}/${filePaths.length} files...`
      );
    }
  }
  
  // Sort by game directory, then by path
  archives.sort((a, b) => {
    // Archives with known game dirs first
    if (a.gameDir && !b.gameDir) return -1;
    if (!a.gameDir && b.gameDir) return 1;
    // Then by game dir name
    if (a.gameDir && b.gameDir && a.gameDir !== b.gameDir) {
      return a.gameDir.localeCompare(b.gameDir);
    }
    // Then by path
    return a.path.localeCompare(b.path);
  });
  
  const scanDuration = Date.now() - startTime;
  
  await updateJobProgress(job.id, 95, `Found ${archives.length} game archives`);
  
  return {
    archives,
    totalFound: archives.length,
    scanDuration,
    rootPath,
  };
}

// Register the job handler
registerJobHandler("scan-archives", handleScanArchives);

export { handleScanArchives };
