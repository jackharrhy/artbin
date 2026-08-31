/**
 * Regenerate folder and file previews job handler.
 *
 * Regenerates preview images for all folders, and optionally
 * generates missing model previews for GLB/GLTF files.
 */

import { db } from "#db/connection.server";
import { files, folders, type Job } from "#db";
import { eq, and, isNull } from "drizzle-orm";
import { readFile, unlink } from "fs/promises";
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
import { generateBspDerivatives } from "../bsp-overview-renderer.server.ts";
import {
  getBspWalkabilityPath,
  refreshBspDependencyManifest,
  writeDerivedFile,
} from "../bsp-derivatives.server.ts";
import { resolveApprovedBspPalette, resolveApprovedBspWad } from "../bsp-assets.server.ts";

async function handleRegeneratePreviews(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });

  const includeModels = input.includeModels !== false;
  const includeMaps = input.includeMaps !== false;

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
        const progress = 5 + Math.floor((i / total) * 30);
        await updateJobProgress(
          job.id,
          progress,
          `Model previews: ${modelPreviews}/${i + 1} of ${total}...`,
        );
      }
    }
  }

  // Phase 2: Regenerate BSP overviews. WAD resolution can change independently of the BSP file,
  // so the explicit maintenance job intentionally refreshes existing map previews too.
  let mapPreviews = 0;
  if (includeMaps) {
    await updateJobProgress(job.id, 35, "Finding BSP maps...");
    const maps = await db.query.files.findMany({
      where: and(eq(files.kind, "map"), eq(files.status, "approved")),
    });

    for (let index = 0; index < maps.length; index += 1) {
      const file = maps[index];
      if (!file.name.toLowerCase().endsWith(".bsp")) continue;
      const fullPath = getFilePath(file.path);
      if (!existsSync(fullPath)) continue;

      try {
        const palette = await resolveApprovedBspPalette(file);
        const rendered = await generateBspDerivatives({
          appOrigin:
            process.env.ARTBIN_INTERNAL_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`,
          sources: {
            bspPath: fullPath,
            ...(palette ? { palettePath: getFilePath(palette.path) } : {}),
            resolveWadPath: async (name) => {
              const wad = await resolveApprovedBspWad(file, name);
              return wad ? getFilePath(wad.path) : null;
            },
          },
        });
        const previewPath = getPreviewPath(file.path);
        await writeDerivedFile(previewPath, rendered.png);
        const walkabilityPath = getBspWalkabilityPath(file.path);
        if (rendered.walkabilityJson) {
          await writeDerivedFile(walkabilityPath, rendered.walkabilityJson);
        } else {
          await unlink(walkabilityPath).catch(() => {});
        }
        await readFile(fullPath)
          .then((bytes) => refreshBspDependencyManifest(file.path, bytes))
          .catch(() => {});
        await db.update(files).set({ hasPreview: true }).where(eq(files.id, file.id));
        mapPreviews += 1;
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)), {
          step: "bsp-overview",
          file: file.path,
        });
      }

      const progress = 35 + Math.floor(((index + 1) / maps.length) * 40);
      await updateJobProgress(
        job.id,
        progress,
        `BSP previews: ${mapPreviews}/${index + 1} of ${maps.length}...`,
      );
    }
  }

  // Phase 3: Regenerate all folder previews
  await updateJobProgress(job.id, 75, "Regenerating folder previews...");

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
      const progress = 75 + Math.floor((i / allFolders.length) * 23);
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
    mapPreviews,
    folderPreviews,
    totalFolders: allFolders.length,
  };
}

registerJobHandler("regenerate-previews", handleRegeneratePreviews);

export { handleRegeneratePreviews };
