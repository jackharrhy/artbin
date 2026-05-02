import type { Route } from "./+types/api.cli.upload";
import { useLogger } from "evlog/react-router";
import { requireCliAuth } from "~/lib/cli-auth.server";
import { db } from "~/db/connection.server";
import { folders } from "~/db";
import { eq } from "drizzle-orm";
import { basename, dirname } from "path";
import { cleanFolderSlug, cleanFolderPath } from "@artbin/core/detection/filenames";
import { isBSPFile } from "@artbin/core/parsers/bsp";
import { ingestFile, getFilePath } from "~/lib/files.server";
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
      // Clean each segment to match how folders were created
      const fileDir = dirname(fileMeta.path);
      const rawSlug =
        fileDir === "." ? metadata.parentFolder : `${metadata.parentFolder}/${fileDir}`;
      const folderSlug = cleanFolderPath(rawSlug);

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

      const ingested = await ingestFile({
        buffer,
        fileName,
        folderSlug,
        folderId: folder.id,
        source: "cli-upload",
        uploaderId: userId,
        sourceArchive: fileMeta.sourceArchive ?? null,
        processImages: false,
      });

      if (ingested.isErr()) {
        errors.push({ path: fileMeta.path, error: ingested.error.message });
        log.error(ingested.error, { step: "ingest-file", file: fileMeta.path });
        continue;
      }

      // If BSP file, queue an extract-bsp job
      if (
        ingested.value.kind === "map" &&
        ingested.value.name.toLowerCase().endsWith(".bsp") &&
        isBSPFile(buffer)
      ) {
        const bspBaseName = ingested.value.name.replace(/\.bsp$/i, "");
        const bspSlug = cleanFolderSlug(bspBaseName);
        await createJob({
          type: "extract-bsp",
          input: {
            bspPath: getFilePath(ingested.value.path),
            targetFolderSlug: `${folderSlug}/${bspSlug}-textures`,
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
    where: eq(folders.slug, cleanFolderPath(metadata.parentFolder)),
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

      const ingested = await ingestFile({
        buffer,
        fileName,
        folderSlug: session.slug,
        folderId: session.id,
        source: "cli-upload",
        uploaderId: userId,
        sourceArchive: fileMeta.sourceArchive ?? null,
        processImages: false,
        status: "pending",
        suggestedFolderId,
      });

      if (ingested.isErr()) {
        errors.push({ path: fileMeta.path, error: ingested.error.message });
        log.error(ingested.error, { step: "ingest-file", file: fileMeta.path });
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
