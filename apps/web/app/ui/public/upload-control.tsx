import { clientEntry, on, ref, type Handle, type SerializableProps } from "remix/ui";

import { routes } from "../../routes.ts";

interface UploadFolder extends SerializableProps {
  id: string;
  slug: string;
  name: string;
}

interface UploadControlProps extends SerializableProps {
  currentFolder?: UploadFolder;
  isAdmin: boolean;
  label?: string;
}

interface SelectedFile {
  file: File;
  relativePath: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

interface ArchiveAnalysis {
  tempFile: string;
  originalName: string;
  archiveType: string;
  totalFiles: number;
  totalDirs: number;
  suggestedName: string;
  suggestedSlug: string;
  sampleFiles: string[];
}

type View = "main" | "folder" | "archive";

const archiveExtensions = new Set(["pak", "pk3", "zip"]);

export const UploadControl = clientEntry(
  `${import.meta.url}#UploadControl`,
  function UploadControl(handle: Handle<UploadControlProps>) {
    let open = false;
    let view: View = "main";
    let files: SelectedFile[] = [];
    let fileInput: HTMLInputElement | null = null;
    let directoryInput: HTMLInputElement | null = null;
    let error: string | null = null;
    let message: string | null = null;
    let busy = false;
    let progress = { done: 0, total: 0 };
    let analysis: ArchiveAnalysis | null = null;
    let archiveName = "";
    let archiveSlug = "";
    let folderName = "";
    let folderSlug = "";

    function close() {
      open = false;
      view = "main";
      files = [];
      error = null;
      message = null;
      busy = false;
      progress = { done: 0, total: 0 };
      analysis = null;
      archiveName = "";
      archiveSlug = "";
      folderName = "";
      folderSlug = "";
      handle.update();
    }

    async function analyze(file: File, signal: AbortSignal) {
      busy = true;
      error = null;
      await handle.update();
      const form = new FormData();
      form.set("_action", "analyze");
      form.set("file", file);
      try {
        const response = await fetch(routes.api.upload.href(), { method: "POST", body: form, signal });
        const result = (await response.json()) as {
          error?: string;
          archiveAnalysis?: ArchiveAnalysis;
        };
        if (signal.aborted) return;
        if (!response.ok || result.error || !result.archiveAnalysis) {
          error = result.error ?? "The archive could not be analyzed.";
        } else {
          analysis = result.archiveAnalysis;
          archiveName = analysis.suggestedName;
          archiveSlug = analysis.suggestedSlug;
          view = "archive";
        }
      } catch (caught) {
        if (!signal.aborted) {
          error = caught instanceof Error ? caught.message : "The archive could not be analyzed.";
        }
      }
      busy = false;
      handle.update();
    }

    return () => {
      const props = handle.props;
      const currentFolder = props.currentFolder;
      const atRoot = !currentFolder;

      return (
        <>
          <button
            type="button"
            className="btn btn-primary"
            mix={on("click", () => {
              open = true;
              handle.update();
            })}
          >
            {props.label ?? (atRoot ? "Add" : "Upload")}
          </button>
          {open ? (
            <div className="modal-overlay" mix={on("click", close)}>
              <div className="modal" mix={on("click", (event) => event.stopPropagation())}>
                <div className="modal-header">
                  <h2 className="modal-title">
                    {view === "folder"
                      ? "Create folder"
                      : view === "archive"
                        ? "Archive detected"
                        : atRoot
                          ? "Add to library"
                          : props.isAdmin
                            ? `Upload to ${currentFolder.name}`
                            : `Upload to ${currentFolder.name} for review`}
                  </h2>
                  <button type="button" className="modal-close" aria-label="Close" mix={on("click", close)}>
                    ×
                  </button>
                </div>
                <div className="modal-body">
                  {error ? <div className="alert alert-error mb-4">{error}</div> : null}
                  {message ? <div className="alert alert-success mb-4">{message}</div> : null}

                  {view === "main" ? (
                    <>
                      {currentFolder ? (
                        <div className="mb-4 border border-border-light bg-bg-hover p-3 text-sm">
                          <div className="font-medium">Destination: {currentFolder.name}</div>
                          <div className="text-xs text-text-muted">/{currentFolder.slug}</div>
                        </div>
                      ) : null}

                      <div className="upload-zone">
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          mix={[
                            ref((element) => {
                              fileInput = element as HTMLInputElement;
                            }),
                            on("change", async (event, signal) => {
                              const selected = [...((event.currentTarget as HTMLInputElement).files ?? [])];
                              if (!selected.length) return;
                              const next = selected.map((file) => ({
                                file,
                                relativePath:
                                  (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
                                  file.name,
                                status: "pending" as const,
                              }));
                              if (props.isAdmin && next.length === 1 && isArchive(next[0]!.file.name)) {
                                await analyze(next[0]!.file, signal);
                                return;
                              }
                              if (atRoot) {
                                error = props.isAdmin
                                  ? "At the top level, select one PAK, PK3, or ZIP archive."
                                  : "Open a folder before uploading files.";
                                handle.update();
                                return;
                              }
                              files = next;
                              error = null;
                              message = null;
                              handle.update();
                            }),
                          ]}
                        />
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          mix={[
                            ref((element) => {
                              directoryInput = element as HTMLInputElement;
                              element.setAttribute("webkitdirectory", "");
                            }),
                            on("change", (event) => {
                              const selected = [...((event.currentTarget as HTMLInputElement).files ?? [])];
                              files = selected.map((file) => ({
                                file,
                                relativePath:
                                  (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
                                  file.name,
                                status: "pending" as const,
                              }));
                              error = null;
                              message = null;
                              handle.update();
                            }),
                          ]}
                        />

                        {files.length ? (
                          <div className="upload-file-list">
                            <div className="upload-file-list-header">
                              {files.length} file{files.length === 1 ? "" : "s"} selected
                              <button
                                type="button"
                                className="btn btn-sm"
                                mix={on("click", () => {
                                  files = [];
                                  handle.update();
                                })}
                              >
                                Clear
                              </button>
                            </div>
                            <div className="upload-file-list-items">
                              {files.slice(0, 10).map((selected, index) => (
                                <div key={`${selected.relativePath}-${index}`} className="upload-file-item">
                                  <span className="upload-file-name">{selected.relativePath}</span>
                                  <span className="upload-file-status">
                                    {selected.status === "uploading"
                                      ? "..."
                                      : selected.status === "done"
                                        ? "✓"
                                        : selected.status === "error"
                                          ? "✗"
                                          : ""}
                                  </span>
                                </div>
                              ))}
                              {files.length > 10 ? (
                                <div className="upload-file-item text-text-muted">
                                  {files.length - 10} more file{files.length - 10 === 1 ? "" : "s"}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="upload-zone-empty">
                            {atRoot && props.isAdmin ? (
                              <>
                                <p>Import an archive to create a collection.</p>
                                <p className="text-xs text-text-faint mt-1">Supports PAK, PK3, and ZIP.</p>
                                <button type="button" className="btn mt-3" mix={on("click", () => fileInput?.click())}>
                                  Select archive
                                </button>
                              </>
                            ) : atRoot ? (
                              <p>Open a folder before uploading files.</p>
                            ) : (
                              <>
                                <p>Select files or a folder to upload.</p>
                                <div className="upload-buttons">
                                  <button type="button" className="btn" mix={on("click", () => fileInput?.click())}>
                                    Select files
                                  </button>
                                  <button type="button" className="btn" mix={on("click", () => directoryInput?.click())}>
                                    Select folder
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="modal-actions">
                        {files.length && currentFolder ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy}
                            mix={on("click", async (_event, signal) => {
                              busy = true;
                              error = null;
                              message = null;
                              progress = { done: 0, total: files.length };
                              let sessionId: string | null = null;
                              let successes = 0;
                              for (let index = 0; index < files.length; index++) {
                                if (signal.aborted) return;
                                const selected = files[index]!;
                                selected.status = "uploading";
                                await handle.update();
                                const form = new FormData();
                                form.set("file", selected.file);
                                form.set("folderId", currentFolder.id);
                                form.set("relativePath", selected.relativePath);
                                if (sessionId) form.set("uploadSessionId", sessionId);
                                try {
                                  const response = await fetch(routes.api.upload.href(), {
                                    method: "POST",
                                    body: form,
                                    signal,
                                  });
                                  const result = (await response.json()) as {
                                    error?: string;
                                    pendingUpload?: boolean;
                                    uploadSessionId?: string;
                                    message?: string;
                                  };
                                  if (!response.ok || result.error) {
                                    selected.status = "error";
                                    selected.error = result.error ?? "Upload failed.";
                                  } else {
                                    selected.status = "done";
                                    successes++;
                                    if (result.uploadSessionId) sessionId = result.uploadSessionId;
                                    if (result.message) message = result.message;
                                  }
                                } catch (caught) {
                                  if (signal.aborted) return;
                                  selected.status = "error";
                                  selected.error = caught instanceof Error ? caught.message : "Upload failed.";
                                }
                                progress.done = index + 1;
                                await handle.update();
                              }
                              busy = false;
                              const firstError = files.find((selected) => selected.error)?.error;
                              if (firstError) error = firstError;
                              await handle.update();
                              if (successes === files.length && props.isAdmin) location.reload();
                            })}
                          >
                            {busy ? "Uploading..." : `Upload ${files.length} file${files.length === 1 ? "" : "s"}`}
                          </button>
                        ) : null}
                        {props.isAdmin ? (
                          <button
                            type="button"
                            className="btn"
                            mix={on("click", () => {
                              view = "folder";
                              error = null;
                              handle.update();
                            })}
                          >
                            Create folder
                          </button>
                        ) : null}
                      </div>

                      {props.isAdmin ? (
                        <form
                          className="mt-5 border-t border-border-light pt-5"
                          mix={on("submit", async (event, signal) => {
                            event.preventDefault();
                            busy = true;
                            error = null;
                            message = null;
                            await handle.update();
                            const form = new FormData(event.currentTarget as HTMLFormElement);
                            if (currentFolder) form.set("targetFolderId", currentFolder.id);
                            try {
                              const response = await fetch(routes.api.import.href(), {
                                method: "POST",
                                body: form,
                                signal,
                              });
                              const result = (await response.json()) as { error?: string; count?: number };
                              if (!response.ok || result.error) error = result.error ?? "Import could not be queued.";
                              else message = `Queued ${result.count ?? 0} import${result.count === 1 ? "" : "s"}.`;
                            } catch (caught) {
                              if (!signal.aborted) error = caught instanceof Error ? caught.message : "Import failed.";
                            }
                            busy = false;
                            handle.update();
                          })}
                        >
                          <h3 className="font-medium mb-1">Import from site</h3>
                          <p className="text-sm text-text-muted mb-3">
                            Paste GameBanana or SCMapDB pages, or direct HTTPS archive links.
                          </p>
                          <textarea
                            name="sourceUrls"
                            rows={4}
                            required
                            className="input w-full font-mono"
                            placeholder={"https://gamebanana.com/mods/140244\nhttps://scmapdb.wikidot.com/map:decay"}
                          />
                          <p className="mt-1 text-xs text-text-faint">
                            One URL per line, up to 20. Collections are created {currentFolder ? `inside ${currentFolder.name}` : "at the top level"}.
                          </p>
                          <div className="modal-actions justify-end">
                            <button type="submit" className="btn btn-primary" disabled={busy}>
                              {busy ? "Adding to queue..." : "Import"}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </>
                  ) : null}

                  {view === "folder" && props.isAdmin ? (
                    <form
                      mix={on("submit", async (event, signal) => {
                        event.preventDefault();
                        busy = true;
                        error = null;
                        await handle.update();
                        try {
                          const response = await fetch(routes.api.folder.href(), {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              name: folderName,
                              slug: folderSlug,
                              parentId: currentFolder?.id ?? null,
                            }),
                            signal,
                          });
                          const result = (await response.json()) as { error?: string };
                          if (!response.ok || result.error) error = result.error ?? "Folder creation failed.";
                          else location.reload();
                        } catch (caught) {
                          if (!signal.aborted) error = caught instanceof Error ? caught.message : "Folder creation failed.";
                        }
                        busy = false;
                        handle.update();
                      })}
                    >
                      <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                        Folder name
                      </label>
                      <input
                        className="input w-full mb-4"
                        name="name"
                        value={folderName}
                        required
                        mix={on("input", (event) => {
                          folderName = (event.currentTarget as HTMLInputElement).value;
                          folderSlug = slugify(folderName);
                          handle.update();
                        })}
                      />
                      <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                        Folder URL slug (from the folder name)
                      </label>
                      <input
                        className="input w-full mb-4"
                        name="slug"
                        value={folderSlug}
                        pattern="[a-z0-9-]+"
                        required
                        mix={on("input", (event) => {
                          folderSlug = (event.currentTarget as HTMLInputElement).value;
                        })}
                      />
                      {currentFolder ? (
                        <p className="text-xs text-text-faint mb-4">New folder location: {currentFolder.name}</p>
                      ) : null}
                      <div className="modal-actions">
                        <button type="submit" className="btn btn-primary" disabled={busy}>
                          {busy ? "Creating..." : "Create folder"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          mix={on("click", () => {
                            view = "main";
                            handle.update();
                          })}
                        >
                          Back
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {view === "archive" && props.isAdmin && analysis ? (
                    <>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mb-4">
                        <dt className="font-medium text-text-muted">File</dt>
                        <dd>{analysis.originalName}</dd>
                        <dt className="font-medium text-text-muted">Type</dt>
                        <dd className="uppercase">{analysis.archiveType}</dd>
                        <dt className="font-medium text-text-muted">Files</dt>
                        <dd>{analysis.totalFiles}</dd>
                        <dt className="font-medium text-text-muted">Directories</dt>
                        <dd>{analysis.totalDirs}</dd>
                      </dl>
                      <details className="mb-4">
                        <summary className="cursor-pointer text-sm">Files in archive</summary>
                        <div className="max-h-[150px] overflow-auto mt-2 text-xs font-mono">
                          {analysis.sampleFiles.map((name) => (
                            <div key={name} className="p-1 border-b border-bg-subtle">{name}</div>
                          ))}
                        </div>
                      </details>
                      <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                        Folder name
                      </label>
                      <input
                        className="input w-full mb-4"
                        value={archiveName}
                        required
                        mix={on("input", (event) => {
                          archiveName = (event.currentTarget as HTMLInputElement).value;
                          archiveSlug = slugify(archiveName);
                          handle.update();
                        })}
                      />
                      <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                        Folder URL slug (from the folder name)
                      </label>
                      <input
                        className="input w-full mb-4"
                        value={archiveSlug}
                        pattern="[a-z0-9-]+"
                        required
                        mix={on("input", (event) => {
                          archiveSlug = (event.currentTarget as HTMLInputElement).value;
                        })}
                      />
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy}
                          mix={on("click", async (_event, signal) => {
                            if (!analysis) return;
                            busy = true;
                            error = null;
                            await handle.update();
                            const form = new FormData();
                            form.set("_action", "extract");
                            form.set("tempFile", analysis.tempFile);
                            form.set("originalName", analysis.originalName);
                            form.set("folderName", archiveName);
                            form.set("folderSlug", archiveSlug);
                            if (currentFolder) form.set("parentFolderId", currentFolder.id);
                            try {
                              const response = await fetch(routes.api.upload.href(), {
                                method: "POST",
                                body: form,
                                signal,
                              });
                              const result = (await response.json()) as { error?: string; jobCreated?: unknown };
                              if (!response.ok || result.error) error = result.error ?? "Extraction could not start.";
                              else location.reload();
                            } catch (caught) {
                              if (!signal.aborted) error = caught instanceof Error ? caught.message : "Extraction failed.";
                            }
                            busy = false;
                            handle.update();
                          })}
                        >
                          {busy ? "Starting..." : "Extract archive"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          mix={on("click", () => {
                            analysis = null;
                            view = "main";
                            handle.update();
                          })}
                        >
                          Back
                        </button>
                      </div>
                    </>
                  ) : null}

                  {busy && progress.total ? (
                    <div className="upload-progress">
                      <div className="upload-progress-bar">
                        <div
                          className="upload-progress-fill"
                          style={{ width: `${(progress.done / progress.total) * 100}%` }}
                        />
                      </div>
                      <div className="upload-progress-text">
                        {progress.done} / {progress.total}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      );
    };
  },
);

function isArchive(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return !!extension && archiveExtensions.has(extension);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
