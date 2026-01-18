import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.extract";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders } from "~/db";
import { eq } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import { join, basename } from "path";
import { nanoid } from "nanoid";

import { createJob, getUserJobs } from "~/lib/jobs.server";
import { parseArchive, getFileEntries, getDirectoryPaths } from "~/lib/archives.server";
import { TEMP_DIR, ensureDir } from "~/lib/files.server";
import type { ExtractJobInput } from "~/lib/extract-job.server";

// Ensure the job handler is registered
import "~/lib/extract-job.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/");
  }

  // Get user's recent jobs
  const recentJobs = await getUserJobs(user.id, 10);

  return { user, recentJobs };
}

interface ActionResult {
  error?: string;
  analyzed?: {
    tempFile: string;
    originalName: string;
    archiveType: string;
    totalFiles: number;
    totalDirs: number;
    suggestedName: string;
    suggestedSlug: string;
    sampleFiles: string[];
  };
  jobCreated?: {
    jobId: string;
    folderSlug: string;
  };
}

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  if (actionType === "analyze") {
    return handleAnalyze(formData);
  } else if (actionType === "extract") {
    return handleExtract(formData, user.id);
  }

  return { error: "Unknown action" };
}

async function handleAnalyze(formData: FormData): Promise<ActionResult> {
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return { error: "No file uploaded" };
  }

  // Validate file extension
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["pak", "pk3", "zip"].includes(ext)) {
    return { error: "Unsupported file type. Supported: PAK, PK3, ZIP" };
  }

  try {
    // Save to temp directory
    await ensureDir(TEMP_DIR);
    const tempFilename = `${nanoid()}_${file.name}`;
    const tempPath = join(TEMP_DIR, tempFilename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempPath, buffer);

    // Parse archive
    const archive = await parseArchive(tempPath);
    const fileEntries = getFileEntries(archive.entries);
    const dirPaths = getDirectoryPaths(archive.entries);

    // Generate suggested name from filename
    const baseName = basename(file.name, "." + ext);
    const suggestedName = baseName
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const suggestedSlug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    // Get sample of files
    const sampleFiles = fileEntries
      .slice(0, 20)
      .map((e) => e.name);

    return {
      analyzed: {
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
    return { error: `Failed to analyze file: ${err}` };
  }
}

async function handleExtract(formData: FormData, userId: string): Promise<ActionResult> {
  const tempFile = formData.get("tempFile") as string;
  const originalName = formData.get("originalName") as string;
  const folderName = formData.get("folderName") as string;
  const folderSlug = formData.get("folderSlug") as string;

  if (!tempFile || !originalName || !folderName || !folderSlug) {
    return { error: "Missing required fields" };
  }

  // Validate tempFile is just a filename (security)
  if (tempFile.includes("/") || tempFile.includes("\\") || tempFile.includes("..")) {
    return { error: "Invalid file reference" };
  }

  // Validate slug format
  const cleanSlug = folderSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!cleanSlug) {
    return { error: "Invalid folder slug" };
  }

  // Check if folder slug already exists
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, cleanSlug),
  });

  if (existing) {
    return { error: `Folder "${cleanSlug}" already exists` };
  }

  const tempPath = join(TEMP_DIR, tempFile);

  // Create extraction job
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
  return [{ title: "Extract Archive - Admin - artbin" }];
}

export default function AdminExtract() {
  const { user, recentJobs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <header className="header">
        <a href="/" className="header-logo">
          artbin
        </a>
        <span className="badge-admin">admin</span>
      </header>

      <main className="main-content" style={{ maxWidth: "800px" }}>
        <h1 className="page-title">Extract Archive</h1>
        <p className="form-help" style={{ marginBottom: "1.5rem" }}>
          Extract all files from game archives (PAK, PK3, ZIP). Files will be stored
          preserving the archive's directory structure.
        </p>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {actionData?.jobCreated && (
          <div className="alert alert-success">
            <p>
              <strong>Extraction job started!</strong>
            </p>
            <p>
              Job ID: <code>{actionData.jobCreated.jobId}</code>
            </p>
            <p>
              <a href="/admin/jobs">View job progress</a> |{" "}
              <a href={`/folder/${actionData.jobCreated.folderSlug}`}>
                Go to folder (when complete)
              </a>
            </p>
          </div>
        )}

        {/* Upload Form - show when no analysis data */}
        {!actionData?.analyzed && !actionData?.jobCreated && (
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="_action" value="analyze" />

            <div className="card" style={{ marginBottom: "1.5rem" }}>
              <div className="form-group">
                <label className="form-label">Archive File</label>
                <input
                  type="file"
                  name="file"
                  accept=".pak,.pk3,.zip"
                  className="input"
                  style={{ width: "100%" }}
                  required
                />
                <p className="form-help">
                  Supported: PAK (Quake 1/2), PK3 (Quake 3), ZIP
                </p>
              </div>

              <button type="submit" className="btn btn-primary">
                Analyze Archive
              </button>
            </div>
          </Form>
        )}

        {/* Analysis Results & Extract Form */}
        {actionData?.analyzed && (
          <div>
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>
                Archive Analysis
              </h3>
              <dl className="detail-info">
                <dt>File</dt>
                <dd>{actionData.analyzed.originalName}</dd>
                <dt>Type</dt>
                <dd style={{ textTransform: "uppercase" }}>
                  {actionData.analyzed.archiveType}
                </dd>
                <dt>Files</dt>
                <dd>{actionData.analyzed.totalFiles.toLocaleString()}</dd>
                <dt>Directories</dt>
                <dd>{actionData.analyzed.totalDirs.toLocaleString()}</dd>
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
                  {actionData.analyzed.sampleFiles.map((name, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "0.25rem",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {name}
                    </div>
                  ))}
                  {actionData.analyzed.totalFiles > 20 && (
                    <div style={{ padding: "0.25rem", color: "#999" }}>
                      ... and {actionData.analyzed.totalFiles - 20} more files
                    </div>
                  )}
                </div>
              </details>
            </div>

            <Form method="post">
              <input type="hidden" name="_action" value="extract" />
              <input
                type="hidden"
                name="tempFile"
                value={actionData.analyzed.tempFile}
              />
              <input
                type="hidden"
                name="originalName"
                value={actionData.analyzed.originalName}
              />

              <div className="form-group">
                <label className="form-label">Folder Name</label>
                <input
                  type="text"
                  name="folderName"
                  className="input"
                  style={{ width: "100%" }}
                  defaultValue={actionData.analyzed.suggestedName}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Folder Slug (URL path)</label>
                <input
                  type="text"
                  name="folderSlug"
                  className="input"
                  style={{ width: "100%" }}
                  defaultValue={actionData.analyzed.suggestedSlug}
                  pattern="[a-z0-9-]+"
                  required
                />
                <p className="form-help">
                  Lowercase letters, numbers, and hyphens only
                </p>
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="submit" className="btn btn-primary">
                  Start Extraction
                </button>
                <a href="/admin/extract" className="btn">
                  Cancel
                </a>
              </div>
            </Form>
          </div>
        )}

        {/* Recent Jobs */}
        {recentJobs.length > 0 && (
          <div style={{ marginTop: "2rem" }}>
            <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>
              Recent Jobs
            </h3>
            <div className="card">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    padding: "0.5rem",
                    borderBottom: "1px solid #eee",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <code style={{ fontSize: "0.75rem" }}>{job.id}</code>
                    <br />
                    <span style={{ fontSize: "0.875rem" }}>{job.type}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span
                      style={{
                        padding: "0.125rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        background:
                          job.status === "completed"
                            ? "#d4edda"
                            : job.status === "failed"
                            ? "#f8d7da"
                            : job.status === "running"
                            ? "#fff3cd"
                            : "#e9ecef",
                      }}
                    >
                      {job.status}
                    </span>
                    {job.status === "running" && job.progress !== null && (
                      <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                        {job.progress}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div style={{ padding: "0.5rem", textAlign: "center" }}>
                <a href="/admin/jobs" style={{ fontSize: "0.875rem" }}>
                  View all jobs
                </a>
              </div>
            </div>
          </div>
        )}

        <p style={{ marginTop: "2rem", fontSize: "0.875rem" }}>
          <a href="/admin/jobs">All Jobs</a> |{" "}
          <a href="/folders">Folders</a> |{" "}
          <a href="/settings">Settings</a>
        </p>
      </main>
    </div>
  );
}
