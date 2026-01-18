/**
 * Shared types for settings
 * 
 * This file can be imported by both client and server code.
 */

export interface ScanSettings {
  excludeDirs: string[];
  excludeFilenames: string[];
  excludePathPatterns: string[];
  knownGameDirs: string[];
}
