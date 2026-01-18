import { Form, redirect, useLoaderData, useSearchParams, Link } from "react-router";
import type { Route } from "./+types/admin.archives";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, jobs } from "~/db";
import { eq, desc } from "drizzle-orm";
import { Header } from "~/components/Header";
import { createJob } from "~/lib/jobs.server";

interface FoundArchive {
  path: string;
  name: string;
  size: number;
  type: string;
  gameDir: string | null;
}

const PER_PAGE = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/folders");
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  // Get most recent scan job
  const recentScanJob = await db.query.jobs.findFirst({
    where: eq(jobs.type, "scan-archives"),
    orderBy: [desc(jobs.createdAt)],
  });

  let allArchives: FoundArchive[] = [];
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
        allArchives = output.archives || [];
      } catch {
        // Ignore parse errors
      }
    }
  }

  const totalArchives = allArchives.length;
  const totalPages = Math.ceil(totalArchives / PER_PAGE);
  const startIndex = (page - 1) * PER_PAGE;
  const archives = allArchives.slice(startIndex, startIndex + PER_PAGE);

  return {
    user,
    archives,
    pagination: {
      page,
      perPage: PER_PAGE,
      totalArchives,
      totalPages,
    },
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

  if (intent === "scan") {
    const job = await createJob({
      type: "scan-archives",
      input: {},
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "scan" };
  }

  if (intent === "import-archive") {
    const archivePath = formData.get("archivePath") as string;
    const folderName = formData.get("folderName") as string;
    const folderSlug = formData.get("folderSlug") as string;

    if (!archivePath || !folderName || !folderSlug) {
      return { error: "Missing required fields" };
    }

    const job = await createJob({
      type: "extract-archive",
      input: {
        tempFile: archivePath,
        originalName: archivePath.split("/").pop() || "archive",
        targetFolderSlug: folderSlug,
        targetFolderName: folderName,
        userId: user.id,
        skipTempCleanup: true,
      },
      userId: user.id,
    });

    return { success: true, jobId: job.id, action: "import-archive" };
  }

  return { error: "Unknown action" };
}

export function meta() {
  return [{ title: "Local Archives - Admin - artbin" }];
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

function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  
  // Always show first page
  pages.push(1);
  
  // Show ellipsis if needed
  if (page > 3) pages.push("...");
  
  // Show pages around current
  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
    if (!pages.includes(i)) pages.push(i);
  }
  
  // Show ellipsis if needed
  if (page < totalPages - 2) pages.push("...");
  
  // Always show last page
  if (totalPages > 1 && !pages.includes(totalPages)) pages.push(totalPages);

  return (
    <div className="pagination">
      {page > 1 && (
        <Link to={`?page=${page - 1}`} className="pagination-link">
          ← Prev
        </Link>
      )}
      
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="pagination-ellipsis">...</span>
        ) : (
          <Link
            key={p}
            to={`?page=${p}`}
            className={`pagination-link ${p === page ? "pagination-current" : ""}`}
          >
            {p}
          </Link>
        )
      )}
      
      {page < totalPages && (
        <Link to={`?page=${page + 1}`} className="pagination-link">
          Next →
        </Link>
      )}
    </div>
  );
}

export default function AdminArchives() {
  const { user, archives, pagination, scanJobStatus, scanJobProgress, scanJobMessage } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

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
          <a href="/admin/import">Import</a>
          <span className="breadcrumb-sep">/</span>
          <span>Local Archives</span>
        </div>

        <h1 className="page-title">Local Archives</h1>
        <p style={{ marginBottom: "1.5rem", color: "#666" }}>
          Scan your computer for game archives (PAK, PK3, WAD, ZIP) and import them.
        </p>

        {/* Scan Controls */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div>
              <strong>Scan Home Directory</strong>
              <p style={{ fontSize: "0.875rem", color: "#666", margin: 0 }}>
                Find PAK, PK3, WAD, and ZIP files in game directories
              </p>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="scan" />
              <button type="submit" className="btn btn-primary" disabled={isScanning}>
                {isScanning ? "Scanning..." : "Scan"}
              </button>
            </Form>
          </div>

          {isScanning && (
            <div style={{ marginTop: "1rem" }}>
              <div style={{ width: "100%", height: "6px", background: "#eee", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ width: `${scanJobProgress || 0}%`, height: "100%", background: "#4CAF50", transition: "width 0.3s" }} />
              </div>
              <p style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.5rem", marginBottom: 0 }}>
                {scanJobMessage || "Starting scan..."}
              </p>
            </div>
          )}
        </div>

        {/* Results */}
        {pagination.totalArchives > 0 ? (
          <>
            <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#666" }}>
                Showing {(pagination.page - 1) * pagination.perPage + 1}–{Math.min(pagination.page * pagination.perPage, pagination.totalArchives)} of {pagination.totalArchives} archives
              </span>
              <Pagination page={pagination.page} totalPages={pagination.totalPages} />
            </div>

            {archives.map((archive, i) => (
              <ArchiveRow key={`${archive.path}-${i}`} archive={archive} />
            ))}

            <div style={{ marginTop: "1rem" }}>
              <Pagination page={pagination.page} totalPages={pagination.totalPages} />
            </div>
          </>
        ) : scanJobStatus === "completed" ? (
          <div className="empty-state" style={{ padding: "2rem" }}>
            No game archives found. Try running a scan.
          </div>
        ) : !scanJobStatus ? (
          <div className="empty-state" style={{ padding: "2rem" }}>
            No scan results yet. Click "Scan" to search for game archives.
          </div>
        ) : null}

        <p style={{ marginTop: "2rem", fontSize: "0.875rem", color: "#666" }}>
          <a href="/admin/import">← Back to Import</a> |{" "}
          <a href="/admin/jobs">View Jobs</a>
        </p>
      </main>
    </div>
  );
}

function ArchiveRow({ archive }: { archive: FoundArchive }) {
  const defaultName = archive.gameDir
    ? `${archive.gameDir} - ${archive.name.replace(/\.[^.]+$/, "")}`
    : archive.name.replace(/\.[^.]+$/, "");

  return (
    <details className="archive-item">
      <summary className="archive-header">
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
      </summary>

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
              defaultValue={defaultName}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Folder Slug</label>
            <input
              type="text"
              name="folderSlug"
              className="input"
              style={{ width: "100%" }}
              defaultValue={slugify(defaultName)}
              pattern="[a-z0-9-]+"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-sm">
            Import Archive
          </button>
        </Form>
      </div>
    </details>
  );
}
