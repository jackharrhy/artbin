/**
 * Settings management for artbin
 * 
 * Key-value store for application configuration, stored in the database.
 */

import { db, settings } from "~/db";
import { eq } from "drizzle-orm";

// ============================================================================
// Default Values
// ============================================================================

// Default directories to exclude from archive scans
const DEFAULT_EXCLUDE_DIRS = [
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
  "Electron Framework.framework",
  "Chromium Embedded Framework.framework",
  "test/fixture",
  "tests/fixture",
  "Battle.net",
  "zoom.us",
  "ToDesktop Builder",
  "minecraft/launcher",
];

// Default filenames to exclude (never game assets)
const DEFAULT_EXCLUDE_FILENAMES = [
  "locale.pak",
  "locale.zip",
  "cached.wad",
  "resources.pak",
  "resources.zip",
  "data.zip",
];

// Default path patterns to exclude (regex strings)
const DEFAULT_EXCLUDE_PATH_PATTERNS = [
  "/Electron Framework\\.framework/",
  "/Chromium Embedded Framework\\.framework/",
  "/test/fixture",
  "/tests/fixture",
  "TrenchBroom.*/test/",
  "Songs of Syx",
];

// Default known game directories
const DEFAULT_KNOWN_GAME_DIRS = [
  "id1", "hipnotic", "rogue", "quoth", "ad", "alkaline",
  "baseq2", "ctf", "xatrix",
  "baseq3", "missionpack", "cpma", "defrag",
  "valve", "cstrike", "tfc", "dod", "gearbox", "bshift",
  "doom", "doom2", "plutonia", "tnt",
  "data", "pak", "paks", "base", "main",
];

// ============================================================================
// Settings Interface
// ============================================================================

import type { ScanSettings } from "./settings.types";
export type { ScanSettings };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a setting value by key
 */
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });

  if (!row) {
    return defaultValue;
  }

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Set a setting value
 */
export async function setSetting<T>(key: string, value: T): Promise<void> {
  const jsonValue = JSON.stringify(value);
  const now = new Date();

  await db
    .insert(settings)
    .values({
      key,
      value: jsonValue,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: jsonValue,
        updatedAt: now,
      },
    });
}

/**
 * Get scan settings, initializing with defaults if not set
 */
export async function getScanSettings(): Promise<ScanSettings> {
  const [excludeDirs, excludeFilenames, excludePathPatterns, knownGameDirs] = await Promise.all([
    getSetting("scan.excludeDirs", DEFAULT_EXCLUDE_DIRS),
    getSetting("scan.excludeFilenames", DEFAULT_EXCLUDE_FILENAMES),
    getSetting("scan.excludePathPatterns", DEFAULT_EXCLUDE_PATH_PATTERNS),
    getSetting("scan.knownGameDirs", DEFAULT_KNOWN_GAME_DIRS),
  ]);

  return {
    excludeDirs,
    excludeFilenames,
    excludePathPatterns,
    knownGameDirs,
  };
}

/**
 * Initialize scan settings with defaults if they don't exist
 */
export async function initializeScanSettings(): Promise<ScanSettings> {
  // Check if any scan settings exist
  const existing = await db.query.settings.findFirst({
    where: eq(settings.key, "scan.excludeDirs"),
  });

  if (!existing) {
    // Initialize all settings with defaults
    await Promise.all([
      setSetting("scan.excludeDirs", DEFAULT_EXCLUDE_DIRS),
      setSetting("scan.excludeFilenames", DEFAULT_EXCLUDE_FILENAMES),
      setSetting("scan.excludePathPatterns", DEFAULT_EXCLUDE_PATH_PATTERNS),
      setSetting("scan.knownGameDirs", DEFAULT_KNOWN_GAME_DIRS),
    ]);
  }

  return getScanSettings();
}

/**
 * Update scan settings
 */
export async function updateScanSettings(updates: Partial<ScanSettings>): Promise<ScanSettings> {
  const promises: Promise<void>[] = [];

  if (updates.excludeDirs !== undefined) {
    promises.push(setSetting("scan.excludeDirs", updates.excludeDirs));
  }
  if (updates.excludeFilenames !== undefined) {
    promises.push(setSetting("scan.excludeFilenames", updates.excludeFilenames));
  }
  if (updates.excludePathPatterns !== undefined) {
    promises.push(setSetting("scan.excludePathPatterns", updates.excludePathPatterns));
  }
  if (updates.knownGameDirs !== undefined) {
    promises.push(setSetting("scan.knownGameDirs", updates.knownGameDirs));
  }

  await Promise.all(promises);

  return getScanSettings();
}

/**
 * Reset scan settings to defaults
 */
export async function resetScanSettings(): Promise<ScanSettings> {
  await Promise.all([
    setSetting("scan.excludeDirs", DEFAULT_EXCLUDE_DIRS),
    setSetting("scan.excludeFilenames", DEFAULT_EXCLUDE_FILENAMES),
    setSetting("scan.excludePathPatterns", DEFAULT_EXCLUDE_PATH_PATTERNS),
    setSetting("scan.knownGameDirs", DEFAULT_KNOWN_GAME_DIRS),
  ]);

  return getScanSettings();
}
