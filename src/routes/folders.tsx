import { useLoaderData, redirect, useFetcher, useRevalidator } from "react-router";
import { useState, useCallback, useEffect } from "react";
import { UploadModal } from "~/components/UploadModal";
import type { Route } from "./+types/folders";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, files, tags } from "~/db";
import { eq, isNull, count, desc } from "drizzle-orm";
import { Header } from "~/components/Header";
import { BrowseTabs, type ViewMode } from "~/components/BrowseTabs";
import { SearchBar } from "~/components/SearchBar";
import { FileGrid } from "~/components/FileGrid";
import { FileList } from "~/components/FileList";
import { searchFiles, getFileCountsByKind } from "~/lib/files.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const url = new URL(request.url);
  const view = (url.searchParams.get("view") || "folders") as ViewMode;
  const query = url.searchParams.get("q") || "";
  const tagSlug = url.searchParams.get("tag") || null;
  const cursor = url.searchParams.get("cursor") || undefined;

  // Get file counts for tabs
  const fileCounts = await getFileCountsByKind();

  // Get all tags for filter dropdown
  const allTags = await db.query.tags.findMany({
    orderBy: [tags.name],
  });

  // If viewing folders, load folder data
  if (view === "folders") {
    const rootFolders = await db.query.folders.findMany({
      where: isNull(folders.parentId),
      orderBy: [desc(folders.createdAt)],
    });

    // Get file counts for each folder (including descendants)
    const folderCounts: Record<string, number> = {};

    async function countFilesRecursive(folderId: string): Promise<number> {
      const [{ c }] = await db
        .select({ c: count() })
        .from(files)
        .where(eq(files.folderId, folderId));

      const childFolders = await db.query.folders.findMany({
        where: eq(folders.parentId, folderId),
      });

      let total = c;
      for (const child of childFolders) {
        total += await countFilesRecursive(child.id);
      }

      return total;
    }

    for (const folder of rootFolders) {
      folderCounts[folder.id] = await countFilesRecursive(folder.id);
    }

    // Count root folders
    const folderCount = rootFolders.length;

    return {
      user,
      view,
      query,
      tagSlug,
      folders: rootFolders,
      folderCounts,
      fileCounts: { ...fileCounts, folders: folderCount } as Record<string, number>,
      tags: allTags,
      searchResults: null as any,
    };
  }

  // Otherwise, search files by kind
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
    cursor,
    limit: 50,
  });

  // Count root folders for tab
  const [{ c: folderCount }] = await db
    .select({ c: count() })
    .from(folders)
    .where(isNull(folders.parentId));

  return {
    user,
    view,
    query,
    tagSlug,
    folders: [] as typeof folders.$inferSelect[],
    folderCounts: {} as Record<string, number>,
    fileCounts: { ...fileCounts, folders: folderCount } as Record<string, number>,
    tags: allTags,
    searchResults,
  };
}

export function meta() {
  return [{ title: "Folders - artbin" }];
}

export default function Folders() {
  const data = useLoaderData<typeof loader>();
  const { user, view, query, tagSlug, folders, folderCounts, fileCounts, tags } = data;

  // State for infinite scroll
  const [files, setFiles] = useState(data.searchResults?.files || []);
  const [nextCursor, setNextCursor] = useState(data.searchResults?.nextCursor || null);
  const [loading, setLoading] = useState(false);
  const fetcher = useFetcher();

  // Reset files when view/query changes
  useEffect(() => {
    setFiles(data.searchResults?.files || []);
    setNextCursor(data.searchResults?.nextCursor || null);
  }, [data.searchResults]);

  // Handle fetcher response for infinite scroll
  useEffect(() => {
    if (fetcher.data?.searchResults) {
      setFiles((prev: typeof files) => [...prev, ...fetcher.data.searchResults.files]);
      setNextCursor(fetcher.data.searchResults.nextCursor);
      setLoading(false);
    }
  }, [fetcher.data]);

  const loadMore = useCallback(() => {
    if (loading || !nextCursor) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("view", view);
    if (query) params.set("q", query);
    if (tagSlug) params.set("tag", tagSlug);
    params.set("cursor", nextCursor);

    fetcher.load(`/folders?${params.toString()}`);
  }, [loading, nextCursor, view, query, tagSlug, fetcher]);

  const isTextureView = view === "textures";
  const isSoundsView = view === "sounds";
  
  const [showUploadModal, setShowUploadModal] = useState(false);
  const revalidator = useRevalidator();

  return (
    <div>
      <Header user={user} onUploadClick={() => setShowUploadModal(true)} />
      <main className="main-content">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h1 className="page-title" style={{ marginBottom: 0, borderBottom: "none" }}>
            Browse
          </h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowUploadModal(true)}
          >
            Add
          </button>
        </div>

        <BrowseTabs
          baseUrl="/folders"
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
            baseUrl="/folders"
            currentView={view}
            currentQuery={query}
            currentTag={tagSlug}
            tags={tags}
            placeholder={`Search ${view}...`}
          />
        )}

        {/* Folder view */}
        {view === "folders" && (
          <>
            {folders.length === 0 ? (
              <div className="empty-state">
                <p>No folders yet</p>
                <p style={{ marginTop: "1rem" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowUploadModal(true)}
                  >
                    Import an archive
                  </button>{" "}
                  to create a folder
                </p>
              </div>
            ) : (
              <div className="folder-grid">
                {folders.map((folder) => (
                  <a
                    key={folder.id}
                    href={`/folder/${folder.slug}`}
                    className="folder-card folder-card-with-preview"
                  >
                    {folder.previewPath ? (
                      <div className="folder-preview">
                        <img 
                          src={`/uploads/${folder.previewPath}`} 
                          alt="" 
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="folder-preview folder-preview-empty">
                        <span>📁</span>
                      </div>
                    )}
                    <div className="folder-info">
                      <div className="folder-name">{folder.name}</div>
                      <div className="folder-meta">
                        {folderCounts[folder.id] || 0} files
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </>
        )}

        {/* Texture grid view */}
        {isTextureView && (
          <FileGrid
            files={files}
            hasMore={!!nextCursor}
            onLoadMore={loadMore}
            loading={loading}
          />
        )}

        {/* List view for models, sounds, all */}
        {view !== "folders" && !isTextureView && (
          <FileList
            files={files}
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
        currentFolder={null}
        onSuccess={() => revalidator.revalidate()}
      />
    </div>
  );
}
