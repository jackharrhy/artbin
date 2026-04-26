import {
  useLoaderData,
  redirect,
  Form,
  useNavigation,
  useFetcher,
  useRevalidator,
} from "react-router";
import { useState, useCallback } from "react";
import type { Route } from "./+types/folder.$slug";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, files, tags } from "~/db";
import { eq, desc, count } from "drizzle-orm";
import { Header } from "~/components/Header";
import { BrowseTabs, type ViewMode } from "~/components/BrowseTabs";
import { SearchBar } from "~/components/SearchBar";
import { FileGrid } from "~/components/FileGrid";
import { FileList } from "~/components/FileList";
import { UploadModal } from "~/components/UploadModal";
import { MoveFolderModal } from "~/components/MoveFolderModal";
import {
  deleteFile,
  deleteFolder,
  searchFiles,
  getDescendantFolderIds,
  getFileCountsByKind,
} from "~/lib/files.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Combine slug and splat for nested folder paths
  const slug = params["*"] ? `${params.slug}/${params["*"]}` : params.slug!;

  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (!folder) {
    throw new Response("Folder not found", { status: 404 });
  }

  const url = new URL(request.url);
  const view = (url.searchParams.get("view") || "folders") as ViewMode;
  const query = url.searchParams.get("q") || "";
  const tagSlug = url.searchParams.get("tag") || null;
  const cursor = url.searchParams.get("cursor") || undefined;

  // Build ancestor chain for breadcrumbs
  const ancestors: { id: string; name: string; slug: string }[] = [];
  let currentParentId = folder.parentId;
  while (currentParentId) {
    const parent = await db.query.folders.findFirst({
      where: eq(folders.id, currentParentId),
    });
    if (!parent) break;
    ancestors.unshift(parent);
    currentParentId = parent.parentId;
  }

  // Get all descendant folder IDs for scoped queries
  const descendantFolderIds = await getDescendantFolderIds(folder.id);

  // Get file counts for tabs (scoped to this folder tree)
  const fileCounts = await getFileCountsByKind(descendantFolderIds);

  // Get all tags for filter dropdown
  const allTags = await db.query.tags.findMany({
    orderBy: [tags.name],
  });

  // Get child folders
  const childFolders = await db.query.folders.findMany({
    where: eq(folders.parentId, folder.id),
    orderBy: [folders.name],
  });

  // Get all folders for move modal
  const allFolders = await db.query.folders.findMany({
    orderBy: [folders.slug],
  });

  if (view === "folders") {
    // Get files in this folder (direct children only for folder view)
    const folderFiles = await db
      .select({
        id: files.id,
        path: files.path,
        name: files.name,
        kind: files.kind,
        mimeType: files.mimeType,
        size: files.size,
        width: files.width,
        height: files.height,
        hasPreview: files.hasPreview,
      })
      .from(files)
      .where(eq(files.folderId, folder.id))
      .orderBy(desc(files.createdAt))
      .limit(500);

    return {
      user,
      folder,
      ancestors,
      childFolders,
      allFolders,
      view,
      query,
      tagSlug,
      fileCounts: { ...fileCounts, folders: childFolders.length } as Record<string, number>,
      tags: allTags,
      files: folderFiles,
      searchResults: null as any,
    };
  }

  // Otherwise, search files by kind within this folder tree
  const kindMap: Record<string, string | string[]> = {
    textures: "texture",
    models: "model",
    sounds: "audio",
    all: ["texture", "model", "audio", "map", "archive", "config", "other"],
  };

  const kind = kindMap[view] as any;

  const searchResults = await searchFiles({
    kind,
    query: query || undefined,
    tagSlug: tagSlug || undefined,
    folderIds: descendantFolderIds,
    cursor,
    limit: 50,
  });

  return {
    user,
    folder,
    ancestors,
    childFolders,
    allFolders,
    view,
    query,
    tagSlug,
    fileCounts: { ...fileCounts, folders: childFolders.length } as Record<string, number>,
    tags: allTags,
    files: [] as any[],
    searchResults,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // Combine slug and splat for nested folder paths
  const slug = params["*"] ? `${params.slug}/${params["*"]}` : params.slug!;

  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (!folder) {
    return { error: "Folder not found" };
  }

  if (actionType === "delete") {
    // Recursively delete folder, children, and files
    async function deleteFolderRecursive(folderId: string, folderSlug: string) {
      // Get all files in this folder
      const folderFiles = await db.query.files.findMany({
        where: eq(files.folderId, folderId),
      });

      // Delete file records and files from disk
      for (const file of folderFiles) {
        await deleteFile(file.path);
      }
      await db.delete(files).where(eq(files.folderId, folderId));

      // Recursively delete child folders
      const childFolders = await db.query.folders.findMany({
        where: eq(folders.parentId, folderId),
      });

      for (const child of childFolders) {
        await deleteFolderRecursive(child.id, child.slug);
      }

      // Delete the folder record and directory
      await db.delete(folders).where(eq(folders.id, folderId));
      await deleteFolder(folderSlug);
    }

    await deleteFolderRecursive(folder.id, folder.slug);

    return redirect("/folders");
  }

  return { error: "Unknown action" };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.folder?.name || "Folder"} - artbin` }];
}

/**
 * Get the display URL for a file (preview if available, otherwise original)
 */
function getFileDisplayUrl(file: {
  path: string;
  hasPreview: boolean | null;
  kind: string | null;
}): string | null {
  if (file.kind !== "texture") return null;

  if (file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return `/uploads/${file.path}`;
}

/**
 * Get icon for non-image file kinds
 */
function getFileIcon(kind: string | null): string {
  switch (kind) {
    case "model":
      return "📦";
    case "audio":
      return "🔊";
    case "map":
      return "🗺️";
    case "archive":
      return "📁";
    case "config":
      return "📄";
    default:
      return "📎";
  }
}

export default function FolderView() {
  const data = useLoaderData<typeof loader>();
  const {
    user,
    folder,
    ancestors,
    childFolders,
    allFolders,
    view,
    query,
    tagSlug,
    fileCounts,
    tags,
    files: folderFiles,
  } = data;

  // State for modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const revalidator = useRevalidator();

  const navigation = useNavigation();
  const isDeleting =
    navigation.state === "submitting" && navigation.formData?.get("_action") === "delete";

  // State for infinite scroll
  const [searchFiles, setSearchFiles] = useState(data.searchResults?.files || []);
  const [nextCursor, setNextCursor] = useState(data.searchResults?.nextCursor || null);
  const [loading, setLoading] = useState(false);
  const [prevSearchResults, setPrevSearchResults] = useState(data.searchResults);
  const fetcher = useFetcher();
  const [prevFetcherData, setPrevFetcherData] = useState(fetcher.data);

  // Reset when loader data changes (e.g. view/query navigation)
  if (data.searchResults !== prevSearchResults) {
    setPrevSearchResults(data.searchResults);
    setSearchFiles(data.searchResults?.files || []);
    setNextCursor(data.searchResults?.nextCursor || null);
  }

  // Append results when fetcher completes a new load
  if (fetcher.data !== prevFetcherData) {
    setPrevFetcherData(fetcher.data);
    if (fetcher.data?.searchResults) {
      setSearchFiles((prev: typeof searchFiles) => [...prev, ...fetcher.data.searchResults.files]);
      setNextCursor(fetcher.data.searchResults.nextCursor);
      setLoading(false);
    }
  }

  const loadMore = useCallback(() => {
    if (loading || !nextCursor) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("view", view);
    if (query) params.set("q", query);
    if (tagSlug) params.set("tag", tagSlug);
    params.set("cursor", nextCursor);

    fetcher.load(`/folder/${folder.slug}?${params.toString()}`);
  }, [loading, nextCursor, view, query, tagSlug, folder.slug, fetcher]);

  // Separate files by kind for folder view display
  const textures = folderFiles.filter((f) => f.kind === "texture");
  const otherFiles = folderFiles.filter((f) => f.kind !== "texture");

  const isTextureView = view === "textures";
  const isSoundsView = view === "sounds";
  const baseUrl = `/folder/${folder.slug}`;

  return (
    <div>
      <Header user={user} onUploadClick={() => setShowUploadModal(true)} />
      <main className="main-content">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/folders">Folders</a>
          {ancestors.map((ancestor) => (
            <span key={ancestor.id}>
              <span className="breadcrumb-sep">/</span>
              <a href={`/folder/${ancestor.slug}`}>{ancestor.name}</a>
            </span>
          ))}
          <span className="breadcrumb-sep">/</span>
          <span>{folder.name}</span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h1 className="page-title" style={{ marginBottom: 0, borderBottom: "none" }}>
            {folder.name}
          </h1>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowUploadModal(true)}
            >
              Add
            </button>

            {user.isAdmin && (
              <>
                <button type="button" className="btn" onClick={() => setShowMoveModal(true)}>
                  Move
                </button>

                <Form
                  method="post"
                  style={{ display: "inline" }}
                  onSubmit={(e) => {
                    const fileCount = folderFiles.length;
                    const folderCount = childFolders.length;
                    let msg = `Delete folder "${folder.name}"?`;
                    if (fileCount > 0 || folderCount > 0) {
                      msg = `Delete folder "${folder.name}" with ${fileCount} file(s) and ${folderCount} subfolder(s)? This will permanently delete all contents.`;
                    }
                    if (!confirm(msg)) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="_action" value="delete" />
                  <button type="submit" className="btn btn-danger" disabled={isDeleting}>
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                </Form>
              </>
            )}
          </div>
        </div>

        {folder.description && (
          <p style={{ marginBottom: "1rem", color: "#666" }}>{folder.description}</p>
        )}

        <BrowseTabs
          baseUrl={baseUrl}
          currentView={view}
          counts={{
            folders: fileCounts.folders,
            textures: fileCounts.texture,
            models: fileCounts.model,
            sounds: fileCounts.audio,
            all: fileCounts.all,
          }}
        />

        {/* Search bar for file views */}
        {view !== "folders" && (
          <SearchBar
            baseUrl={baseUrl}
            currentView={view}
            currentQuery={query}
            currentTag={tagSlug}
            tags={tags}
            placeholder={`Search ${view} in ${folder.name}...`}
          />
        )}

        {/* Folder view - show subfolders and direct files */}
        {view === "folders" && (
          <>
            {/* Child Folders */}
            {childFolders.length > 0 && (
              <section className="section">
                <h2 className="section-title">Subfolders</h2>
                <div className="folder-grid">
                  {childFolders.map((child) => (
                    <a
                      key={child.id}
                      href={`/folder/${child.slug}`}
                      className="folder-card folder-card-with-preview"
                    >
                      {child.previewPath ? (
                        <div className="folder-preview">
                          <img src={`/uploads/${child.previewPath}`} alt="" loading="lazy" />
                        </div>
                      ) : (
                        <div className="folder-preview folder-preview-empty">
                          <span>📁</span>
                        </div>
                      )}
                      <div className="folder-info">
                        <div className="folder-name">{child.name}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Textures (image files) */}
            {textures.length > 0 && (
              <section className="section">
                <div className="grid-header">
                  <span className="grid-count">{textures.length} textures</span>
                </div>
                <div className="texture-grid">
                  {textures.map((file) => (
                    <a key={file.id} href={`/file/${file.path}`} className="texture-card">
                      <img src={getFileDisplayUrl(file) || ""} alt={file.name} loading="lazy" />
                      <div className="texture-card-info">{file.name}</div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Other Files */}
            {otherFiles.length > 0 && (
              <section className="section">
                <div className="grid-header">
                  <span className="grid-count">{otherFiles.length} other files</span>
                </div>
                <div className="file-list">
                  {otherFiles.map((file) => (
                    <a
                      key={file.id}
                      href={`/file/${file.path}`}
                      className="file-item"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.5rem",
                        borderBottom: "1px solid #eee",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <span style={{ fontSize: "1.25rem" }}>{getFileIcon(file.kind)}</span>
                      <div style={{ flex: 1 }}>
                        <div>{file.name}</div>
                        <div style={{ fontSize: "0.75rem", color: "#999" }}>
                          {file.kind} • {(file.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {childFolders.length === 0 && folderFiles.length === 0 && (
              <div className="empty-state">This folder is empty</div>
            )}
          </>
        )}

        {/* Texture grid view */}
        {isTextureView && (
          <FileGrid
            files={searchFiles}
            hasMore={!!nextCursor}
            onLoadMore={loadMore}
            loading={loading}
          />
        )}

        {/* List view for models, sounds, all */}
        {view !== "folders" && !isTextureView && (
          <FileList
            files={searchFiles}
            hasMore={!!nextCursor}
            onLoadMore={loadMore}
            loading={loading}
            showAudioPlayers={isSoundsView}
          />
        )}
      </main>

      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        currentFolder={{ id: folder.id, slug: folder.slug, name: folder.name }}
        onSuccess={() => revalidator.revalidate()}
      />

      {user.isAdmin && (
        <MoveFolderModal
          isOpen={showMoveModal}
          onClose={() => setShowMoveModal(false)}
          folder={{
            id: folder.id,
            name: folder.name,
            slug: folder.slug,
            parentId: folder.parentId,
          }}
          allFolders={allFolders.map((f) => ({
            id: f.id,
            name: f.name,
            slug: f.slug,
            parentId: f.parentId,
          }))}
          onSuccess={() => {
            revalidator.revalidate();
            // Redirect to new location after move
            window.location.href = `/folders`;
          }}
        />
      )}
    </div>
  );
}
