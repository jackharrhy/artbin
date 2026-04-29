import * as p from "@clack/prompts";
import { resolve, basename, dirname } from "path";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { scanDirectory, type ScannedArchive } from "../lib/scanner.ts";
import { loadConfig } from "../lib/config.ts";
import { ApiClient } from "../lib/api.ts";
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

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export async function importCmd(args: Record<string, unknown>) {
  const targetPath = (args._ as string[])?.[1];
  const folderSlug = (args.folder as string) || null;
  const dryRun = !!args["dry-run"];

  if (!targetPath) {
    p.log.error("Usage: artbin import <path> [--folder <slug>] [--dry-run]");
    process.exit(1);
  }

  const fullPath = resolve(targetPath);
  p.intro(`Importing from ${fullPath}`);

  if (dryRun) {
    p.log.info("Dry run mode -- no files will be uploaded");
  }

  const config = await loadConfig();
  if (!config) {
    p.log.error("Not logged in. Run: artbin login");
    process.exit(1);
  }

  const api = new ApiClient(config);

  const spinner = p.spinner();
  spinner.start("Verifying authentication...");
  try {
    await api.whoami();
    spinner.stop("Authenticated");
  } catch {
    spinner.stop("Authentication failed");
    p.log.error("Session expired. Run: artbin login");
    process.exit(1);
  }

  spinner.start("Scanning for game assets...");
  const scanResult = await scanDirectory(fullPath, undefined, (msg) => {
    spinner.message(msg);
  });
  spinner.stop(
    `Found ${scanResult.archives.length} archives and ${scanResult.looseFiles.length} loose files`,
  );

  if (scanResult.archives.length === 0 && scanResult.looseFiles.length === 0) {
    p.log.warning("No importable files found");
    p.outro("Nothing to import");
    return;
  }

  const rootSlug = folderSlug || cleanFolderSlug(basename(fullPath));
  const rootName = basename(fullPath);

  spinner.start("Extracting archive contents...");
  const allFiles: PreparedFile[] = [];

  for (const archive of scanResult.archives) {
    spinner.message(`Extracting ${archive.name}...`);
    const extracted = await extractArchiveFiles(archive);
    allFiles.push(...extracted);
  }

  for (const loose of scanResult.looseFiles) {
    try {
      const buffer = await readFile(loose.path);
      const relativePath = loose.path.slice(fullPath.length).replace(/^\//, "").replace(/\\/g, "/");
      const hash = sha256(buffer);
      const kind = detectKind(loose.name);
      const mimeType = await getMimeType(loose.name, buffer);

      allFiles.push({
        relativePath,
        buffer,
        sha256: hash,
        kind,
        mimeType,
      });
    } catch {
      // Skip unreadable files
    }
  }

  spinner.stop(`Prepared ${allFiles.length} files for upload`);

  if (allFiles.length === 0) {
    p.log.warning("No importable files after extraction");
    p.outro("Nothing to import");
    return;
  }

  if (dryRun) {
    p.log.info(`Would upload ${allFiles.length} files to folder: ${rootSlug}`);
    const totalSize = allFiles.reduce((sum, f) => sum + f.buffer.length, 0);
    p.log.info(`Total size: ${formatSize(totalSize)}`);
    p.outro("Dry run complete");
    return;
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
  spinner.start(`Creating ${folderSlugs.size} folders...`);
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

  try {
    await api.createFolders(folderInputs);
    spinner.stop("Folders ready");
  } catch (err) {
    spinner.stop("Failed to create folders");
    p.log.error(String(err));
    process.exit(1);
  }

  // Check manifest
  spinner.start("Checking which files are new...");
  const manifestFiles = allFiles.map((f) => ({
    path: f.relativePath,
    sha256: f.sha256,
    size: f.buffer.length,
  }));

  let newFilePaths: string[];
  try {
    const manifestResult = await api.checkManifest(rootSlug, manifestFiles);
    newFilePaths = manifestResult.newFiles;
    spinner.stop(
      `${newFilePaths.length} new files to upload (${manifestResult.existingFiles.length} already exist)`,
    );
  } catch (err) {
    spinner.stop("Manifest check failed");
    p.log.error(String(err));
    process.exit(1);
  }

  if (newFilePaths.length === 0) {
    p.outro("All files already uploaded");
    return;
  }

  const newFileSet = new Set(newFilePaths);
  const filesToUpload = allFiles.filter((f) => newFileSet.has(f.relativePath));

  const BATCH_SIZE = 10;
  let uploaded = 0;
  let failed = 0;

  p.log.info(`Uploading ${filesToUpload.length} files in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < filesToUpload.length; i += BATCH_SIZE) {
    const batch = filesToUpload.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(filesToUpload.length / BATCH_SIZE);

    spinner.start(
      `Batch ${batchNum}/${totalBatches} (${uploaded}/${filesToUpload.length} uploaded)`,
    );

    try {
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
        for (const err of result.errors) {
          p.log.warning(`Failed: ${err.path} - ${err.error}`);
        }
      }
    } catch (err) {
      spinner.stop(`Batch ${batchNum} failed`);
      p.log.error(String(err));
      p.log.info(`${uploaded} files uploaded before failure. Re-run to resume.`);
      process.exit(1);
    }
  }

  spinner.stop("Upload complete");
  p.outro(`Uploaded ${uploaded} files${failed > 0 ? ` (${failed} failed)` : ""}`);
}
