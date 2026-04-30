import { readFile } from "fs/promises";
import { basename, dirname } from "path";
import { createHash } from "crypto";
import type { ScanResult, ScannedArchive } from "./scanner.ts";
import type { ApiClient } from "./api.ts";
import {
  parseArchive,
  extractPk3Entry,
  extractPakEntry,
  getFileEntries,
} from "@artbin/core/parsers/archives";
import { detectKind } from "@artbin/core/detection/kind";
import { getMimeType } from "@artbin/core/detection/mime";
import { cleanFolderSlug } from "@artbin/core/detection/filenames";
import { isImportableFile } from "@artbin/core/scanning/filters";

interface PreparedFile {
  relativePath: string;
  buffer: Buffer;
  sha256: string;
  kind: string;
  mimeType: string;
  sourceArchive?: string;
}

export interface ImportOptions {
  scanResult: ScanResult;
  archivePaths?: string[];
  api: ApiClient;
  rootSlug: string;
  dryRun?: boolean;
  onProgress?: (info: { phase: string; current: number; total: number; message: string }) => void;
}

export interface ImportResult {
  uploaded: number;
  failed: number;
  skipped: number;
  total: number;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function extractArchiveFiles(archive: ScannedArchive): Promise<PreparedFile[]> {
  const files: PreparedFile[] = [];
  const buffer = await readFile(archive.path);

  const archiveBase = basename(archive.name, "." + archive.type);
  const archiveSlug = cleanFolderSlug(archiveBase);

  if (archive.type === "bsp") {
    const hash = sha256(buffer);
    const kind = detectKind(archive.name);
    const mimeType = await getMimeType(archive.name, buffer);
    files.push({
      relativePath: `${archiveSlug}/${archive.name}`,
      buffer,
      sha256: hash,
      kind,
      mimeType,
    });
    return files;
  }

  const parsed = parseArchive(buffer);
  const entries = getFileEntries(parsed.entries);

  for (const entry of entries) {
    if (!isImportableFile(entry.name)) continue;

    try {
      let entryBuffer: Buffer;
      if (parsed.type === "pk3") {
        entryBuffer = await extractPk3Entry(buffer, entry);
      } else if (parsed.type === "pak") {
        entryBuffer = extractPakEntry(buffer, entry);
      } else {
        continue;
      }

      const hash = sha256(entryBuffer);
      const kind = detectKind(entry.name);
      const mimeType = await getMimeType(entry.name, entryBuffer);
      const fileName = basename(entry.name);
      const entryDir = dirname(entry.name);
      const relativePath =
        entryDir && entryDir !== "."
          ? `${archiveSlug}/${entryDir}/${fileName}`
          : `${archiveSlug}/${fileName}`;

      files.push({
        relativePath,
        buffer: entryBuffer,
        sha256: hash,
        kind,
        mimeType,
        sourceArchive: archive.name,
      });
    } catch {
      // Skip entries we can't extract
    }
  }

  return files;
}

export async function runImport(options: ImportOptions): Promise<ImportResult> {
  const { scanResult, archivePaths, api, rootSlug, dryRun, onProgress } = options;

  const progress = (phase: string, current: number, total: number, message: string) => {
    onProgress?.({ phase, current, total, message });
  };

  // Filter archives if a subset was specified
  const archives = archivePaths
    ? scanResult.archives.filter((a) => archivePaths.includes(a.path))
    : scanResult.archives;

  // Extract files from archives
  const allFiles: PreparedFile[] = [];
  for (let i = 0; i < archives.length; i++) {
    const archive = archives[i];
    progress("extracting", i + 1, archives.length, `Extracting ${archive.name}...`);
    const extracted = await extractArchiveFiles(archive);
    allFiles.push(...extracted);
  }

  // Extract loose files
  const looseFiles = scanResult.looseFiles;
  for (let i = 0; i < looseFiles.length; i++) {
    const loose = looseFiles[i];
    progress(
      "extracting",
      archives.length + i + 1,
      archives.length + looseFiles.length,
      `Reading ${loose.name}...`,
    );
    try {
      const buffer = await readFile(loose.path);
      // Use the path relative to the scan root. The scanner stores the full path,
      // so we derive a relative path from the name (last component) since loose
      // files don't have a natural archive-based prefix. We just use the filename.
      const hash = sha256(buffer);
      const kind = detectKind(loose.name);
      const mimeType = await getMimeType(loose.name, buffer);

      allFiles.push({
        relativePath: loose.name,
        buffer,
        sha256: hash,
        kind,
        mimeType,
      });
    } catch {
      // Skip unreadable files
    }
  }

  const total = allFiles.length;

  if (total === 0) {
    return { uploaded: 0, failed: 0, skipped: 0, total: 0 };
  }

  if (dryRun) {
    return { uploaded: 0, failed: 0, skipped: total, total };
  }

  // Collect unique folder slugs
  const folderSlugs = new Set<string>();
  folderSlugs.add(rootSlug);
  for (const file of allFiles) {
    const dir = dirname(file.relativePath);
    if (dir && dir !== ".") {
      const parts = dir.split("/");
      for (let i = 1; i <= parts.length; i++) {
        folderSlugs.add(`${rootSlug}/${parts.slice(0, i).join("/")}`);
      }
    }
  }

  // Create folders
  progress("folders", 0, 1, `Creating ${folderSlugs.size} folders...`);
  const sortedSlugs = Array.from(folderSlugs).sort(
    (a, b) => a.split("/").length - b.split("/").length,
  );

  const folderInputs = sortedSlugs.map((slug) => {
    const parts = slug.split("/");
    const name = parts[parts.length - 1];
    const parentSlug = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
    return {
      slug: cleanFolderSlug(slug),
      name,
      parentSlug: parentSlug ? cleanFolderSlug(parentSlug) : null,
    };
  });

  await api.createFolders(folderInputs);
  progress("folders", 1, 1, "Folders ready");

  // Check manifest for deduplication
  progress("manifest", 0, 1, "Checking which files are new...");
  const manifestFiles = allFiles.map((f) => ({
    path: f.relativePath,
    sha256: f.sha256,
    size: f.buffer.length,
  }));

  const manifestResult = await api.checkManifest(rootSlug, manifestFiles);
  const newFilePaths = manifestResult.newFiles;
  progress(
    "manifest",
    1,
    1,
    `${newFilePaths.length} new files (${manifestResult.existingFiles.length} already exist)`,
  );

  const skipped = manifestResult.existingFiles.length;

  if (newFilePaths.length === 0) {
    return { uploaded: 0, failed: 0, skipped, total };
  }

  const newFileSet = new Set(newFilePaths);
  const filesToUpload = allFiles.filter((f) => newFileSet.has(f.relativePath));

  // Upload in batches
  const BATCH_SIZE = 10;
  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < filesToUpload.length; i += BATCH_SIZE) {
    const batch = filesToUpload.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(filesToUpload.length / BATCH_SIZE);

    progress(
      "uploading",
      uploaded,
      filesToUpload.length,
      `Batch ${batchNum}/${totalBatches} (${uploaded}/${filesToUpload.length} uploaded)`,
    );

    const result = await api.uploadBatch(
      rootSlug,
      batch.map((f) => ({
        path: f.relativePath,
        kind: f.kind,
        mimeType: f.mimeType,
        sha256: f.sha256,
        sourceArchive: f.sourceArchive,
        buffer: f.buffer,
      })),
    );

    uploaded += result.uploaded.length;
    if (result.errors.length > 0) {
      failed += result.errors.length;
    }
  }

  progress("done", uploaded, filesToUpload.length, "Upload complete");

  return { uploaded, failed, skipped, total };
}
