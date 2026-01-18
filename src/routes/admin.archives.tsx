import { Form, redirect, useLoaderData, useActionData, useRevalidator } from "react-router";
import { useEffect } from "react";
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

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  archives: FoundArchive[];
}

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/folders");
  }

  // Get most recent scan job
  const recentScanJob = await db.query.jobs.findFirst({
    where: eq(jobs.type, "scan-archives"),
    orderBy: [desc(jobs.createdAt)],
  });

  let archives: FoundArchive[] = [];
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
        archives = output.archives || [];
      } catch {
        // Ignore parse errors
      }
    }
  }

  return {
    user,
    archives,
    totalArchives: archives.length,
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

    return { success: true, jobId: job.id, action: "import-archive", archiveName: archivePath.split("/").pop() };
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

/**
 * Build a tree structure from archive paths
 */
function buildTree(archives: FoundArchive[]): TreeNode {
  const root: TreeNode = {
    name: "/",
    path: "/",
    children: new Map(),
    archives: [],
  };

  for (const archive of archives) {
    // Split path into parts, excluding the filename
    const parts = archive.path.split("/").filter(Boolean);
    parts.pop(); // Remove filename

    let current = root;
    let currentPath = "";

    for (const part of parts) {
      currentPath += "/" + part;
      
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: currentPath,
          children: new Map(),
          archives: [],
        });
      }
      current = current.children.get(part)!;
    }

    current.archives.push(archive);
  }

  return root;
}

/**
 * Count total archives in a tree node (including children)
 */
function countArchives(node: TreeNode): number {
  let count = node.archives.length;
  for (const child of node.children.values()) {
    count += countArchives(child);
  }
  return count;
}

/**
 * Recursively render tree nodes, collapsing paths with single children
 */
function TreeNodeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const archiveCount = countArchives(node);
  
  if (archiveCount === 0) return null;

  // Collect path segments that have only one child and no archives
  let displayNode = node;
  let displayPath = node.name;
  
  while (
    displayNode.children.size === 1 &&
    displayNode.archives.length === 0
  ) {
    const onlyChild = Array.from(displayNode.children.values())[0];
    displayPath += "/" + onlyChild.name;
    displayNode = onlyChild;
  }

  const hasChildren = displayNode.children.size > 0;
  const hasArchives = displayNode.archives.length > 0;

  // Sort children by name
  const sortedChildren = Array.from(displayNode.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Sort archives by name
  const sortedArchives = [...displayNode.archives].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <details className="tree-folder" open>
      <summary className="tree-folder-header">
        <span className="tree-folder-icon">{hasChildren || hasArchives ? "📁" : "📂"}</span>
        <span className="tree-folder-name">{displayPath}</span>
        <span className="tree-folder-count">{archiveCount} archive{archiveCount !== 1 ? "s" : ""}</span>
      </summary>
      
      <div className="tree-folder-content">
        {/* Child folders */}
        {sortedChildren.map((child) => (
          <TreeNodeView key={child.path} node={child} depth={depth + 1} />
        ))}

        {/* Archives in this folder */}
        {sortedArchives.map((archive) => (
          <ArchiveItem key={archive.path} archive={archive} />
        ))}
      </div>
    </details>
  );
}

function ArchiveItem({ archive }: { archive: FoundArchive }) {
  const defaultName = archive.gameDir
    ? `${archive.gameDir} - ${archive.name.replace(/\.[^.]+$/, "")}`
    : archive.name.replace(/\.[^.]+$/, "");

  return (
    <details className="tree-archive">
      <summary className="tree-archive-header">
        <span className="tree-archive-icon">
          {archive.type === "pak" && "📦"}
          {archive.type === "pk3" && "📦"}
          {archive.type === "wad" && "🎮"}
          {archive.type === "zip" && "🗜️"}
        </span>
        <span className="tree-archive-name">{archive.name}</span>
        <span className="tree-archive-meta">
          <span className="archive-type">{archive.type.toUpperCase()}</span>
          <span className="archive-size">{formatSize(archive.size)}</span>
          {archive.gameDir && <span className="archive-gamedir">{archive.gameDir}</span>}
        </span>
      </summary>

      <div className="tree-archive-details">
        <Form method="post" className="archive-form">
          <input type="hidden" name="intent" value="import-archive" />
          <input type="hidden" name="archivePath" value={archive.path} />

          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
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

            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Slug</label>
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

            <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-end" }}>
              Import
            </button>
          </div>
        </Form>
      </div>
    </details>
  );
}

export default function AdminArchives() {
  const { user, archives, totalArchives, scanJobStatus, scanJobProgress, scanJobMessage } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();

  const isScanning = scanJobStatus === "running" || scanJobStatus === "pending";

  // Auto-refresh while scanning
  useEffect(() => {
    if (isScanning) {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [isScanning, revalidator]);

  // Build tree from archives
  const tree = buildTree(archives);

  // Get top-level nodes (skip the root "/" node)
  const topLevelNodes = Array.from(tree.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <div>
      <Header user={user} />
      <main className="main-content" style={{ maxWidth: "1000px" }}>
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

        {/* Alerts */}
        {actionData?.error && (
          <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
            {actionData.error}
          </div>
        )}

        {actionData?.success && actionData.action === "import-archive" && (
          <div className="alert alert-success" style={{ marginBottom: "1rem" }}>
            <strong>Import started!</strong> {actionData.archiveName} is being extracted.{" "}
            <a href="/admin/jobs">View progress</a>
          </div>
        )}

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
        {totalArchives > 0 ? (
          <div className="archive-tree">
            <div style={{ marginBottom: "1rem", color: "#666", fontSize: "0.875rem" }}>
              Found {totalArchives} archive{totalArchives !== 1 ? "s" : ""}. Click folders to expand/collapse, click archives to import.
            </div>

            {topLevelNodes.map((node) => (
              <TreeNodeView key={node.path} node={node} />
            ))}
          </div>
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
