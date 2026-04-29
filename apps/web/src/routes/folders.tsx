import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import { useState, useCallback } from "react";
import { UploadModal } from "~/components/UploadModal";
import type { Route } from "./+types/folders";
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { folders, files, tags } from "~/db";
import { eq, isNull, count, desc, sql, and, not, like } from "drizzle-orm";
import { BrowseTabs, type ViewMode } from "~/components/BrowseTabs";
import { SearchBar } from "~/components/SearchBar";
import { FileGrid } from "~/components/FileGrid";
import { FileList } from "~/components/FileList";
import { searchFiles, getFileCountsByKind } from "~/lib/files.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = context.get(userContext);

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
      where: and(isNull(folders.parentId), not(like(folders.slug, "\\_%"))),
      orderBy: [desc(folders.createdAt)],
    });

    // Use the pre-computed fileCount from the database
    // For root folders, we sum the fileCount of the folder and all its descendants
    const folderCounts: Record<string, number> = {};

    // Get total file counts per root folder (including all descendants)
    // This is a single query that sums all files under each root folder's tree
    for (const folder of rootFolders) {
      // Get all descendant folder IDs using a recursive approach, but cached
      const descendantCounts = await db
        .select({ total: sql<number>`SUM(file_count)` })
        .from(folders)
        .where(sql`slug LIKE ${folder.slug + "%"}`);

      folderCounts[folder.id] = descendantCounts[0]?.total || 0;
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

  // Count root folders for tab (exclude system folders)
  const [{ c: folderCount }] = await db
    .select({ c: count() })
    .from(folders)
    .where(and(isNull(folders.parentId), not(like(folders.slug, "\\_%"))));

  return {
    user,
    view,
    query,
    tagSlug,
    folders: [] as (typeof folders.$inferSelect)[],
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

  // State for upload modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const revalidator = useRevalidator();

  // State for infinite scroll
  const [files, setFiles] = useState(data.searchResults?.files || []);
  const [nextCursor, setNextCursor] = useState(data.searchResults?.nextCursor || null);
  const [loading, setLoading] = useState(false);
  const [prevSearchResults, setPrevSearchResults] = useState(data.searchResults);
  const fetcher = useFetcher();
  const [prevFetcherData, setPrevFetcherData] = useState(fetcher.data);

  // Reset when loader data changes (e.g. view/query navigation)
  if (data.searchResults !== prevSearchResults) {
    setPrevSearchResults(data.searchResults);
    setFiles(data.searchResults?.files || []);
    setNextCursor(data.searchResults?.nextCursor || null);
  }

  // Append results when fetcher completes a new load
  if (fetcher.data !== prevFetcherData) {
    setPrevFetcherData(fetcher.data);
    if (fetcher.data?.searchResults) {
      setFiles((prev: typeof files) => [...prev, ...fetcher.data.searchResults.files]);
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

    fetcher.load(`/folders?${params.toString()}`);
  }, [loading, nextCursor, view, query, tagSlug, fetcher]);

  const isTextureView = view === "textures";
  const isSoundsView = view === "sounds";

  return (
    <>
      <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-normal">Browse</h1>
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
              <div className="text-center p-12 text-text-muted">
                <p>No folders yet</p>
                <p className="mt-4">
                  <button type="button" className="btn" onClick={() => setShowUploadModal(true)}>
                    Import an archive
                  </button>{" "}
                  to create a folder
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                {folders.map((folder) => (
                  <a
                    key={folder.id}
                    href={`/folder/${folder.slug}`}
                    className="block p-0 border border-border-light bg-bg no-underline transition-colors hover:border-border hover:no-underline overflow-hidden"
                  >
                    {folder.previewPath ? (
                      <div className="aspect-square overflow-hidden bg-bg-hover">
                        <img
                          className="w-full h-full object-cover block"
                          src={`/uploads/${folder.previewPath}`}
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
                      <div className="font-medium mb-1">{folder.name}</div>
                      <div className="text-xs text-text-muted">
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
          <FileGrid files={files} hasMore={!!nextCursor} onLoadMore={loadMore} loading={loading} />
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
    </>
  );
}
