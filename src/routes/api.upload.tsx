import type { Route } from "./+types/api.upload";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { join, basename, dirname } from "path";
import { writeFile } from "fs/promises";
import {
  saveFile,
  getMimeType,
  detectKind,
  processImage,
  isImageKind,
  TEMP_DIR,
  ensureDir,
  insertFileRecord,
} from "~/lib/files.server";
import { createJob } from "~/lib/jobs.server";
import { parseArchive, getFileEntries, getDirectoryPaths } from "~/lib/archives.server";

const ARCHIVE_EXTENSIONS = ["pak", "pk3", "zip"];

function isArchive(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? ARCHIVE_EXTENSIONS.includes(ext) : false;
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // Handle archive analysis
  if (actionType === "analyze") {
    return handleAnalyzeArchive(formData);
  }

  // Handle archive extraction
  if (actionType === "extract") {
    return handleExtractArchive(formData, user.id);
  }

  // Handle single/multi file upload
  return handleFileUpload(formData, user.id);
}

async function handleFileUpload(formData: FormData, userId: string) {
  const file = formData.get("file") as File | null;
  const folderId = formData.get("folderId") as string | null;
  const relativePath = formData.get("relativePath") as string | null;

  if (!file || file.size === 0) {
    return Response.json({ error: "No file selected" });
  }

  // Check if this is an archive - redirect to analysis flow
  if (isArchive(file.name)) {
    return handleAnalyzeArchive(formData);
  }

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

    const { path: filePath, name: savedName } = await saveFile(
      buffer,
      targetFolderSlug,
      relativePath ? basename(relativePath) : file.name,
      true
    );

    const kind = detectKind(savedName);
    const mimeType = await getMimeType(savedName, buffer);

    let width: number | null = null;
    let height: number | null = null;
    let hasPreview = false;

    if (isImageKind(kind)) {
      const imageInfo = await processImage(filePath);
      if (imageInfo.isErr()) throw imageInfo.error;
      width = imageInfo.value.width;
      height = imageInfo.value.height;
      hasPreview = imageInfo.value.hasPreview;
    }

    const fileId = nanoid();
    const inserted = await insertFileRecord({
      id: fileId,
      path: filePath,
      name: savedName,
      mimeType,
      size: buffer.length,
      kind,
      width,
      height,
      hasPreview,
      folderId: targetFolderId,
      uploaderId: userId,
      source: "upload",
    });
    if (inserted.isErr()) throw inserted.error;

    return Response.json({
      fileSuccess: {
        fileId,
        filePath,
        fileName: savedName,
      },
    });
  } catch (err) {
    console.error("Upload error:", err);
    return Response.json({ error: `Upload failed: ${err}` });
  }
}

async function handleAnalyzeArchive(formData: FormData) {
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return Response.json({ error: "No file uploaded" });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !ARCHIVE_EXTENSIONS.includes(ext)) {
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
    const suggestedName = baseName
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
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
