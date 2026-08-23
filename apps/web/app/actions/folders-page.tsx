import type { Handle } from "remix/ui";

import type { User } from "#db";

import type { FoldersPageData } from "../data/folders-page.ts";
import { routes } from "../routes.ts";
import { BrowseTabs } from "../ui/browse-tabs.tsx";
import { FileCollection } from "../ui/file-collection.tsx";
import { LuckyButton } from "../ui/public/lucky-button.tsx";
import { Page } from "../ui/page.tsx";
import { SearchBar } from "../ui/search-bar.tsx";
import { UploadControl } from "../ui/public/upload-control.tsx";

interface FoldersPageProps {
  data: FoldersPageData;
  user: User;
}

export function FoldersPage(handle: Handle<FoldersPageProps>) {
  return () => {
    const { data, user } = handle.props;
    const search = data.searchResults;
    const nextHref = search?.nextCursor
      ? foldersSearchHref({
          view: data.view,
          query: data.query,
          tag: data.tagSlug,
          cursor: search.nextCursor,
        })
      : null;

    return (
      <Page title="Folders - artbin" user={user}>
        <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-normal">Browse</h1>
            <UploadControl isAdmin={!!user.isAdmin} label="Add" />
          </div>

          <div className="flex items-center justify-between gap-4">
            <BrowseTabs
              baseUrl={routes.folders.href()}
              currentView={data.view}
              counts={data.counts}
            />
            {data.counts.all > 0 ? <LuckyButton sourceLabel="all assets" /> : null}
          </div>

          {data.view === "folders" ? null : (
            <SearchBar
              action={routes.folders.href()}
              currentView={data.view}
              currentQuery={data.query}
              currentTag={data.tagSlug}
              tags={data.tags}
            />
          )}

          {data.view === "folders" ? (
            data.folders.length === 0 ? (
              <div className="text-center p-12 text-text-muted">
                <p>No folders yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                {data.folders.map((folder) => (
                  <a
                    key={folder.id}
                    href={routes.folder.index.href({ path: folder.slug })}
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
                        <span aria-hidden="true">📁</span>
                      </div>
                    )}
                    <div className="px-3 py-2 border-t border-border-light">
                      <div className="font-medium mb-1">{folder.name}</div>
                      <div className="text-xs text-text-muted">
                        {data.folderCounts[folder.id] ?? 0}{" "}
                        {(data.folderCounts[folder.id] ?? 0) === 1 ? "file" : "files"}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )
          ) : (
            <FileCollection
              files={search?.files ?? []}
              grid={data.view === "textures" || data.view === "models"}
              showAudioPlayers={data.view === "sounds"}
              nextHref={nextHref}
            />
          )}
        </main>
      </Page>
    );
  };
}

function foldersSearchHref(input: {
  view: string;
  query: string;
  tag: string | null;
  cursor: string;
}): string {
  const params = new URLSearchParams({ view: input.view, cursor: input.cursor });
  if (input.query) params.set("q", input.query);
  if (input.tag) params.set("tag", input.tag);
  return `${routes.folders.href()}?${params}`;
}
