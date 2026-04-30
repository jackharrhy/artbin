import { Form, useLoaderData, useActionData, useRevalidator } from "react-router";
import { useState, useEffect, useMemo } from "react";
import type { Route } from "./+types/admin.archives";
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { jobs } from "~/db";
import { eq, desc } from "drizzle-orm";
import { createJob } from "~/lib/jobs.server";

import { buildTree, ScanTreeView, ArchiveItem, BatchControls } from "@artbin/ui";
import type { FoundArchive } from "@artbin/ui/types";

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);

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

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ImportArchiveForm({ archive }: { archive: FoundArchive }) {
  const defaultName = archive.gameDir
    ? `${archive.gameDir} - ${archive.name.replace(/\.[^.]+$/, "")}`
    : archive.name.replace(/\.[^.]+$/, "");

  return (
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
  );
}

function BatchImportForm({
  selectedPaths,
  onClear,
  close,
}: {
  selectedPaths: Set<string>;
  onClear: () => void;
  close: () => void;
}) {
  const [folderName, setFolderName] = useState("");
  const [folderSlug, setFolderSlug] = useState("");

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setFolderName(name);
    setFolderSlug(slugify(name));
  };

  return (
    <Form method="post" onSubmit={() => close()}>
      <input type="hidden" name="intent" value="batch-import" />
      <input type="hidden" name="archivePaths" value={JSON.stringify([...selectedPaths])} />

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
        <button type="submit" className="btn btn-primary" disabled={!folderName || !folderSlug}>
          Import as Subfolders
        </button>
      </div>
    </Form>
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
      <div>
        <p className="mb-6 text-text-muted">
          Scan your computer for game archives (PAK, PK3, WAD, ZIP) and BSP maps to extract
          textures.
        </p>

        {/* Alerts */}
        {actionData?.error && <div className="alert alert-error mb-4">{actionData.error}</div>}

        {actionData?.success && actionData.action === "import-archive" && (
          <div className="alert alert-success mb-4">
            <strong>Import started!</strong> {actionData.archiveName} is being extracted.{" "}
            <a href="/admin">View progress</a>
          </div>
        )}

        {actionData?.success && actionData.action === "import-bsp" && (
          <div className="alert alert-success mb-4">
            <strong>BSP extraction started!</strong> Extracting textures from{" "}
            {actionData.archiveName}. <a href="/admin">View progress</a>
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
            will be processed into "{actionData.folderName}". <a href="/admin">View progress</a>
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
              <ScanTreeView
                key={node.path}
                node={node}
                selectedPaths={selectedPaths}
                onToggleFolder={handleToggleFolder}
                renderArchive={(archive, isSelected) => (
                  <ArchiveItem
                    key={archive.path}
                    archive={archive}
                    isSelected={isSelected}
                    onToggle={() => handleToggleArchive(archive.path)}
                  >
                    <ImportArchiveForm archive={archive} />
                  </ArchiveItem>
                )}
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
      </div>

      <BatchControls selectedCount={selectedPaths.size} onClear={handleClearSelection}>
        {({ close }) => (
          <BatchImportForm
            selectedPaths={selectedPaths}
            onClear={handleClearSelection}
            close={close}
          />
        )}
      </BatchControls>
    </>
  );
}
