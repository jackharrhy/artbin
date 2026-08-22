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
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { folders, files, tags, remoteImports } from "~/db";
import { eq, desc, count, and, sql, inArray } from "drizzle-orm";
import { BrowseTabs, type ViewMode } from "~/components/BrowseTabs";
import { SearchBar } from "~/components/SearchBar";
import { FileGrid } from "~/components/FileGrid";
import { FileList } from "~/components/FileList";
import { UploadModal } from "~/components/UploadModal";
import { MoveFolderModal } from "~/components/MoveFolderModal";
import { LuckyButton } from "~/components/LuckyButton";
import { deleteFile, deleteFolder } from "~/lib/files.server";
import { renameFolder } from "~/lib/folders.server";
import {
  searchFiles,
  getDescendantFolderIds,
  getFileCountsByKind,
} from "~/lib/file-queries.server";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const user = context.get(userContext);

  // Combine slug and splat for nested folder paths
  const slug = params["*"] ? `${params.slug}/${params["*"]}` : params.slug!;

  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (!folder || folder.slug.startsWith("_")) {
    throw new Response("Folder not found", { status: 404 });
  }

  const remoteImport = await db.query.remoteImports.findFirst({
    where: eq(remoteImports.folderId, folder.id),
    orderBy: (remoteImports, { desc }) => [desc(remoteImports.updatedAt)],
    columns: {
      provider: true,
      externalId: true,
      sourceUrl: true,
      author: true,
      game: true,
    },
  });

  const url = new URL(request.url);

  const view = (url.searchParams.get("view") || "folders") as ViewMode;
  const query = url.searchParams.get("q") || "";
  const tagSlug = url.searchParams.get("tag") || null;
  const cursor = url.searchParams.get("cursor") || undefined;

  // Build ancestor chain for breadcrumbs from slug segments (single query)
  const slugParts = folder.slug.split("/");
  const ancestorSlugs = slugParts.slice(0, -1).map((_, i) => slugParts.slice(0, i + 1).join("/"));
  const ancestors =
    ancestorSlugs.length > 0
      ? await db.query.folders.findMany({
          where: inArray(folders.slug, ancestorSlugs),
          columns: { id: true, name: true, slug: true },
        })
      : [];
  // Sort by slug depth to maintain breadcrumb order
  ancestors.sort((a, b) => a.slug.split("/").length - b.slug.split("/").length);

  // Get all descendant folder IDs for scoped queries
  const descendantFolderIds = await getDescendantFolderIds(folder.id);

  // Get file counts for tabs (scoped to this folder tree)
  const fileCounts = await getFileCountsByKind(descendantFolderIds);

  // Get all tags for filter dropdown
  const allTags = await db.query.tags.findMany({
    orderBy: [tags.name],
  });

  // Get child folders (exclude system folders starting with _)
  const childFolders = await db.query.folders.findMany({
    where: and(eq(folders.parentId, folder.id), sql`${folders.slug} NOT LIKE '\\_%' ESCAPE '\\'`),
    orderBy: [folders.name],
  });

  // Get all folders for move modal
  const allFolders = await db.query.folders.findMany({
    orderBy: [folders.slug],
  });

  if (view === "folders") {
    // Get files in this folder (direct children only for folder view, approved only)
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
      .where(and(eq(files.folderId, folder.id), eq(files.status, "approved")))
      .orderBy(desc(files.createdAt))
      .limit(100);

    return {
      user,
      folder,
      remoteImport,
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
    remoteImport,
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

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = context.get(userContext);

  if (!user.isAdmin) {
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

  if (actionType === "rename") {
    const newName = (formData.get("name") as string) || "";
    const result = await renameFolder(folder.id, newName);
    if (result.isErr()) {
      return { error: result.error.message };
    }
    // Redirect to the new slug
    return redirect(`/folder/${result.value.folder?.slug}`);
  }

  if (actionType === "update-description") {
    const description = (formData.get("description") as string) || "";
    await db
      .update(folders)
      .set({ description: description.trim() || null })
      .where(eq(folders.id, folder.id));
    return { success: true };
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

function getFileDisplayUrl(file: {
  path: string;
  hasPreview: boolean | null;
  kind: string | null;
}): string | null {
  if (file.kind === "texture") {
    if (file.hasPreview) {
      return `/uploads/${file.path}.preview.png`;
    }
    return `/uploads/${file.path}`;
  }
  // Models with generated previews
  if (file.kind === "model" && file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return null;
}

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
    remoteImport,
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
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState(folder.description || "");
  const descriptionFetcher = useFetcher();
  const revalidator = useRevalidator();

  const navigation = useNavigation();
  const isDeleting =
    navigation.state === "submitting" && navigation.formData?.get("_action") === "delete";
  const isRenamingSubmit =
    navigation.state === "submitting" && navigation.formData?.get("_action") === "rename";

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
  const models = folderFiles.filter((f) => f.kind === "model");
  const otherFiles = folderFiles.filter((f) => f.kind !== "texture" && f.kind !== "model");

  const isTextureView = view === "textures";
  const isModelView = view === "models";
  const isGridView = isTextureView || isModelView;
  const isSoundsView = view === "sounds";
  const baseUrl = `/folder/${folder.slug}`;

  return (
    <>
      <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
        {/* Breadcrumb */}
        <div className="text-xs text-text-muted mb-4">
          <a className="text-text-muted hover:text-text" href="/folders">
            Folders
          </a>
          {ancestors.map((ancestor) => (
            <span key={ancestor.id}>
              <span className="mx-2">/</span>
              <a className="text-text-muted hover:text-text" href={`/folder/${ancestor.slug}`}>
                {ancestor.name}
              </a>
            </span>
          ))}
          <span className="mx-2">/</span>
          <span>{folder.name}</span>
        </div>

        <div className="flex justify-between items-center mb-4">
          {isRenaming ? (
            <Form method="post" className="flex items-center gap-2">
              <input type="hidden" name="_action" value="rename" />
              <input
                type="text"
                name="name"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsRenaming(false);
                    setRenameValue(folder.name);
                  }
                }}
                className="text-xl font-normal bg-bg border border-border px-2 py-1"
                autoFocus
              />
              <button type="submit" className="btn btn-primary" disabled={isRenamingSubmit}>
                {isRenamingSubmit ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setIsRenaming(false);
                  setRenameValue(folder.name);
                }}
              >
                Cancel
              </button>
            </Form>
          ) : (
            <h1 className="text-xl font-normal">{folder.name}</h1>
          )}

          <div className="flex gap-2">
            <a href={`/api/folder/download/${folder.slug}`} className="btn" download>
              Download ZIP
            </a>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowUploadModal(true)}
            >
              Upload
            </button>

            {user.isAdmin && !isRenaming && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setRenameValue(folder.name);
                    setIsRenaming(true);
                  }}
                >
                  Rename
                </button>
                <button type="button" className="btn" onClick={() => setShowMoveModal(true)}>
                  Move
                </button>

                <Form
                  method="post"
                  className="inline"
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

        {remoteImport && (
          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            <span>Imported from</span>
            <a href={remoteImport.sourceUrl} target="_blank" rel="noopener noreferrer">
              {remoteImport.provider === "gamebanana"
                ? "GameBanana"
                : remoteImport.provider === "scmapdb"
                  ? "SCMapDB"
                  : "direct archive"}
            </a>
            {remoteImport.author && <span>by {remoteImport.author}</span>}
            {remoteImport.game && <span>for {remoteImport.game}</span>}
          </div>
        )}

        {user.isAdmin && isEditingDescription ? (
          <descriptionFetcher.Form
            method="post"
            className="mb-4"
            onSubmit={() => setIsEditingDescription(false)}
          >
            <input type="hidden" name="_action" value="update-description" />
            <textarea
              name="description"
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsEditingDescription(false);
                  setDescriptionValue(folder.description || "");
                }
              }}
              className="w-full bg-bg border border-border px-2 py-1 text-text-muted text-sm"
              rows={3}
              placeholder="Folder description..."
              autoFocus
            />
            <div className="flex gap-2 mt-1">
              <button type="submit" className="btn btn-primary text-sm">
                Save
              </button>
              <button
                type="button"
                className="btn text-sm"
                onClick={() => {
                  setIsEditingDescription(false);
                  setDescriptionValue(folder.description || "");
                }}
              >
                Cancel
              </button>
            </div>
          </descriptionFetcher.Form>
        ) : folder.description ? (
          <p
            className={`mb-4 text-text-muted ${user.isAdmin ? "cursor-pointer hover:text-text" : ""}`}
            onClick={user.isAdmin ? () => setIsEditingDescription(true) : undefined}
            title={user.isAdmin ? "Click to edit" : undefined}
          >
            {folder.description}
          </p>
        ) : user.isAdmin ? (
          <button
            type="button"
            className="mb-4 text-text-muted text-sm hover:text-text"
            onClick={() => setIsEditingDescription(true)}
          >
            + Add description
          </button>
        ) : null}

        <div className="flex items-center justify-between">
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
          {fileCounts.all > 0 && <LuckyButton folderId={folder.id} sourceLabel={folder.name} />}
        </div>

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
              <section className="mb-8">
                <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
                  Subfolders
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                  {childFolders.map((child) => (
                    <a
                      key={child.id}
                      href={`/folder/${child.slug}`}
                      className="block p-0 border border-border-light bg-bg no-underline transition-colors hover:border-border hover:no-underline overflow-hidden"
                    >
                      {child.previewPath ? (
                        <div className="aspect-square overflow-hidden bg-bg-hover">
                          <img
                            className="w-full h-full object-cover block"
                            src={`/uploads/${child.previewPath}`}
                            alt=""
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className="aspect-square flex items-center justify-center text-5xl text-border-light">
                          <span>📁</span>
                        </div>
                      )}
                      <div className="px-3 py-2 border-t border-border-light">
                        <div className="font-medium mb-1">{child.name}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Textures (image files) */}
            {textures.length > 0 && (
              <section className="mb-8">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs text-text-muted">
                    {textures.length}
                    {fileCounts.texture > textures.length ? ` of ${fileCounts.texture}` : ""}{" "}
                    textures
                  </span>
                  {fileCounts.texture > textures.length && (
                    <a
                      href={`${baseUrl}?view=textures`}
                      className="text-xs text-text-muted hover:text-text no-underline"
                    >
                      View all
                    </a>
                  )}
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                  {textures.map((file) => (
                    <a
                      key={file.id}
                      href={`/file/${file.path}`}
                      className="group relative aspect-square overflow-hidden border border-border-light bg-[#f9f9f9] transition-colors hover:border-border"
                    >
                      <img
                        src={getFileDisplayUrl(file) || ""}
                        alt={file.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 truncate bg-white/95 px-2 py-1 text-[0.7rem] text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
                        {file.name}
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Models */}
            {models.length > 0 && (
              <section className="mb-8">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs text-text-muted">
                    {models.length}
                    {fileCounts.model > models.length ? ` of ${fileCounts.model}` : ""} models
                  </span>
                  {fileCounts.model > models.length && (
                    <a
                      href={`${baseUrl}?view=models`}
                      className="text-xs text-text-muted hover:text-text no-underline"
                    >
                      View all
                    </a>
                  )}
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                  {models.map((file) => (
                    <a
                      key={file.id}
                      href={`/file/${file.path}`}
                      className="group relative aspect-square overflow-hidden border border-border-light bg-[#f9f9f9] transition-colors hover:border-border"
                    >
                      {getFileDisplayUrl(file) ? (
                        <img
                          src={getFileDisplayUrl(file)!}
                          alt={file.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-4xl text-border-light">
                          <span>📦</span>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 truncate bg-white/95 px-2 py-1 text-[0.7rem] text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
                        {file.name}
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Other Files */}
            {otherFiles.length > 0 && (
              <section className="mb-8">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs text-text-muted">{otherFiles.length} other files</span>
                  {fileCounts.all > folderFiles.length && (
                    <a
                      href={`${baseUrl}?view=all`}
                      className="text-xs text-text-muted hover:text-text no-underline"
                    >
                      View all
                    </a>
                  )}
                </div>
                <div>
                  {otherFiles.map((file) => (
                    <a
                      key={file.id}
                      href={`/file/${file.path}`}
                      className="flex items-center gap-2 p-2 border-b border-border-light no-underline text-inherit"
                    >
                      <span className="text-xl">{getFileIcon(file.kind)}</span>
                      <div className="flex-1">
                        <div>{file.name}</div>
                        <div className="text-xs text-text-faint">
                          {file.kind} • {(file.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {childFolders.length === 0 && folderFiles.length === 0 && (
              <div className="text-center p-12 text-text-muted">This folder is empty</div>
            )}
          </>
        )}

        {/* Grid view for textures and models */}
        {isGridView && (
          <FileGrid
            files={searchFiles}
            hasMore={!!nextCursor}
            onLoadMore={loadMore}
            loading={loading}
          />
        )}

        {/* List view for sounds, all */}
        {view !== "folders" && !isGridView && (
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
        isAdmin={!!user.isAdmin}
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
    </>
  );
}
