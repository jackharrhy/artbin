import { Form, redirect, useLoaderData, useActionData, useRevalidator } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/admin.import";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, files, folders, jobs } from "~/db";
import { count, eq, desc } from "drizzle-orm";
import { Header } from "~/components/Header";
import { createJob } from "~/lib/jobs.server";

// Local copy of FoundArchive type to avoid importing from server module
interface FoundArchive {
  path: string;
  name: string;
  size: number;
  type: string;
  gameDir: string | null;
}

// Import sources configuration
const IMPORT_SOURCES = [
  {
    id: "texturetown",
    name: "TextureTown",
    description: "textures.neocities.org - 3800+ retro game textures",
    url: "https://textures.neocities.org/",
  },
  {
    id: "texture-station",
    name: "Texture Station",
    description: "thejang.com/textures - 392 classic tiling backgrounds from 1996",
    url: "https://thejang.com/textures/",
  },
  {
    id: "sadgrl",
    name: "Sadgrl Tiled Backgrounds",
    description: "sadgrl.online archive - 500+ tiled backgrounds organized by color",
    url: "https://sadgrlonline.github.io/archived-sadgrl.online/webmastery/downloads/tiledbgs.html",
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

  // Texture Station import
  if (intent === "texture-station") {
    const job = await createJob({
      type: "texture-station-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "texture-station" };
  }

  // Sadgrl import
  if (intent === "sadgrl") {
    const job = await createJob({
      type: "sadgrl-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "sadgrl" };
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

    </div>
  );
}

const ARCHIVES_PER_PAGE = 50;

export default function AdminImport() {
  const { user, sources, stats, scanResults, scanJobStatus, scanJobProgress, scanJobMessage } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const [showAllArchives, setShowAllArchives] = useState(false);

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
  
  // Limit displayed archives unless "show all" is clicked
  const displayedArchives = scanResults && !showAllArchives && scanResults.length > ARCHIVES_PER_PAGE
    ? scanResults.slice(0, ARCHIVES_PER_PAGE)
    : scanResults;

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

        {actionData?.success && actionData.action === "texture-station" && (
          <div className="alert alert-success">
            <p><strong>Texture Station import started!</strong></p>
            <p><a href="/admin/jobs">View job progress</a></p>
          </div>
        )}

        {actionData?.success && actionData.action === "sadgrl" && (
          <div className="alert alert-success">
            <p><strong>Sadgrl Tiled Backgrounds import started!</strong></p>
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
                {!showAllArchives && scanResults.length > ARCHIVES_PER_PAGE && (
                  <span> Showing first {ARCHIVES_PER_PAGE}.</span>
                )}
              </div>
              {displayedArchives?.map((archive, i) => (
                <ArchiveImportForm key={`${archive.path}-${i}`} archive={archive} />
              ))}
              {!showAllArchives && scanResults.length > ARCHIVES_PER_PAGE && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: "0.5rem" }}
                  onClick={() => setShowAllArchives(true)}
                >
                  Show All {scanResults.length} Archives
                </button>
              )}
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
