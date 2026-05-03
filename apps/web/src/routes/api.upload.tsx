import type { Route } from "./+types/api.upload";
import { useLogger } from "evlog/react-router";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db } from "~/db/connection.server";
import { folders } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { join, basename } from "path";
import { writeFile } from "fs/promises";
import { ingestFile, TEMP_DIR, ensureDir, finalizeFolders } from "~/lib/files.server";
import { createJob } from "~/lib/jobs.server";
import { parseArchive, getFileEntries, getDirectoryPaths } from "~/lib/archives.server";
import { createUploadSession } from "~/lib/inbox.server";

const ARCHIVE_EXTENSIONS = new Set(["pak", "pk3", "zip"]);

function isArchive(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? ARCHIVE_EXTENSIONS.has(ext) : false;
}

export async function action({ request }: Route.ActionArgs) {
  const log = useLogger();
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;
  log.set({ upload: { action: actionType, userId: user.id, isAdmin: user.isAdmin } });

  // Archive analysis and extraction are admin-only
  if (actionType === "analyze") {
    if (!user.isAdmin) {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }
    return handleAnalyzeArchive(formData);
  }

  if (actionType === "extract") {
    if (!user.isAdmin) {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }
    return handleExtractArchive(formData, user.id);
  }

  // Handle single/multi file upload
  return handleFileUpload(formData, user.id, !!user.isAdmin);
}

async function handleFileUpload(formData: FormData, userId: string, isAdmin: boolean) {
  const file = formData.get("file") as File | null;
  const folderId = formData.get("folderId") as string | null;
  const relativePath = formData.get("relativePath") as string | null;

  if (!file || file.size === 0) {
    return Response.json({ error: "No file selected" });
  }

  // Archives are admin-only (redirect to analysis flow)
  if (isArchive(file.name)) {
    if (!isAdmin) {
      return Response.json({ error: "Admin access required for archive uploads" }, { status: 403 });
    }
    return handleAnalyzeArchive(formData);
  }

  if (isAdmin) {
    return handleAdminUpload(file, folderId, relativePath, userId);
  }

  const uploadSessionId = formData.get("uploadSessionId") as string | null;
  return handleNonAdminUpload(file, folderId, relativePath, userId, uploadSessionId);
}

async function handleAdminUpload(
  file: File,
  folderId: string | null,
  relativePath: string | null,
  userId: string,
) {
  const log = useLogger();
  log.set({ upload: { fileName: file.name, fileSize: file.size, folderId } });

  if (!folderId) {
    return Response.json({ error: "Please select a folder" });
  }

  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    return Response.json({ error: "Folder not found" });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    // If relativePath contains subdirectories, we need to handle nested uploads
    // e.g., "textures/walls/brick.png" should create subfolders
    let targetFolderSlug = folder.slug;
    let targetFolderId = folder.id;

    if (relativePath && relativePath.includes("/")) {
      const pathParts = relativePath.split("/");
      const fileName = pathParts.pop()!; // Remove filename

      // Create nested folders if needed
      for (const part of pathParts) {
        if (!part) continue;

        const nestedSlug = `${targetFolderSlug}/${part.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

        let nestedFolder = await db.query.folders.findFirst({
          where: eq(folders.slug, nestedSlug),
        });

        if (!nestedFolder) {
          const nestedId = nanoid();
          await db.insert(folders).values({
            id: nestedId,
            name: part,
            slug: nestedSlug,
            parentId: targetFolderId,
            ownerId: userId,
          });
          targetFolderSlug = nestedSlug;
          targetFolderId = nestedId;
        } else {
          targetFolderSlug = nestedSlug;
          targetFolderId = nestedFolder.id;
        }
      }
    }

    const ingested = await ingestFile({
      buffer,
      fileName: relativePath ? basename(relativePath) : file.name,
      folderSlug: targetFolderSlug,
      folderId: targetFolderId,
      source: "upload",
      uploaderId: userId,
    });
    if (ingested.isErr()) throw ingested.error;

    // Update folder preview after each upload
    await finalizeFolders([targetFolderId]);

    return Response.json({
      fileSuccess: {
        fileId: ingested.value.fileId,
        filePath: ingested.value.path,
        fileName: ingested.value.name,
      },
    });
  } catch (err) {
    log.error(err instanceof Error ? err : String(err), { step: "admin-upload" });
    return Response.json({ error: `Upload failed: ${err}` });
  }
}

async function handleNonAdminUpload(
  file: File,
  folderId: string | null,
  relativePath: string | null,
  userId: string,
  existingSessionId?: string | null,
) {
  const log = useLogger();
  log.set({ upload: { fileName: file.name, fileSize: file.size, folderId } });

  try {
    let session: { id: string; slug: string };

    if (existingSessionId) {
      // Reuse existing upload session (batch upload)
      const existing = await db.query.folders.findFirst({
        where: eq(folders.id, existingSessionId),
      });
      if (!existing) {
        return Response.json({ error: "Upload session not found" }, { status: 400 });
      }
      session = { id: existing.id, slug: existing.slug };
    } else {
      session = await createUploadSession(userId);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Preserve folder structure from relativePath within the session folder
    // e.g. "metals/rusty/panel.bmp" creates subfolders _inbox/<session>/metals/rusty/
    let targetFolderSlug = session.slug;
    let targetFolderId = session.id;

    if (relativePath && relativePath.includes("/")) {
      const pathParts = relativePath.split("/");
      pathParts.pop(); // Remove filename

      for (const part of pathParts) {
        if (!part) continue;

        const nestedSlug = `${targetFolderSlug}/${part.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

        let nestedFolder = await db.query.folders.findFirst({
          where: eq(folders.slug, nestedSlug),
        });

        if (!nestedFolder) {
          const nestedId = nanoid();
          await db.insert(folders).values({
            id: nestedId,
            name: part,
            slug: nestedSlug,
            parentId: targetFolderId,
            ownerId: userId,
          });
          targetFolderSlug = nestedSlug;
          targetFolderId = nestedId;
        } else {
          targetFolderSlug = nestedSlug;
          targetFolderId = nestedFolder.id;
        }
      }
    }

    const ingested = await ingestFile({
      buffer,
      fileName: relativePath ? basename(relativePath) : file.name,
      folderSlug: targetFolderSlug,
      folderId: targetFolderId,
      source: "upload",
      uploaderId: userId,
      status: "pending",
      suggestedFolderId: folderId || null,
    });
    if (ingested.isErr()) throw ingested.error;

    return Response.json({
      pendingUpload: true,
      uploadSessionId: session.id,
      message: "Uploaded! An admin will review your submission.",
    });
  } catch (err) {
    log.error(err instanceof Error ? err : String(err), { step: "non-admin-upload" });
    return Response.json({ error: `Upload failed: ${err}` });
  }
}

async function handleAnalyzeArchive(formData: FormData) {
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return Response.json({ error: "No file uploaded" });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !ARCHIVE_EXTENSIONS.has(ext)) {
    return Response.json({ error: "Unsupported archive type. Supported: PAK, PK3, ZIP" });
  }

  try {
    await ensureDir(TEMP_DIR);
    const tempFilename = `${nanoid()}_${file.name}`;
    const tempPath = join(TEMP_DIR, tempFilename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempPath, buffer);

    const archive = await parseArchive(tempPath);
    const fileEntries = getFileEntries(archive.entries);
    const dirPaths = getDirectoryPaths(archive.entries);

    const baseName = basename(file.name, "." + ext);
    const suggestedName = baseName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const suggestedSlug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const sampleFiles = fileEntries.slice(0, 20).map((e) => e.name);

    return Response.json({
      archiveAnalysis: {
        tempFile: tempFilename,
        originalName: file.name,
        archiveType: archive.type,
        totalFiles: fileEntries.length,
        totalDirs: dirPaths.length,
        suggestedName,
        suggestedSlug,
        sampleFiles,
      },
    });
  } catch (err) {
    const log = useLogger();
    log.error(err instanceof Error ? err : new Error(String(err)), { step: "analyze-archive" });
    return Response.json({ error: `Failed to analyze archive: ${err}` });
  }
}

async function handleExtractArchive(formData: FormData, userId: string) {
  const tempFile = formData.get("tempFile") as string;
  const originalName = formData.get("originalName") as string;
  const folderName = formData.get("folderName") as string;
  const folderSlug = formData.get("folderSlug") as string;
  const parentFolderId = formData.get("parentFolderId") as string | null;

  if (!tempFile || !originalName || !folderName || !folderSlug) {
    return Response.json({ error: "Missing required fields" });
  }

  if (tempFile.includes("/") || tempFile.includes("\\") || tempFile.includes("..")) {
    return Response.json({ error: "Invalid file reference" });
  }

  // Build the full slug path if there's a parent folder
  let fullSlug = folderSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (parentFolderId) {
    const parentFolder = await db.query.folders.findFirst({
      where: eq(folders.id, parentFolderId),
    });
    if (parentFolder) {
      fullSlug = `${parentFolder.slug}/${fullSlug}`;
    }
  }

  if (!fullSlug) {
    return Response.json({ error: "Invalid folder slug" });
  }

  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, fullSlug),
  });

  if (existing) {
    return Response.json({ error: `Folder "${fullSlug}" already exists` });
  }

  const tempPath = join(TEMP_DIR, tempFile);

  const job = await createJob({
    type: "extract-archive",
    input: {
      tempFile: tempPath,
      originalName,
      targetFolderSlug: fullSlug,
      targetFolderName: folderName,
      parentFolderId: parentFolderId || null,
      userId,
    },
    userId,
  });

  return Response.json({
    jobCreated: {
      jobId: job.id,
      folderSlug: fullSlug,
    },
  });
}
