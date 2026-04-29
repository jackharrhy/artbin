import * as p from "@clack/prompts";
import { resolve } from "path";
import { scanDirectory } from "../lib/scanner.ts";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function scan(args: Record<string, unknown>) {
  const targetPath = (args._ as string[])?.[1];

  if (!targetPath) {
    p.log.error("Usage: artbin scan <path>");
    process.exit(1);
  }

  const fullPath = resolve(targetPath);
  p.intro(`Scanning ${fullPath}`);

  const spinner = p.spinner();
  spinner.start("Scanning for game assets...");

  const result = await scanDirectory(fullPath, undefined, (msg) => {
    spinner.message(msg);
  });

  spinner.stop(
    `Found ${result.archives.length} archives and ${result.looseFiles.length} loose files`,
  );

  const byGameDir = new Map<string, typeof result.archives>();
  for (const archive of result.archives) {
    const key = archive.gameDir || "(ungrouped)";
    if (!byGameDir.has(key)) byGameDir.set(key, []);
    byGameDir.get(key)!.push(archive);
  }

  for (const [gameDir, archives] of byGameDir) {
    const totalSize = archives.reduce((sum, a) => sum + a.size, 0);
    const totalFiles = archives.reduce((sum, a) => sum + (a.entries.length || 1), 0);
    p.log.info(
      `\n${gameDir} (${archives.length} archives, ${totalFiles} files, ${formatSize(totalSize)})`,
    );

    for (const archive of archives) {
      const fileCount = archive.entries.length || 1;
      p.log.message(`  ${archive.name} (${fileCount} files, ${formatSize(archive.size)})`);
    }
  }

  if (result.looseFiles.length > 0) {
    const looseSize = result.looseFiles.reduce((sum, f) => sum + f.size, 0);
    p.log.info(`\nLoose files: ${result.looseFiles.length} files (${formatSize(looseSize)})`);
  }

  p.outro(`Total: ${result.totalFileCount} files (${formatSize(result.totalSize)})`);
}
