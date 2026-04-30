import type { Route } from "./+types/api.cli.upload";
import { useLogger } from "evlog/react-router";
import { requireCliAuth } from "~/lib/cli-auth.server";
import { db } from "~/db/connection.server";
import { folders } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { basename, dirname } from "path";
import { detectKind } from "@artbin/core/detection/kind";
import { getMimeType } from "@artbin/core/detection/mime";
import { isBSPFile } from "@artbin/core/parsers/bsp";
import { saveFile, insertFileRecord, getFilePath, computeSha256 } from "~/lib/files.server";
import { createJob } from "~/lib/jobs.server";
import { createUploadSession } from "~/lib/inbox.server";

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
  const log = useLogger();
  const user = await requireCliAuth(request);

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

  log.set({
    cliUpload: {
      userId: user.id,
      isAdmin: user.isAdmin,
      parentFolder: metadata.parentFolder,
      batchSize: metadata.files.length,
    },
  });

  if (user.isAdmin) {
    return handleAdminUpload(formData, metadata, user.id);
  }

  return handleNonAdminUpload(formData, metadata, user.id);
}

async function handleAdminUpload(formData: FormData, metadata: UploadMetadata, userId: string) {
  const log = useLogger();
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
        const msg = `Folder not found: ${folderSlug}`;
        errors.push({ path: fileMeta.path, error: msg });
        log.error(new Error(msg), { step: "folder-lookup", file: fileMeta.path, folderSlug });
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

      // Skip image processing during CLI uploads for speed.
      // Previews and dimensions are generated lazily or via backfill.
      const sha256 = computeSha256(buffer);
      const fileId = nanoid();
      const inserted = await insertFileRecord({
        id: fileId,
        path: savedPath,
        name: savedName,
        mimeType,
        size: buffer.length,
        kind,
        width: null,
        height: null,
        hasPreview: false,
        folderId: folder.id,
        uploaderId: userId,
        source: "cli-upload",
        sourceArchive: fileMeta.sourceArchive ?? null,
        sha256,
      });

      if (inserted.isErr()) {
        errors.push({ path: fileMeta.path, error: inserted.error.message });
        log.error(inserted.error, { step: "insert-record", file: fileMeta.path });
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
            userId: userId,
          },
          userId: userId,
        });
      }

      uploaded.push(fileMeta.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ path: fileMeta.path, error: msg });
      log.error(err instanceof Error ? err : new Error(msg), {
        step: "admin-upload-file",
        file: fileMeta.path,
      });
    }
  }

  log.set({
    cliUpload: {
      uploadedCount: uploaded.length,
      errorsCount: errors.length,
      sampleErrors: errors.slice(0, 5).map((e) => `${e.path}: ${e.error}`),
    },
  });
  return Response.json({ uploaded, errors });
}

async function handleNonAdminUpload(formData: FormData, metadata: UploadMetadata, userId: string) {
  const log = useLogger();
  const session = await createUploadSession(userId);
  const uploaded: string[] = [];
  const errors: { path: string; error: string }[] = [];

  // Look up the parent folder to use as suggestedFolderId
  const parentFolder = await db.query.folders.findFirst({
    where: eq(folders.slug, metadata.parentFolder),
  });
  const suggestedFolderId = parentFolder?.id ?? null;

  for (let i = 0; i < metadata.files.length; i++) {
    const fileMeta = metadata.files[i];
    const fileField = formData.get(`file_${i}`) as File | null;

    if (!fileField) {
      errors.push({ path: fileMeta.path, error: "Missing file data" });
      continue;
    }

    try {
      const buffer = Buffer.from(await fileField.arrayBuffer());
      const fileName = basename(fileMeta.path);

      // Save the file to the inbox session folder
      const { path: savedPath, name: savedName } = await saveFile(
        buffer,
        session.slug,
        fileName,
        true,
      );

      // Detect kind and mime type server-side
      const kind = detectKind(savedName);
      const mimeType = await getMimeType(savedName, buffer);

      // Skip image processing during CLI uploads for speed.
      const sha256 = computeSha256(buffer);
      const fileId = nanoid();
      const inserted = await insertFileRecord({
        id: fileId,
        path: savedPath,
        name: savedName,
        mimeType,
        size: buffer.length,
        kind,
        width: null,
        height: null,
        hasPreview: false,
        folderId: session.id,
        uploaderId: userId,
        source: "cli-upload",
        sourceArchive: fileMeta.sourceArchive ?? null,
        sha256,
        status: "pending",
        suggestedFolderId,
      });

      if (inserted.isErr()) {
        errors.push({ path: fileMeta.path, error: inserted.error.message });
        log.error(inserted.error, { step: "insert-record", file: fileMeta.path });
        continue;
      }

      uploaded.push(fileMeta.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ path: fileMeta.path, error: msg });
      log.error(err instanceof Error ? err : new Error(msg), {
        step: "non-admin-upload-file",
        file: fileMeta.path,
      });
    }
  }

  log.set({
    cliUpload: {
      uploadedCount: uploaded.length,
      errorsCount: errors.length,
      sampleErrors: errors.slice(0, 5).map((e) => `${e.path}: ${e.error}`),
    },
  });
  return Response.json({
    pendingUpload: true,
    uploadSessionId: session.id,
    uploaded,
    errors,
  });
}
