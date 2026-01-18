import { Form, redirect, useLoaderData, useActionData, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/upload";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, files } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { join, basename } from "path";
import { writeFile } from "fs/promises";
import { Header } from "~/components/Header";
import {
  saveFile,
  getMimeType,
  detectKind,
  processImage,
  isImageKind,
  TEMP_DIR,
  ensureDir,
} from "~/lib/files.server";
import { createJob } from "~/lib/jobs.server";
import { parseArchive, getFileEntries, getDirectoryPaths } from "~/lib/archives.server";

// Ensure job handler is registered
import "~/lib/extract-job.server";

// Archive extensions we support
const ARCHIVE_EXTENSIONS = ["pak", "pk3", "zip"];

function isArchive(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? ARCHIVE_EXTENSIONS.includes(ext) : false;
}

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get folder from query param if provided
  const url = new URL(request.url);
  const folderSlug = url.searchParams.get("folder");

  // Get all folders for dropdown
  const allFolders = await db.query.folders.findMany({
    orderBy: [folders.slug],
  });

  // Find the pre-selected folder if provided
  let selectedFolder = null;
  if (folderSlug) {
    selectedFolder = allFolders.find((f) => f.slug === folderSlug) || null;
  }

  return { user, folders: allFolders, selectedFolder };
}

interface ActionResult {
  error?: string;
  // Single file upload success
  fileSuccess?: {
    fileId: string;
    filePath: string;
    fileName: string;
  };
  // Archive analysis result
  archiveAnalysis?: {
    tempFile: string;
    originalName: string;
    archiveType: string;
    totalFiles: number;
    totalDirs: number;
    suggestedName: string;
    suggestedSlug: string;
    sampleFiles: string[];
  };
  // Archive extraction job created
  jobCreated?: {
    jobId: string;
    folderSlug: string;
  };
}

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return { error: "Not authenticated" };
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

  // Handle single file upload
  return handleFileUpload(formData, user.id);
}

async function handleFileUpload(formData: FormData, userId: string): Promise<ActionResult> {
  const file = formData.get("file") as File | null;
  const folderId = formData.get("folderId") as string | null;

  if (!file || file.size === 0) {
    return { error: "No file selected" };
  }

  // Check if this is an archive - redirect to analysis flow
  if (isArchive(file.name)) {
    return handleAnalyzeArchive(formData);
  }

  if (!folderId) {
    return { error: "Please select a folder" };
  }

  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    return { error: "Folder not found" };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const { path: filePath, name: savedName } = await saveFile(
      buffer,
      folder.slug,
      file.name,
      true
    );

    const kind = detectKind(savedName);
    const mimeType = await getMimeType(savedName, buffer);

    let width: number | null = null;
    let height: number | null = null;
    let hasPreview = false;

    if (isImageKind(kind)) {
      const imageInfo = await processImage(filePath);
      width = imageInfo.width;
      height = imageInfo.height;
      hasPreview = imageInfo.hasPreview;
    }

    const fileId = nanoid();
    await db.insert(files).values({
      id: fileId,
      path: filePath,
      name: savedName,
      mimeType,
      size: buffer.length,
      kind,
      width,
      height,
      hasPreview,
      folderId: folder.id,
      uploaderId: userId,
      source: "upload",
    });

    return {
      fileSuccess: {
        fileId,
        filePath,
        fileName: savedName,
      },
    };
  } catch (err) {
    console.error("Upload error:", err);
    return { error: `Upload failed: ${err}` };
  }
}

async function handleAnalyzeArchive(formData: FormData): Promise<ActionResult> {
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return { error: "No file uploaded" };
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !ARCHIVE_EXTENSIONS.includes(ext)) {
    return { error: "Unsupported archive type. Supported: PAK, PK3, ZIP" };
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

    return {
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
    };
  } catch (err) {
    return { error: `Failed to analyze archive: ${err}` };
  }
}

async function handleExtractArchive(formData: FormData, userId: string): Promise<ActionResult> {
  const tempFile = formData.get("tempFile") as string;
  const originalName = formData.get("originalName") as string;
  const folderName = formData.get("folderName") as string;
  const folderSlug = formData.get("folderSlug") as string;

  if (!tempFile || !originalName || !folderName || !folderSlug) {
    return { error: "Missing required fields" };
  }

  if (tempFile.includes("/") || tempFile.includes("\\") || tempFile.includes("..")) {
    return { error: "Invalid file reference" };
  }

  const cleanSlug = folderSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!cleanSlug) {
    return { error: "Invalid folder slug" };
  }

  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, cleanSlug),
  });

  if (existing) {
    return { error: `Folder "${cleanSlug}" already exists` };
  }

  const tempPath = join(TEMP_DIR, tempFile);

  const job = await createJob({
    type: "extract-archive",
    input: {
      tempFile: tempPath,
      originalName,
      targetFolderSlug: cleanSlug,
      targetFolderName: folderName,
      userId,
    },
    userId,
  });

  return {
    jobCreated: {
      jobId: job.id,
      folderSlug: cleanSlug,
    },
  };
}

export function meta() {
  return [{ title: "Upload - artbin" }];
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ArchiveExtractForm({
  tempFile,
  originalName,
  suggestedName,
}: {
  tempFile: string;
  originalName: string;
  suggestedName: string;
}) {
  const [folderName, setFolderName] = useState(suggestedName);
  const [customSlug, setCustomSlug] = useState(false);
  const [slug, setSlug] = useState(slugify(suggestedName));

  // Auto-update slug when folder name changes (unless custom slug is enabled)
  useEffect(() => {
    if (!customSlug) {
      setSlug(slugify(folderName));
    }
  }, [folderName, customSlug]);

  return (
    <Form method="post">
      <input type="hidden" name="_action" value="extract" />
      <input type="hidden" name="tempFile" value={tempFile} />
      <input type="hidden" name="originalName" value={originalName} />

      <div className="card">
        <p className="form-help" style={{ marginBottom: "1rem" }}>
          This archive will be extracted into a new folder. All files will be
          preserved with their original directory structure.
        </p>

        <div className="form-group">
          <label className="form-label">Folder Name</label>
          <input
            type="text"
            name="folderName"
            className="input"
            style={{ width: "100%" }}
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            Folder Slug (URL path)
            {!customSlug && (
              <span style={{ fontWeight: 400, color: "#666" }}> — auto-generated</span>
            )}
          </label>
          <input
            type="text"
            name="folderSlug"
            className="input"
            style={{ width: "100%", background: customSlug ? undefined : "#f5f5f5" }}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="[a-z0-9-]+"
            readOnly={!customSlug}
            required
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", fontSize: "0.875rem" }}>
            <input
              type="checkbox"
              checked={customSlug}
              onChange={(e) => setCustomSlug(e.target.checked)}
            />
            Customize slug
          </label>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" className="btn btn-primary">
            Extract Archive
          </button>
          <a href="/upload" className="btn">Cancel</a>
        </div>
      </div>
    </Form>
  );
}

export default function Upload() {
  const { user, folders, selectedFolder } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();

  // Check if we're in archive analysis mode
  const isAnalyzingArchive = !!actionData?.archiveAnalysis;
  const jobCreated = !!actionData?.jobCreated;

  return (
    <div>
      <Header user={user} />
      <main className="main-content" style={{ maxWidth: "600px" }}>
        <h1 className="page-title">Upload</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {/* Single file upload success */}
        {actionData?.fileSuccess && (
          <div className="alert alert-success">
            <p><strong>File uploaded!</strong></p>
            <p>{actionData.fileSuccess.fileName}</p>
            <p>
              <a href={`/file/${actionData.fileSuccess.filePath}`}>View file</a>
            </p>
          </div>
        )}

        {/* Archive extraction job created */}
        {actionData?.jobCreated && (
          <div className="alert alert-success">
            <p><strong>Extraction started!</strong></p>
            <p>Your archive is being extracted in the background.</p>
            <p>
              <a href="/admin/jobs">View progress</a> |{" "}
              <a href={`/folder/${actionData.jobCreated.folderSlug}`}>
                Go to folder (when complete)
              </a>
            </p>
          </div>
        )}

        {/* Archive Analysis Result - show extraction form */}
        {isAnalyzingArchive && !jobCreated && (
          <div>
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>
                Archive Detected
              </h3>
              <dl className="detail-info">
                <dt>File</dt>
                <dd>{actionData.archiveAnalysis!.originalName}</dd>
                <dt>Type</dt>
                <dd style={{ textTransform: "uppercase" }}>
                  {actionData.archiveAnalysis!.archiveType}
                </dd>
                <dt>Files</dt>
                <dd>{actionData.archiveAnalysis!.totalFiles.toLocaleString()}</dd>
                <dt>Directories</dt>
                <dd>{actionData.archiveAnalysis!.totalDirs.toLocaleString()}</dd>
              </dl>

              <details style={{ marginTop: "1rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>
                  Sample files (first 20)
                </summary>
                <div
                  style={{
                    maxHeight: "200px",
                    overflow: "auto",
                    marginTop: "0.5rem",
                    fontSize: "0.75rem",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {actionData.archiveAnalysis!.sampleFiles.map((name, i) => (
                    <div
                      key={i}
                      style={{ padding: "0.25rem", borderBottom: "1px solid #eee" }}
                    >
                      {name}
                    </div>
                  ))}
                  {actionData.archiveAnalysis!.totalFiles > 20 && (
                    <div style={{ padding: "0.25rem", color: "#999" }}>
                      ... and {actionData.archiveAnalysis!.totalFiles - 20} more
                    </div>
                  )}
                </div>
              </details>
            </div>

<ArchiveExtractForm
              tempFile={actionData.archiveAnalysis!.tempFile}
              originalName={actionData.archiveAnalysis!.originalName}
              suggestedName={actionData.archiveAnalysis!.suggestedName}
            />
          </div>
        )}

        {/* Default upload form */}
        {!isAnalyzingArchive && !jobCreated && !actionData?.fileSuccess && (
          <Form method="post" encType="multipart/form-data">
            <div className="card">
              <div className="form-group">
                <label className="form-label">File or Archive</label>
                <input
                  type="file"
                  name="file"
                  className="input"
                  style={{ width: "100%" }}
                  required
                />
                <p className="form-help">
                  Upload any file, or a PAK/PK3/ZIP archive to extract all contents
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Folder</label>
                <select
                  name="folderId"
                  className="input"
                  style={{ width: "100%" }}
                  defaultValue={selectedFolder?.id || ""}
                >
                  <option value="">Select a folder (or upload an archive to create one)</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.slug}
                    </option>
                  ))}
                </select>
                <p className="form-help">
                  Required for single files. Archives create their own folder.
                </p>
              </div>

              <button type="submit" className="btn btn-primary">
                Upload
              </button>
            </div>
          </Form>
        )}

        {/* Show another upload link after success */}
        {(actionData?.fileSuccess || jobCreated) && (
          <p style={{ marginTop: "1rem" }}>
            <a href="/upload">Upload another file</a>
          </p>
        )}
      </main>
    </div>
  );
}
