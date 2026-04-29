import { Form, redirect, useLoaderData, useActionData, useRevalidator } from "react-router";
import { useState, useEffect, useMemo } from "react";
import type { Route } from "./+types/admin.archives";
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { jobs } from "~/db";
import { eq, desc } from "drizzle-orm";
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

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);

  if (!user.isAdmin) {
    throw redirect("/folders");
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

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext);

  if (!user.isAdmin) {
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
    const archiveType = formData.get("archiveType") as string;

    if (!archivePath || !folderName || !folderSlug) {
      return { error: "Missing required fields" };
    }

    // Handle BSP files differently - extract textures instead of unpacking
    if (archiveType === "bsp") {
      const job = await createJob({
        type: "extract-bsp",
        input: {
          bspPath: archivePath,
          targetFolderSlug: folderSlug,
          targetFolderName: folderName,
          userId: user.id,
        },
        userId: user.id,
      });

      return {
        success: true,
        jobId: job.id,
        action: "import-bsp",
        archiveName: archivePath.split("/").pop(),
      };
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

    return {
      success: true,
      jobId: job.id,
      action: "import-archive",
      archiveName: archivePath.split("/").pop(),
    };
  }

  if (intent === "batch-import") {
    const folderName = formData.get("folderName") as string;
    const folderSlug = formData.get("folderSlug") as string;
    const archivePathsJson = formData.get("archivePaths") as string;

    if (!folderName || !folderSlug || !archivePathsJson) {
      return { error: "Missing required fields" };
    }

    let archivePaths: string[];
    try {
      archivePaths = JSON.parse(archivePathsJson);
    } catch {
      return { error: "Invalid archive paths" };
    }

    if (archivePaths.length === 0) {
      return { error: "No archives selected" };
    }

    // Separate BSP files from regular archives
    const bspPaths = archivePaths.filter((p) => p.toLowerCase().endsWith(".bsp"));
    const regularArchivePaths = archivePaths.filter((p) => !p.toLowerCase().endsWith(".bsp"));

    const results: { jobId: string; action: string; count: number }[] = [];

    // Create job for regular archives if any
    if (regularArchivePaths.length > 0) {
      const archiveJob = await createJob({
        type: "batch-extract-archive",
        input: {
          parentFolderSlug: folderSlug,
          parentFolderName: folderName,
          archives: regularArchivePaths.map((path) => ({
            path,
            subfolderSlug: slugify(
              path
                .split("/")
                .pop()
                ?.replace(/\.[^.]+$/, "") || "archive",
            ),
          })),
          userId: user.id,
        },
        userId: user.id,
      });
      results.push({
        jobId: archiveJob.id,
        action: "batch-archive",
        count: regularArchivePaths.length,
      });
    }

    // Create job for BSP files if any
    if (bspPaths.length > 0) {
      const bspJob = await createJob({
        type: "batch-extract-bsp",
        input: {
          parentFolderSlug: folderSlug,
          parentFolderName: folderName,
          bspFiles: bspPaths.map((path) => ({
            path,
            subfolderSlug: slugify(
              path
                .split("/")
                .pop()
                ?.replace(/\.[^.]+$/, "") || "bsp",
            ),
          })),
          userId: user.id,
        },
        userId: user.id,
      });
      results.push({ jobId: bspJob.id, action: "batch-bsp", count: bspPaths.length });
    }

    return {
      success: true,
      jobIds: results.map((r) => r.jobId),
      action: "batch-import",
      count: archivePaths.length,
      bspCount: bspPaths.length,
      archiveCount: regularArchivePaths.length,
      folderName,
    };
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

function countArchives(node: TreeNode): number {
  let count = node.archives.length;
  for (const child of node.children.values()) {
    count += countArchives(child);
  }
  return count;
}

function getAllArchivePaths(node: TreeNode): string[] {
  const paths: string[] = node.archives.map((a) => a.path);
  for (const child of node.children.values()) {
    paths.push(...getAllArchivePaths(child));
  }
  return paths;
}

function TreeNodeView({
  node,
  depth = 0,
  selectedPaths,
  onToggleArchive,
  onToggleFolder,
}: {
  node: TreeNode;
  depth?: number;
  selectedPaths: Set<string>;
  onToggleArchive: (path: string) => void;
  onToggleFolder: (paths: string[], selected: boolean) => void;
}) {
  const archiveCount = countArchives(node);

  if (archiveCount === 0) return null;

  // Collect path segments that have only one child and no archives
  let displayNode = node;
  let displayPath = node.name;

  while (displayNode.children.size === 1 && displayNode.archives.length === 0) {
    const onlyChild = Array.from(displayNode.children.values())[0];
    displayPath += "/" + onlyChild.name;
    displayNode = onlyChild;
  }

  const hasChildren = displayNode.children.size > 0;
  const hasArchives = displayNode.archives.length > 0;

  // Sort children by name
  const sortedChildren = Array.from(displayNode.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Sort archives by name
  const sortedArchives = [...displayNode.archives].sort((a, b) => a.name.localeCompare(b.name));

  // Calculate folder selection state
  const allPaths = getAllArchivePaths(displayNode);
  const selectedCount = allPaths.filter((p) => selectedPaths.has(p)).length;
  const isAllSelected = selectedCount === allPaths.length && allPaths.length > 0;
  const isPartiallySelected = selectedCount > 0 && selectedCount < allPaths.length;

  return (
    <div className="flex items-start gap-2">
      <input
        type="checkbox"
        className="w-4 h-4 m-0 cursor-pointer accent-text shrink-0"
        checked={isAllSelected}
        ref={(el) => {
          if (el) el.indeterminate = isPartiallySelected;
        }}
        onChange={() => onToggleFolder(allPaths, !isAllSelected)}
      />
      <details className="flex-1" open>
        <summary className="flex items-center gap-2 py-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="text-base">{hasChildren || hasArchives ? "📁" : "📂"}</span>
          <span className="flex-1 font-mono text-xs break-all">{displayPath}</span>
          <span className="text-[0.7rem] text-text-muted px-1.5 py-0.5 bg-bg-hover">
            {archiveCount} archive{archiveCount !== 1 ? "s" : ""}
          </span>
        </summary>

        <div className="ml-5 border-l border-border-light pl-3">
          {/* Child folders */}
          {sortedChildren.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPaths={selectedPaths}
              onToggleArchive={onToggleArchive}
              onToggleFolder={onToggleFolder}
            />
          ))}

          {/* Archives in this folder */}
          {sortedArchives.map((archive) => (
            <ArchiveItem
              key={archive.path}
              archive={archive}
              isSelected={selectedPaths.has(archive.path)}
              onToggle={() => onToggleArchive(archive.path)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function ArchiveItem({
  archive,
  isSelected,
  onToggle,
}: {
  archive: FoundArchive;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const defaultName = archive.gameDir
    ? `${archive.gameDir} - ${archive.name.replace(/\.[^.]+$/, "")}`
    : archive.name.replace(/\.[^.]+$/, "");

  return (
    <div className={`flex items-start gap-2 mb-1 ${isSelected ? "bg-[#f0f7ff]" : ""}`}>
      <input
        type="checkbox"
        className="w-4 h-4 m-0 cursor-pointer accent-text shrink-0"
        checked={isSelected}
        onChange={onToggle}
      />
      <details className="flex-1">
        <summary className="flex items-center gap-2 py-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="text-base">
            {archive.type === "pak" && "📦"}
            {archive.type === "pk3" && "📦"}
            {archive.type === "wad" && "🎮"}
            {archive.type === "zip" && "🗜️"}
            {archive.type === "bsp" && "🗺️"}
          </span>
          <span className="font-medium text-[0.8125rem]">{archive.name}</span>
          <span className="flex items-center gap-2 ml-auto">
            <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 bg-bg-subtle font-mono">
              {archive.type.toUpperCase()}
            </span>
            <span className="text-[0.7rem] text-text-muted">{formatSize(archive.size)}</span>
            {archive.gameDir && (
              <span className="text-[0.625rem] px-1.5 py-0.5 bg-[#d4edda]">{archive.gameDir}</span>
            )}
          </span>
        </summary>

        <div className="p-3 mt-1 bg-[#fafafa] border border-border-light">
          <Form method="post">
            <input type="hidden" name="intent" value="import-archive" />
            <input type="hidden" name="archivePath" value={archive.path} />
            <input type="hidden" name="archiveType" value={archive.type} />

            <div className="flex gap-3 items-end max-sm:flex-col max-sm:items-stretch">
              <div className="mb-4 flex-1">
                <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                  Folder Name
                </label>
                <input
                  type="text"
                  name="folderName"
                  className="input w-full"
                  defaultValue={defaultName}
                  required
                />
              </div>

              <div className="mb-4 flex-1">
                <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                  Slug
                </label>
                <input
                  type="text"
                  name="folderSlug"
                  className="input w-full"
                  defaultValue={slugify(defaultName)}
                  pattern="[a-z0-9-]+"
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary btn-sm self-end">
                Import
              </button>
            </div>
          </Form>
        </div>
      </details>
    </div>
  );
}

function BatchImportButton({
  selectedPaths,
  onClear,
}: {
  selectedPaths: Set<string>;
  onClear: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderSlug, setFolderSlug] = useState("");

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setFolderName(name);
    setFolderSlug(slugify(name));
  };

  if (selectedPaths.size === 0) return null;

  return (
    <>
      {/* Fixed button in bottom right */}
      <button
        type="button"
        className="fixed bottom-6 right-6 bg-text text-white border-none px-5 py-3 text-sm font-inherit cursor-pointer shadow-lg z-100 hover:bg-[#333]"
        onClick={() => setIsOpen(true)}
      >
        Import {selectedPaths.size} selected
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Batch Import</h2>
              <button type="button" className="modal-close" onClick={() => setIsOpen(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="mb-4 text-text-muted">
                Import <strong>{selectedPaths.size}</strong> archives as subfolders of a new parent
                folder. Each archive will become a subfolder named after its filename.
              </p>

              <Form method="post" onSubmit={() => setIsOpen(false)}>
                <input type="hidden" name="intent" value="batch-import" />
                <input
                  type="hidden"
                  name="archivePaths"
                  value={JSON.stringify([...selectedPaths])}
                />

                <div className="mb-4">
                  <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                    Parent Folder Name
                  </label>
                  <input
                    type="text"
                    name="folderName"
                    className="input w-full"
                    placeholder="e.g. Thirty Flights of Loving"
                    value={folderName}
                    onChange={handleNameChange}
                    required
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                    Slug
                  </label>
                  <input
                    type="text"
                    name="folderSlug"
                    className="input w-full"
                    placeholder="thirty-flights-of-loving"
                    value={folderSlug}
                    onChange={(e) => setFolderSlug(e.target.value)}
                    pattern="[a-z0-9-]+"
                    required
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn" onClick={onClear}>
                    Clear Selection
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!folderName || !folderSlug}
                  >
                    Import as Subfolders
                  </button>
                </div>
              </Form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function AdminArchives() {
  const { user, archives, totalArchives, scanJobStatus, scanJobProgress, scanJobMessage } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

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

  // Clear selection on successful batch import
  useEffect(() => {
    if (actionData?.success && actionData?.action === "batch-import") {
      setSelectedPaths(new Set());
    }
  }, [actionData]);

  // Build tree from archives
  const tree = useMemo(() => buildTree(archives), [archives]);

  // Get top-level nodes (skip the root "/" node)
  const topLevelNodes = useMemo(
    () => Array.from(tree.children.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [tree],
  );

  const handleToggleArchive = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleToggleFolder = (paths: string[], selected: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (selected) {
          next.add(path);
        } else {
          next.delete(path);
        }
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedPaths(new Set());
  };

  return (
    <>
      <main className="max-w-[1000px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
        <div className="text-xs text-text-muted mb-4">
          <a className="text-text-muted hover:text-text" href="/folders">
            Folders
          </a>
          <span className="mx-2">/</span>
          <a className="text-text-muted hover:text-text" href="/admin/jobs">
            Admin
          </a>
          <span className="mx-2">/</span>
          <a className="text-text-muted hover:text-text" href="/admin/import">
            Import
          </a>
          <span className="mx-2">/</span>
          <span>Local Archives</span>
        </div>

        <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">
          Local Archives
        </h1>
        <p className="mb-6 text-text-muted">
          Scan your computer for game archives (PAK, PK3, WAD, ZIP) and BSP maps to extract
          textures.
        </p>

        {/* Alerts */}
        {actionData?.error && <div className="alert alert-error mb-4">{actionData.error}</div>}

        {actionData?.success && actionData.action === "import-archive" && (
          <div className="alert alert-success mb-4">
            <strong>Import started!</strong> {actionData.archiveName} is being extracted.{" "}
            <a href="/admin/jobs">View progress</a>
          </div>
        )}

        {actionData?.success && actionData.action === "import-bsp" && (
          <div className="alert alert-success mb-4">
            <strong>BSP extraction started!</strong> Extracting textures from{" "}
            {actionData.archiveName}. <a href="/admin/jobs">View progress</a>
          </div>
        )}

        {actionData?.success && actionData.action === "batch-import" && (
          <div className="alert alert-success mb-4">
            <strong>Batch import started!</strong>{" "}
            {(actionData.archiveCount ?? 0) > 0 &&
              `${actionData.archiveCount} archive${actionData.archiveCount !== 1 ? "s" : ""}`}
            {(actionData.archiveCount ?? 0) > 0 && (actionData.bspCount ?? 0) > 0 && " and "}
            {(actionData.bspCount ?? 0) > 0 &&
              `${actionData.bspCount} BSP map${actionData.bspCount !== 1 ? "s" : ""}`}{" "}
            will be processed into "{actionData.folderName}".{" "}
            <a href="/admin/jobs">View progress</a>
          </div>
        )}

        {/* Scan Controls */}
        <div className="card mb-6">
          <div className="flex justify-between items-center gap-4">
            <div>
              <strong>Scan Home Directory</strong>
              <p className="text-sm text-text-muted m-0">
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
            <div className="mt-4">
              <div className="w-full h-1.5 bg-bg-subtle overflow-hidden">
                <div
                  className="h-full bg-[#4CAF50] transition-[width] duration-300"
                  style={{ width: `${scanJobProgress || 0}%` }}
                />
              </div>
              <p className="text-xs text-text-muted mt-2 mb-0">
                {scanJobMessage || "Starting scan..."}
              </p>
            </div>
          )}
        </div>

        {/* Results */}
        {totalArchives > 0 ? (
          <div className="text-sm">
            <div className="mb-4 text-text-muted text-sm">
              Found {totalArchives} archive{totalArchives !== 1 ? "s" : ""}. Use checkboxes to
              select multiple, or click archives to import individually.
            </div>

            {topLevelNodes.map((node) => (
              <TreeNodeView
                key={node.path}
                node={node}
                selectedPaths={selectedPaths}
                onToggleArchive={handleToggleArchive}
                onToggleFolder={handleToggleFolder}
              />
            ))}
          </div>
        ) : scanJobStatus === "completed" ? (
          <div className="text-center p-8 text-text-muted">
            No game archives found. Try running a scan.
          </div>
        ) : !scanJobStatus ? (
          <div className="text-center p-8 text-text-muted">
            No scan results yet. Click "Scan" to search for game archives.
          </div>
        ) : null}

        <p className="mt-8 text-sm text-text-muted">
          <a href="/admin/import">← Back to Import</a> | <a href="/admin/jobs">View Jobs</a>
        </p>
      </main>

      <BatchImportButton selectedPaths={selectedPaths} onClear={handleClearSelection} />
    </>
  );
}
