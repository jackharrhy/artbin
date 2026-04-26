import { useState } from "react";
import { useFetcher } from "react-router";

interface Folder {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

interface MoveFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: Folder;
  allFolders: Folder[];
  onSuccess?: () => void;
}

export function MoveFolderModal({
  isOpen,
  onClose,
  folder,
  allFolders,
  onSuccess,
}: MoveFolderModalProps) {
  const fetcher = useFetcher();
  const [selectedParentId, setSelectedParentId] = useState<string | null>(folder.parentId);
  const [createNew, setCreateNew] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = fetcher.state === "submitting";

  // Reset state when modal opens (previous-prop pattern)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setSelectedParentId(folder.parentId);
    setCreateNew(false);
    setNewFolderName("");
    setError(null);
  }
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  // Handle response (previous-prop pattern)
  const [prevFetcherData, setPrevFetcherData] = useState(fetcher.data);
  if (fetcher.data !== prevFetcherData) {
    setPrevFetcherData(fetcher.data);
    if (fetcher.data) {
      if (fetcher.data.error) {
        setError(fetcher.data.error);
      } else if (fetcher.data.success) {
        onSuccess?.();
        onClose();
      }
    }
  }

  if (!isOpen) return null;

  // Build folder tree for selection
  // Exclude the folder being moved and its descendants
  const getDescendantIds = (folderId: string): Set<string> => {
    const descendants = new Set<string>();
    const queue = [folderId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const f of allFolders) {
        if (f.parentId === currentId && !descendants.has(f.id)) {
          descendants.add(f.id);
          queue.push(f.id);
        }
      }
    }
    return descendants;
  };

  const descendantIds = getDescendantIds(folder.id);
  const availableFolders = allFolders.filter((f) => f.id !== folder.id && !descendantIds.has(f.id));

  // Build indented folder list
  const buildFolderOptions = () => {
    const options: { id: string; name: string; depth: number }[] = [];

    const addFolder = (f: Folder, depth: number) => {
      options.push({ id: f.id, name: f.name, depth });
      const children = availableFolders.filter((c) => c.parentId === f.id);
      for (const child of children) {
        addFolder(child, depth + 1);
      }
    };

    // Start with root folders
    const rootFolders = availableFolders.filter((f) => !f.parentId);
    for (const f of rootFolders) {
      addFolder(f, 0);
    }

    return options;
  };

  const folderOptions = buildFolderOptions();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (createNew) {
      if (!newFolderName.trim()) {
        setError("Please enter a folder name");
        return;
      }

      // Create new folder and move into it
      fetcher.submit(
        {
          _action: "create-and-move",
          name: newFolderName.trim(),
          parentId: selectedParentId || "",
          childFolderIds: JSON.stringify([folder.id]),
        },
        { method: "post", action: "/api/folder/move" },
      );
    } else {
      // Just move to selected parent
      if (selectedParentId === folder.parentId) {
        setError("Folder is already in this location");
        return;
      }

      fetcher.submit(
        {
          _action: "move",
          folderId: folder.id,
          newParentId: selectedParentId || "",
        },
        { method: "post", action: "/api/folder/move" },
      );
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Move "{folder.name}"</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">
                <input
                  type="radio"
                  name="moveType"
                  checked={!createNew}
                  onChange={() => setCreateNew(false)}
                  style={{ marginRight: "0.5rem" }}
                />
                Move to existing folder
              </label>
            </div>

            {!createNew && (
              <div className="form-group" style={{ marginLeft: "1.5rem" }}>
                <select
                  className="input"
                  style={{ width: "100%" }}
                  value={selectedParentId || "root"}
                  onChange={(e) =>
                    setSelectedParentId(e.target.value === "root" ? null : e.target.value)
                  }
                  disabled={createNew}
                >
                  <option value="root">/ (Root level)</option>
                  {folderOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {"  ".repeat(opt.depth)}
                      {opt.depth > 0 ? "└ " : ""}
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group" style={{ marginTop: "1rem" }}>
              <label className="form-label">
                <input
                  type="radio"
                  name="moveType"
                  checked={createNew}
                  onChange={() => setCreateNew(true)}
                  style={{ marginRight: "0.5rem" }}
                />
                Create new parent folder
              </label>
            </div>

            {createNew && (
              <>
                <div className="form-group" style={{ marginLeft: "1.5rem" }}>
                  <label className="form-label">New folder name</label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%" }}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="e.g., Quake 2"
                    autoFocus={createNew}
                  />
                </div>

                <div className="form-group" style={{ marginLeft: "1.5rem" }}>
                  <label className="form-label">Create in</label>
                  <select
                    className="input"
                    style={{ width: "100%" }}
                    value={selectedParentId || "root"}
                    onChange={(e) =>
                      setSelectedParentId(e.target.value === "root" ? null : e.target.value)
                    }
                  >
                    <option value="root">/ (Root level)</option>
                    {folderOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {"  ".repeat(opt.depth)}
                        {opt.depth > 0 ? "└ " : ""}
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div
              style={{
                marginTop: "1rem",
                padding: "0.75rem",
                background: "#f5f5f5",
                fontSize: "0.875rem",
                color: "#666",
              }}
            >
              <strong>Preview:</strong>{" "}
              {createNew ? (
                <>
                  {selectedParentId
                    ? `/${availableFolders.find((f) => f.id === selectedParentId)?.slug}/`
                    : "/"}
                  <em>{newFolderName || "new-folder"}</em>/{folder.slug.split("/").pop()}
                </>
              ) : (
                <>
                  {selectedParentId
                    ? `/${availableFolders.find((f) => f.id === selectedParentId)?.slug}/`
                    : "/"}
                  {folder.slug.split("/").pop()}
                </>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Moving..." : "Move Folder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
