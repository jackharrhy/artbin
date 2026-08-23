/**
 * Regenerate folder and file previews job handler.
 *
 * Regenerates preview images for all folders, and optionally
 * generates missing model previews for GLB/GLTF files.
 */

import { db } from "#db/connection.server";
import { files, folders, type Job } from "#db";
import { eq, and, isNull } from "drizzle-orm";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { createRequestLogger } from "evlog";

import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import {
  generateModelPreview,
  canGenerateModelPreview,
  getFilePath,
  getPreviewPath,
} from "../files.server.ts";
import { generateFolderPreview } from "../folder-preview.server.ts";

async function handleRegeneratePreviews(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });

  const includeModels = input.includeModels !== false;

  // Phase 1: Generate missing model previews
  let modelPreviews = 0;
  if (includeModels) {
    await updateJobProgress(job.id, 2, "Finding models without previews...");

    const modelsWithoutPreviews = await db.query.files.findMany({
      where: and(eq(files.kind, "model"), eq(files.hasPreview, false)),
      columns: { id: true, path: true, name: true },
    });

    const total = modelsWithoutPreviews.length;
    await updateJobProgress(job.id, 5, `Found ${total} models without previews`);

    for (let i = 0; i < modelsWithoutPreviews.length; i++) {
      const file = modelsWithoutPreviews[i];
      if (!canGenerateModelPreview(file.name)) continue;

      const fullPath = getFilePath(file.path);
      if (!existsSync(fullPath)) continue;

      try {
        const buffer = await readFile(fullPath);
        const previewPath = fullPath + ".preview.png";
        const result = await generateModelPreview(buffer, previewPath);

        if (result.isOk()) {
          await db.update(files).set({ hasPreview: true }).where(eq(files.id, file.id));
          modelPreviews++;
        }
      } catch (err) {
        log.error(err instanceof Error ? err : new Error(String(err)), {
          step: "model-preview",
          file: file.path,
        });
      }

      if (i % 20 === 0 || i === total - 1) {
        const progress = 5 + Math.floor((i / total) * 45);
        await updateJobProgress(
          job.id,
          progress,
          `Model previews: ${modelPreviews}/${i + 1} of ${total}...`,
        );
      }
    }
  }

  // Phase 2: Regenerate all folder previews
  await updateJobProgress(job.id, 50, "Regenerating folder previews...");

  const allFolders = await db.query.folders.findMany({
    columns: { id: true, slug: true },
  });

  let folderPreviews = 0;
  for (let i = 0; i < allFolders.length; i++) {
    try {
      const preview = await generateFolderPreview(allFolders[i].id);
      if (preview) folderPreviews++;
    } catch (err) {
      log.error(err instanceof Error ? err : new Error(String(err)), {
        step: "folder-preview",
        folder: allFolders[i].slug,
      });
    }

    if (i % 20 === 0 || i === allFolders.length - 1) {
      const progress = 50 + Math.floor((i / allFolders.length) * 48);
      await updateJobProgress(
        job.id,
        progress,
        `Folder previews: ${folderPreviews}/${i + 1} of ${allFolders.length}...`,
      );
    }
  }

  log.emit();

  return {
    modelPreviews,
    folderPreviews,
    totalFolders: allFolders.length,
  };
}

registerJobHandler("regenerate-previews", handleRegeneratePreviews);

export { handleRegeneratePreviews };
