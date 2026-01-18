import { useState, useRef, useCallback, useEffect } from "react";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Current folder context - null means root level */
  currentFolder: {
    id: string;
    slug: string;
    name: string;
  } | null;
  /** Called after successful upload/folder creation to refresh the page */
  onSuccess?: () => void;
}

interface UploadFile {
  file: File;
  relativePath: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

type ModalView = "main" | "create-folder" | "uploading" | "archive-analysis";

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

const ARCHIVE_EXTENSIONS = ["pak", "pk3", "zip"];

function isArchive(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? ARCHIVE_EXTENSIONS.includes(ext) : false;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function UploadModal({
  isOpen,
  onClose,
  currentFolder,
  onSuccess,
}: UploadModalProps) {
  const [view, setView] = useState<ModalView>("main");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  
  // Folder creation state
  const [folderName, setFolderName] = useState("");
  const [folderSlug, setFolderSlug] = useState("");
  const [customSlug, setCustomSlug] = useState(false);
  
  // Archive analysis state
  const [archiveAnalysis, setArchiveAnalysis] = useState<ArchiveAnalysis | null>(null);
  const [archiveFolderName, setArchiveFolderName] = useState("");
  const [archiveFolderSlug, setArchiveFolderSlug] = useState("");
  const [archiveCustomSlug, setArchiveCustomSlug] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const isAtRoot = !currentFolder;

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setView("main");
      setFiles([]);
      setError(null);
      setUploading(false);
      setUploadProgress({ done: 0, total: 0 });
      setFolderName("");
      setFolderSlug("");
      setCustomSlug(false);
      setArchiveAnalysis(null);
    }
  }, [isOpen]);

  // Auto-update folder slug when name changes
  useEffect(() => {
    if (!customSlug) {
      setFolderSlug(slugify(folderName));
    }
  }, [folderName, customSlug]);

  // Auto-update archive folder slug when name changes
  useEffect(() => {
    if (!archiveCustomSlug) {
      setArchiveFolderSlug(slugify(archiveFolderName));
    }
  }, [archiveFolderName, archiveCustomSlug]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const newFiles: UploadFile[] = [];
    
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      // webkitRelativePath is set when selecting folders
      const relativePath = (file as any).webkitRelativePath || file.name;
      newFiles.push({
        file,
        relativePath,
        status: "pending",
      });
    }

    // Check if this is an archive at root level
    if (isAtRoot && newFiles.length === 1 && isArchive(newFiles[0].file.name)) {
      // Analyze the archive
      analyzeArchive(newFiles[0].file);
      return;
    }

    // At root, only archives allowed
    if (isAtRoot) {
      const nonArchives = newFiles.filter(f => !isArchive(f.file.name));
      if (nonArchives.length > 0) {
        setError("At root level, only archives (PAK, PK3, ZIP) can be uploaded. Create a folder first to upload other files.");
        return;
      }
    }

    setFiles(newFiles);
    setError(null);
  }, [isAtRoot]);

  const analyzeArchive = async (file: File) => {
    setError(null);
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("_action", "analyze");

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.error) {
        setError(result.error);
        setUploading(false);
        return;
      }

      if (result.archiveAnalysis) {
        setArchiveAnalysis(result.archiveAnalysis);
        setArchiveFolderName(result.archiveAnalysis.suggestedName);
        setArchiveFolderSlug(result.archiveAnalysis.suggestedSlug);
        setView("archive-analysis");
      }
    } catch (err) {
      setError(`Failed to analyze archive: ${err}`);
    }
    
    setUploading(false);
  };

  const handleExtractArchive = async () => {
    if (!archiveAnalysis) return;
    
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("_action", "extract");
      formData.append("tempFile", archiveAnalysis.tempFile);
      formData.append("originalName", archiveAnalysis.originalName);
      formData.append("folderName", archiveFolderName);
      formData.append("folderSlug", archiveFolderSlug);
      if (currentFolder) {
        formData.append("parentFolderId", currentFolder.id);
      }

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.error) {
        setError(result.error);
        setUploading(false);
        return;
      }

      if (result.jobCreated) {
        onSuccess?.();
        onClose();
      }
    } catch (err) {
      setError(`Failed to start extraction: ${err}`);
    }

    setUploading(false);
  };

  const handleUpload = async () => {
    if (files.length === 0 || !currentFolder) return;
    
    setError(null);
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });

    let successCount = 0;
    const updatedFiles = [...files];

    for (let i = 0; i < files.length; i++) {
      const uploadFile = files[i];
      updatedFiles[i] = { ...uploadFile, status: "uploading" };
      setFiles([...updatedFiles]);

      try {
        const formData = new FormData();
        formData.append("file", uploadFile.file);
        formData.append("folderId", currentFolder.id);
        formData.append("relativePath", uploadFile.relativePath);

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        if (result.error) {
          updatedFiles[i] = { ...uploadFile, status: "error", error: result.error };
        } else {
          updatedFiles[i] = { ...uploadFile, status: "done" };
          successCount++;
        }
      } catch (err) {
        updatedFiles[i] = { ...uploadFile, status: "error", error: String(err) };
      }

      setFiles([...updatedFiles]);
      setUploadProgress({ done: i + 1, total: files.length });
    }

    setUploading(false);

    if (successCount > 0) {
      onSuccess?.();
    }

    if (successCount === files.length) {
      onClose();
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!folderName.trim() || !folderSlug.trim()) {
      setError("Folder name and slug are required");
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const response = await fetch("/api/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderName,
          slug: folderSlug,
          parentId: currentFolder?.id || null,
        }),
      });

      const result = await response.json();

      if (result.error) {
        setError(result.error);
        setUploading(false);
        return;
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(`Failed to create folder: ${err}`);
    }

    setUploading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {view === "main" && (isAtRoot ? "Add to Library" : `Upload to ${currentFolder?.name}`)}
            {view === "create-folder" && "Create Folder"}
            {view === "uploading" && "Uploading..."}
            {view === "archive-analysis" && "Archive Detected"}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}

          {/* Main view */}
          {view === "main" && (
            <>
              {/* File selection area */}
              <div className="upload-zone">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  // @ts-ignore - webkitdirectory is non-standard but widely supported
                  webkitdirectory=""
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />

                {files.length === 0 ? (
                  <div className="upload-zone-empty">
                    {isAtRoot ? (
                      <>
                        <p>Import an archive to create a new folder</p>
                        <p className="form-help">Supported: PAK, PK3, ZIP</p>
                        <div className="upload-buttons">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            Select Archive
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p>Select files or a folder to upload</p>
                        <div className="upload-buttons">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            Select Files
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => folderInputRef.current?.click()}
                          >
                            Select Folder
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="upload-file-list">
                    <div className="upload-file-list-header">
                      {files.length} file{files.length !== 1 ? "s" : ""} selected
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setFiles([])}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="upload-file-list-items">
                      {files.slice(0, 10).map((f, i) => (
                        <div key={i} className="upload-file-item">
                          <span className="upload-file-name">{f.relativePath}</span>
                          <span className="upload-file-status">
                            {f.status === "pending" && ""}
                            {f.status === "uploading" && "..."}
                            {f.status === "done" && "✓"}
                            {f.status === "error" && "✗"}
                          </span>
                        </div>
                      ))}
                      {files.length > 10 && (
                        <div className="upload-file-item" style={{ color: "#666" }}>
                          ... and {files.length - 10} more
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="modal-actions">
                {files.length > 0 && !isAtRoot && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleUpload}
                    disabled={uploading}
                  >
                    {uploading ? "Uploading..." : `Upload ${files.length} file${files.length !== 1 ? "s" : ""}`}
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={() => setView("create-folder")}
                >
                  Create Folder
                </button>
              </div>
            </>
          )}

          {/* Create folder view */}
          {view === "create-folder" && (
            <form onSubmit={handleCreateFolder}>
              <div className="form-group">
                <label className="form-label">Folder Name</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%" }}
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="My Textures"
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Folder Slug (URL path)
                  {!customSlug && (
                    <span style={{ fontWeight: 400, color: "#666" }}> — auto</span>
                  )}
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", background: customSlug ? undefined : "#f5f5f5" }}
                  value={folderSlug}
                  onChange={(e) => setFolderSlug(e.target.value)}
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

              {currentFolder && (
                <p className="form-help" style={{ marginBottom: "1rem" }}>
                  Will be created inside: {currentFolder.name}
                </p>
              )}

              <div className="modal-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={uploading}
                >
                  {uploading ? "Creating..." : "Create Folder"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setView("main")}
                >
                  Back
                </button>
              </div>
            </form>
          )}

          {/* Archive analysis view */}
          {view === "archive-analysis" && archiveAnalysis && (
            <>
              <dl className="detail-info">
                <dt>File</dt>
                <dd>{archiveAnalysis.originalName}</dd>
                <dt>Type</dt>
                <dd style={{ textTransform: "uppercase" }}>{archiveAnalysis.archiveType}</dd>
                <dt>Files</dt>
                <dd>{archiveAnalysis.totalFiles.toLocaleString()}</dd>
                <dt>Directories</dt>
                <dd>{archiveAnalysis.totalDirs.toLocaleString()}</dd>
              </dl>

              <details style={{ marginBottom: "1rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>
                  Sample files (first 20)
                </summary>
                <div
                  style={{
                    maxHeight: "150px",
                    overflow: "auto",
                    marginTop: "0.5rem",
                    fontSize: "0.75rem",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {archiveAnalysis.sampleFiles.map((name, i) => (
                    <div
                      key={i}
                      style={{ padding: "0.25rem", borderBottom: "1px solid #eee" }}
                    >
                      {name}
                    </div>
                  ))}
                  {archiveAnalysis.totalFiles > 20 && (
                    <div style={{ padding: "0.25rem", color: "#999" }}>
                      ... and {archiveAnalysis.totalFiles - 20} more
                    </div>
                  )}
                </div>
              </details>

              <div className="form-group">
                <label className="form-label">Folder Name</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%" }}
                  value={archiveFolderName}
                  onChange={(e) => setArchiveFolderName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Folder Slug
                  {!archiveCustomSlug && (
                    <span style={{ fontWeight: 400, color: "#666" }}> — auto</span>
                  )}
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", background: archiveCustomSlug ? undefined : "#f5f5f5" }}
                  value={archiveFolderSlug}
                  onChange={(e) => setArchiveFolderSlug(e.target.value)}
                  pattern="[a-z0-9-]+"
                  readOnly={!archiveCustomSlug}
                  required
                />
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", fontSize: "0.875rem" }}>
                  <input
                    type="checkbox"
                    checked={archiveCustomSlug}
                    onChange={(e) => setArchiveCustomSlug(e.target.checked)}
                  />
                  Customize slug
                </label>
              </div>

              {currentFolder && (
                <p className="form-help" style={{ marginBottom: "1rem" }}>
                  Will be created inside: {currentFolder.name}
                </p>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleExtractArchive}
                  disabled={uploading}
                >
                  {uploading ? "Starting..." : "Extract Archive"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setView("main");
                    setArchiveAnalysis(null);
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}

          {/* Upload progress */}
          {uploading && uploadProgress.total > 0 && (
            <div className="upload-progress">
              <div className="upload-progress-bar">
                <div
                  className="upload-progress-fill"
                  style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
                />
              </div>
              <div className="upload-progress-text">
                {uploadProgress.done} / {uploadProgress.total}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
