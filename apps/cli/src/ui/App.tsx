import React, { useCallback, useEffect, useState } from "react";
import { ScanTreeView } from "@artbin/ui/ScanTreeView";
import { ArchiveItem } from "@artbin/ui/ArchiveItem";
import { BatchControls } from "@artbin/ui/BatchControls";
import { buildTree, getAllArchivePaths } from "@artbin/ui/tree-utils";
import type { FoundArchive, TreeNode } from "@artbin/ui/types";

interface ScanResult {
  archives: {
    path: string;
    name: string;
    size: number;
    type: string;
    gameDir: string | null;
    entries: { name: string }[];
  }[];
  looseFiles: { path: string; name: string; size: number }[];
  totalFileCount: number;
  totalSize: number;
}

interface ServerInfo {
  serverUrl: string;
  user: { name: string; isAdmin: boolean };
  folders: { slug: string; id: string }[];
}

interface ImportProgress {
  status: "idle" | "running" | "done" | "error";
  phase: string;
  current: number;
  total: number;
  message: string;
  result?: { uploaded: number; failed: number; skipped: number; total: number };
  error?: string;
}

type View = "browse" | "importing" | "done";

export function App() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [destinationFolder, setDestinationFolder] = useState("");
  const [newFolderSlug, setNewFolderSlug] = useState("");
  const [view, setView] = useState<View>("browse");
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  // Fetch scan results and info on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/scan-results").then((r) => r.json()),
      fetch("/api/info").then((r) => r.json()),
    ])
      .then(([scan, serverInfo]: [ScanResult, ServerInfo]) => {
        setScanResult(scan);
        setInfo(serverInfo);
        if (serverInfo.folders.length > 0) {
          setDestinationFolder(serverInfo.folders[0].slug);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const tree: TreeNode | null = scanResult
    ? buildTree(
        scanResult.archives.map((a) => ({
          path: a.path,
          name: a.name,
          type: a.type,
          size: a.size,
          fileCount: a.entries.length || 1,
          gameDir: a.gameDir,
        })),
      )
    : null;

  const handleToggleFolder = useCallback((paths: string[], selected: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (selected) {
          next.add(p);
        } else {
          next.delete(p);
        }
      }
      return next;
    });
  }, []);

  const handleToggleSingle = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!tree) return;
    const allPaths = getAllArchivePaths(tree);
    setSelectedPaths(new Set(allPaths));
  }, [tree]);

  const handleClearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const handleImport = useCallback(
    async (close: () => void) => {
      const folder = destinationFolder || newFolderSlug;
      if (!folder) return;

      close();
      setView("importing");

      try {
        await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archivePaths: Array.from(selectedPaths),
            destinationFolder: folder,
          }),
        });

        // Poll for progress
        const poll = setInterval(async () => {
          try {
            const res = await fetch("/api/import-status");
            const progress: ImportProgress = await res.json();
            setImportProgress(progress);

            if (progress.status === "done" || progress.status === "error") {
              clearInterval(poll);
              setView("done");
            }
          } catch {
            // Keep polling
          }
        }, 1000);
      } catch (err) {
        setImportProgress({
          status: "error",
          phase: "error",
          current: 0,
          total: 0,
          message: String(err),
          error: String(err),
        });
        setView("done");
      }
    },
    [selectedPaths, destinationFolder, newFolderSlug],
  );

  const handleBackToBrowse = useCallback(() => {
    setView("browse");
    setSelectedPaths(new Set());
    setImportProgress(null);
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-text-muted">Loading scan results...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-red-700">Error: {error}</p>
      </div>
    );
  }

  if (!scanResult || !info || !tree) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-text-muted">No data available</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <header className="mb-6 border-b border-border-light pb-4">
        <h1 className="text-2xl font-semibold">artbin</h1>
        <p className="text-sm text-text-muted mt-1">
          Logged in as <strong>{info.user.name}</strong>
          {!info.user.isAdmin && " (uploads will be pending review)"}
          {" -- "}
          {info.serverUrl}
        </p>
        <p className="text-sm text-text-muted mt-1">
          {scanResult.archives.length} archives, {scanResult.looseFiles.length} loose files
        </p>
      </header>

      {view === "browse" && (
        <>
          <div className="flex items-center gap-4 mb-4">
            <button type="button" className="btn btn-sm" onClick={handleSelectAll}>
              Select all
            </button>
            {selectedPaths.size > 0 && (
              <button type="button" className="btn btn-sm" onClick={handleClearSelection}>
                Clear ({selectedPaths.size})
              </button>
            )}
          </div>

          <ScanTreeView
            node={tree}
            selectedPaths={selectedPaths}
            onToggleFolder={handleToggleFolder}
            renderArchive={(archive: FoundArchive, isSelected: boolean) => (
              <ArchiveItem
                key={archive.path}
                archive={archive}
                isSelected={isSelected}
                onToggle={() => handleToggleSingle(archive.path)}
              />
            )}
          />

          <BatchControls selectedCount={selectedPaths.size} onClear={handleClearSelection}>
            {({ close }) => (
              <div>
                {!info.user.isAdmin && (
                  <p className="mb-3 text-sm text-text-muted border border-border-light p-2 bg-bg-hover">
                    You are not an admin. Uploads will be submitted for review.
                  </p>
                )}

                <label className="block text-sm mb-1 font-semibold">Destination folder</label>
                {info.folders.length > 0 ? (
                  <select
                    className="w-full p-2 border border-border-light bg-white text-sm mb-3"
                    value={destinationFolder}
                    onChange={(e) => setDestinationFolder(e.target.value)}
                  >
                    {info.folders.map((f) => (
                      <option key={f.slug} value={f.slug}>
                        {f.slug}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="w-full p-2 border border-border-light bg-white text-sm mb-3"
                    placeholder="folder-slug"
                    value={newFolderSlug}
                    onChange={(e) => setNewFolderSlug(e.target.value)}
                  />
                )}

                <div className="flex gap-2 justify-end">
                  <button type="button" className="btn" onClick={close}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleImport(close)}
                    disabled={!destinationFolder && !newFolderSlug}
                  >
                    Import {selectedPaths.size} archives
                  </button>
                </div>
              </div>
            )}
          </BatchControls>
        </>
      )}

      {view === "importing" && (
        <div className="py-8">
          <h2 className="text-lg font-semibold mb-4">Importing...</h2>
          {importProgress && (
            <div>
              <p className="text-sm text-text-muted mb-2">{importProgress.message}</p>
              <div className="w-full h-4 bg-bg-subtle border border-border-light">
                <div
                  className="h-full bg-text transition-all"
                  style={{
                    width:
                      importProgress.total > 0
                        ? `${(importProgress.current / importProgress.total) * 100}%`
                        : "0%",
                  }}
                />
              </div>
              <p className="text-xs text-text-muted mt-1">
                {importProgress.phase} -- {importProgress.current}/{importProgress.total}
              </p>
            </div>
          )}
          {!importProgress && <p className="text-sm text-text-muted">Starting import...</p>}
        </div>
      )}

      {view === "done" && importProgress && (
        <div className="py-8">
          <h2 className="text-lg font-semibold mb-4">
            {importProgress.status === "error" ? "Import failed" : "Import complete"}
          </h2>

          {importProgress.status === "error" && (
            <p className="text-sm text-red-700 mb-4">{importProgress.error}</p>
          )}

          {importProgress.result && (
            <div className="border border-border-light p-4 mb-4 text-sm">
              <p>
                <strong>{importProgress.result.uploaded}</strong> files uploaded
              </p>
              {importProgress.result.skipped > 0 && (
                <p>
                  <strong>{importProgress.result.skipped}</strong> already existed (skipped)
                </p>
              )}
              {importProgress.result.failed > 0 && (
                <p className="text-red-700">
                  <strong>{importProgress.result.failed}</strong> failed
                </p>
              )}
              <p className="text-text-muted mt-1">
                {importProgress.result.total} total files processed
              </p>
            </div>
          )}

          <button type="button" className="btn" onClick={handleBackToBrowse}>
            Back to browse
          </button>
        </div>
      )}
    </div>
  );
}
