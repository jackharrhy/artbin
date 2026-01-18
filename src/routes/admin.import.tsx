import { Form, redirect, useLoaderData, useActionData, useRevalidator } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/admin.import";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, files, folders, jobs } from "~/db";
import { count, like, eq, desc } from "drizzle-orm";
import { Header } from "~/components/Header";
import { createJob, getJob } from "~/lib/jobs.server";
import type { FoundArchive } from "~/lib/scan-archives-job.server";

// Register job handlers
import "~/lib/texturetown-job.server";
import "~/lib/scan-archives-job.server";

// Import sources configuration
const IMPORT_SOURCES = [
  {
    id: "texturetown",
    name: "TextureTown",
    description: "textures.neocities.org - 3800+ retro game textures",
    url: "https://textures.neocities.org/",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/folders");
  }

  // Get current counts
  const [{ total: fileCount }] = await db.select({ total: count() }).from(files);
  const [{ total: folderCount }] = await db.select({ total: count() }).from(folders);

  // Check how many TextureTown files we already have
  const [{ total: textureTownCount }] = await db
    .select({ total: count() })
    .from(files)
    .where(like(files.source, "texturetown%"));

  // Check for most recent scan job
  const recentScanJob = await db.query.jobs.findFirst({
    where: eq(jobs.type, "scan-archives"),
    orderBy: [desc(jobs.createdAt)],
  });

  // Parse scan results if available
  let scanResults: FoundArchive[] | null = null;
  let scanJobStatus: string | null = null;
  let scanJobProgress: number | null = null;
  let scanJobMessage: string | null = null;

  if (recentScanJob) {
    scanJobStatus = recentScanJob.status;
    scanJobProgress = recentScanJob.progress;
    scanJobMessage = recentScanJob.progressMessage;

    if (recentScanJob.status === "completed" && recentScanJob.output) {
      try {
        const output = JSON.parse(recentScanJob.output);
        scanResults = output.archives || [];
      } catch {
        // Ignore parse errors
      }
    }
  }

  return {
    user,
    sources: IMPORT_SOURCES,
    stats: {
      fileCount,
      folderCount,
      textureTownCount,
    },
    scanResults,
    scanJobStatus,
    scanJobProgress,
    scanJobMessage,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // TextureTown import
  if (intent === "texturetown") {
    const job = await createJob({
      type: "texturetown-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "texturetown" };
  }

  // Start local archive scan
  if (intent === "scan") {
    const job = await createJob({
      type: "scan-archives",
      input: {},
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "scan" };
  }

  // Import a local archive
  if (intent === "import-archive") {
    const archivePath = formData.get("archivePath") as string;
    const folderName = formData.get("folderName") as string;
    const folderSlug = formData.get("folderSlug") as string;

    if (!archivePath || !folderName || !folderSlug) {
      return { error: "Missing required fields" };
    }

    // Create extraction job using the local file path
    const job = await createJob({
      type: "extract-archive",
      input: {
        tempFile: archivePath,  // Use actual path instead of temp file
        originalName: archivePath.split("/").pop() || "archive",
        targetFolderSlug: folderSlug,
        targetFolderName: folderName,
        userId: user.id,
        skipTempCleanup: true,  // Don't delete the source file
      },
      userId: user.id,
    });

    return { success: true, jobId: job.id, action: "import-archive" };
  }

  return { error: "Unknown action" };
}

export function meta() {
  return [{ title: "Import - Admin - artbin" }];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ArchiveImportForm({ archive }: { archive: FoundArchive }) {
  const [folderName, setFolderName] = useState(
    archive.gameDir 
      ? `${archive.gameDir} - ${archive.name.replace(/\.[^.]+$/, "")}`
      : archive.name.replace(/\.[^.]+$/, "")
  );
  const [customSlug, setCustomSlug] = useState(false);
  const [slug, setSlug] = useState(slugify(folderName));
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!customSlug) {
      setSlug(slugify(folderName));
    }
  }, [folderName, customSlug]);

  const handleToggle = () => {
    setExpanded((prev) => !prev);
  };

  return (
    <div className="archive-item">
      <button 
        type="button"
        className="archive-header"
        onClick={handleToggle}
      >
        <div className="archive-info">
          <div className="archive-info-top">
            <span className="archive-type">{archive.type.toUpperCase()}</span>
            <span className="archive-name">{archive.name}</span>
            <span className="archive-size">{formatSize(archive.size)}</span>
            {archive.gameDir && (
              <span className="archive-gamedir">{archive.gameDir}</span>
            )}
          </div>
          <div className="archive-path-preview">{archive.path}</div>
        </div>
        <span className="archive-expand">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <div className="archive-details">
          <Form method="post" className="archive-form">
            <input type="hidden" name="intent" value="import-archive" />
            <input type="hidden" name="archivePath" value={archive.path} />
            
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
                Folder Slug
                {!customSlug && <span style={{ fontWeight: 400, color: "#666" }}> — auto</span>}
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
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", fontSize: "0.75rem" }}>
                <input
                  type="checkbox"
                  checked={customSlug}
                  onChange={(e) => setCustomSlug(e.target.checked)}
                />
                Customize slug
              </label>
            </div>

            <button type="submit" className="btn btn-primary btn-sm">
              Import Archive
            </button>
          </Form>
        </div>
      )}

      <style>{`
        .archive-item {
          border: 1px solid var(--color-border-light);
          margin-bottom: 0.5rem;
          background: #fff;
        }

        .archive-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 0.5rem 0.75rem;
          width: 100%;
          border: none;
          background: #fff;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
        }

        .archive-header:hover {
          background: var(--color-bg-hover);
        }

        .archive-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          flex: 1;
          min-width: 0;
        }

        .archive-info-top {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .archive-path-preview {
          font-size: 0.7rem;
          font-family: var(--font-mono);
          color: var(--color-text-muted);
          word-break: break-all;
          line-height: 1.3;
        }

        .archive-type {
          font-size: 0.625rem;
          font-weight: 600;
          padding: 0.125rem 0.375rem;
          background: #eee;
          border-radius: 2px;
          font-family: var(--font-mono);
        }

        .archive-name {
          font-weight: 500;
        }

        .archive-size {
          font-size: 0.75rem;
          color: var(--color-text-muted);
        }

        .archive-gamedir {
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          background: #d4edda;
          border-radius: 2px;
        }

        .archive-expand {
          font-size: 1.25rem;
          color: var(--color-text-muted);
          width: 1.5rem;
          text-align: center;
          flex-shrink: 0;
          padding-top: 0.125rem;
        }

        .archive-details {
          padding: 0.75rem;
          border-top: 1px solid var(--color-border-light);
          background: #fafafa;
        }

        .archive-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .archive-form .form-group {
          margin-bottom: 0;
        }
      `}</style>
    </div>
  );
}

export default function AdminImport() {
  const { user, sources, stats, scanResults, scanJobStatus, scanJobProgress, scanJobMessage } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();

  // Auto-refresh while scan is running
  useEffect(() => {
    if (scanJobStatus === "running" || scanJobStatus === "pending") {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [scanJobStatus, revalidator]);

  const isScanning = scanJobStatus === "running" || scanJobStatus === "pending";

  return (
    <div>
      <Header user={user} />
      <main className="main-content" style={{ maxWidth: "900px" }}>
        <div className="breadcrumb">
          <a href="/folders">Folders</a>
          <span className="breadcrumb-sep">/</span>
          <a href="/admin/jobs">Admin</a>
          <span className="breadcrumb-sep">/</span>
          <span>Import</span>
        </div>

        <h1 className="page-title">Import</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {actionData?.success && actionData.action === "texturetown" && (
          <div className="alert alert-success">
            <p><strong>TextureTown import started!</strong></p>
            <p><a href="/admin/jobs">View job progress</a></p>
          </div>
        )}

        {actionData?.success && actionData.action === "import-archive" && (
          <div className="alert alert-success">
            <p><strong>Archive extraction started!</strong></p>
            <p><a href="/admin/jobs">View job progress</a></p>
          </div>
        )}

        {/* Stats */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>Current Stats</h2>
          <dl className="detail-info">
            <dt>Total Files</dt>
            <dd>{stats.fileCount.toLocaleString()}</dd>
            <dt>Total Folders</dt>
            <dd>{stats.folderCount.toLocaleString()}</dd>
            <dt>TextureTown Imports</dt>
            <dd>{stats.textureTownCount.toLocaleString()}</dd>
          </dl>
        </div>

        {/* Local Archives Scanner */}
        <section className="section">
          <h2 className="section-title">Local Archives</h2>
          
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
              <div>
                <h3 style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
                  Scan Home Directory
                </h3>
                <p style={{ fontSize: "0.875rem", color: "#666", margin: 0 }}>
                  Find PAK, PK3, WAD, and ZIP files in game directories on this computer
                </p>
              </div>

              <Form method="post">
                <input type="hidden" name="intent" value="scan" />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isScanning}
                >
                  {isScanning ? "Scanning..." : "Scan"}
                </button>
              </Form>
            </div>

            {isScanning && (
              <div style={{ marginTop: "1rem" }}>
                <div style={{ 
                  width: "100%", 
                  height: "6px", 
                  background: "#eee", 
                  borderRadius: "3px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${scanJobProgress || 0}%`,
                    height: "100%",
                    background: "#4CAF50",
                    transition: "width 0.3s",
                  }} />
                </div>
                <p style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.5rem", marginBottom: 0 }}>
                  {scanJobMessage || "Starting scan..."}
                </p>
              </div>
            )}
          </div>

          {/* Scan Results */}
          {scanResults && scanResults.length > 0 && (
            <div>
              <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.75rem" }}>
                Found {scanResults.length} archive(s). Click to expand and import.
              </div>
              {scanResults.map((archive, i) => (
                <ArchiveImportForm key={`${archive.path}-${i}`} archive={archive} />
              ))}
            </div>
          )}

          {scanResults && scanResults.length === 0 && (
            <div className="empty-state" style={{ padding: "2rem" }}>
              No game archives found
            </div>
          )}
        </section>

        {/* Online Sources */}
        <section className="section">
          <h2 className="section-title">Online Sources</h2>

          {sources.map((source) => (
            <div key={source.id} className="card" style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                <div>
                  <h3 style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.name}
                    </a>
                  </h3>
                  <p style={{ fontSize: "0.875rem", color: "#666", margin: 0 }}>
                    {source.description}
                  </p>
                </div>

                <Form method="post">
                  <input type="hidden" name="intent" value={source.id} />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    onClick={(e) => {
                      if (!confirm(`Start importing from ${source.name}? This may take a while.`)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Import All
                  </button>
                </Form>
              </div>

              {source.id === "texturetown" && stats.textureTownCount > 0 && (
                <p style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.75rem", marginBottom: 0 }}>
                  Already imported {stats.textureTownCount.toLocaleString()} textures from TextureTown.
                  Running import again will skip existing files.
                </p>
              )}
            </div>
          ))}
        </section>

        <p style={{ marginTop: "2rem", fontSize: "0.875rem", color: "#666" }}>
          <a href="/admin/jobs">View Jobs</a> |{" "}
          <a href="/folders">Browse Folders</a>
        </p>
      </main>
    </div>
  );
}
