import type { Route } from "./+types/api.cli.upload";
import { requireCliAdmin } from "~/lib/cli-auth.server";
import { db } from "~/db/connection.server";
import { folders } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { basename, dirname } from "path";
import { detectKind } from "@artbin/core/detection/kind";
import { getMimeType } from "@artbin/core/detection/mime";
import { isBSPFile } from "@artbin/core/parsers/bsp";
import {
  saveFile,
  processImage,
  insertFileRecord,
  isImageKind,
  getFilePath,
} from "~/lib/files.server";
import { createJob } from "~/lib/jobs.server";

interface FileMetadata {
  path: string;
  kind: string;
  mimeType: string;
  sha256: string;
  sourceArchive?: string;
}

interface UploadMetadata {
  parentFolder: string;
  files: FileMetadata[];
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCliAdmin(request);

  const formData = await request.formData();
  const metadataRaw = formData.get("metadata") as string;
  if (!metadataRaw) {
    return Response.json({ error: "Missing metadata field" }, { status: 400 });
  }

  let metadata: UploadMetadata;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    return Response.json({ error: "Invalid metadata JSON" }, { status: 400 });
  }

  const uploaded: string[] = [];
  const errors: { path: string; error: string }[] = [];

  for (let i = 0; i < metadata.files.length; i++) {
    const fileMeta = metadata.files[i];
    const fileField = formData.get(`file_${i}`) as File | null;

    if (!fileField) {
      errors.push({ path: fileMeta.path, error: "Missing file data" });
      continue;
    }

    try {
      const buffer = Buffer.from(await fileField.arrayBuffer());

      // Determine the folder slug from parentFolder + file's directory path
      const fileDir = dirname(fileMeta.path);
      const folderSlug =
        fileDir === "." ? metadata.parentFolder : `${metadata.parentFolder}/${fileDir}`;

      // Look up the folder
      const folder = await db.query.folders.findFirst({
        where: eq(folders.slug, folderSlug),
      });

      if (!folder) {
        errors.push({ path: fileMeta.path, error: `Folder not found: ${folderSlug}` });
        continue;
      }

      const fileName = basename(fileMeta.path);

      // Save the file to disk
      const { path: savedPath, name: savedName } = await saveFile(
        buffer,
        folderSlug,
        fileName,
        true,
      );

      // Detect kind and mime type server-side
      const kind = detectKind(savedName);
      const mimeType = await getMimeType(savedName, buffer);

      let width: number | null = null;
      let height: number | null = null;
      let hasPreview = false;

      // Process image if applicable
      if (isImageKind(kind)) {
        const imageInfo = await processImage(savedPath);
        if (imageInfo.isOk()) {
          width = imageInfo.value.width;
          height = imageInfo.value.height;
          hasPreview = imageInfo.value.hasPreview;
        }
      }

      // Insert file record with sha256
      const fileId = nanoid();
      const inserted = await insertFileRecord({
        id: fileId,
        path: savedPath,
        name: savedName,
        mimeType,
        size: buffer.length,
        kind,
        width,
        height,
        hasPreview,
        folderId: folder.id,
        uploaderId: user.id,
        source: "cli-upload",
        sourceArchive: fileMeta.sourceArchive ?? null,
        sha256: fileMeta.sha256,
      });

      if (inserted.isErr()) {
        errors.push({ path: fileMeta.path, error: inserted.error.message });
        continue;
      }

      // If BSP file, queue an extract-bsp job
      if (kind === "map" && savedName.toLowerCase().endsWith(".bsp") && isBSPFile(buffer)) {
        const bspBaseName = savedName.replace(/\.bsp$/i, "");
        await createJob({
          type: "extract-bsp",
          input: {
            bspPath: getFilePath(savedPath),
            targetFolderSlug: `${folderSlug}/${bspBaseName}-textures`,
            targetFolderName: `${bspBaseName} Textures`,
            userId: user.id,
          },
          userId: user.id,
        });
      }

      uploaded.push(fileMeta.path);
    } catch (err) {
      errors.push({
        path: fileMeta.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return Response.json({ uploaded, errors });
}
