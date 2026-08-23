import type { Handle, RemixNode } from "remix/ui";

import type { User } from "#db";

import type { DirectoryPageData, FolderPageData, WadPageData } from "../../data/folder-page.ts";
import { routes } from "../../routes.ts";
import { BrowseTabs } from "../../ui/browse-tabs.tsx";
import { FileCollection, formatSize } from "../../ui/file-collection.tsx";
import { LuckyButton } from "../../ui/public/lucky-button.tsx";
import { Page } from "../../ui/page.tsx";
import { SearchBar } from "../../ui/search-bar.tsx";
import { UploadControl } from "../../ui/public/upload-control.tsx";

export function FolderRoutePage(handle: Handle<{ data: FolderPageData; user: User }>) {
  return () => {
    const { data, user } = handle.props;
    return data.page === "wad" ? (
      <WadLibraryPage data={data} user={user} />
    ) : (
      <DirectoryPage data={data} user={user} />
    );
  };
}

function DirectoryPage(handle: Handle<{ data: DirectoryPageData; user: User }>) {
  return () => {
    const { data, user } = handle.props;
    const { folder, childFolders, files, wadLibraries, fileCounts } = data;
    const baseUrl = routes.folder.index.href({ path: folder.slug });
    const textures = files.filter((file) => file.kind === "texture");
    const models = files.filter((file) => file.kind === "model");
    const wadIds = new Set(wadLibraries.map((library) => library.id));
    const otherFiles = files.filter(
      (file) => file.kind !== "texture" && file.kind !== "model" && !wadIds.has(file.id),
    );
    const nextHref = data.searchResults?.nextCursor
      ? folderSearchHref(data, data.searchResults.nextCursor)
      : null;
    const moveTargets = data.allFolders.filter(
      (candidate) => candidate.id !== folder.id && !candidate.slug.startsWith(`${folder.slug}/`),
    );

    return (
      <Page title={`${folder.name} - artbin`} user={user}>
        <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
          <Breadcrumb items={data.ancestors} current={folder.name} />

          <div className="flex justify-between items-start gap-4 mb-4 max-md:flex-col">
            <h1 className="text-xl font-normal">{folder.name}</h1>
            <div className="flex gap-2 flex-wrap">
              <a
                href={routes.api.folderDownload.href({ path: folder.slug })}
                className="btn"
                download
              >
                Download ZIP
              </a>
              <UploadControl
                currentFolder={{ id: folder.id, slug: folder.slug, name: folder.name }}
                isAdmin={!!user.isAdmin}
              />
            </div>
          </div>

          {data.remoteImport ? (
            <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
              <span>Imported from</span>
              <a href={data.remoteImport.sourceUrl} target="_blank" rel="noopener noreferrer">
                {providerName(data.remoteImport.provider)}
              </a>
              {data.remoteImport.author ? <span>by {data.remoteImport.author}</span> : null}
              {data.remoteImport.game ? <span>for {data.remoteImport.game}</span> : null}
            </div>
          ) : null}

          {folder.description ? <p className="mb-4 text-text-muted">{folder.description}</p> : null}

          {user.isAdmin ? (
            <AdminFolderControls
              folder={folder}
              action={routes.folder.action.href({ path: folder.slug })}
              moveTargets={moveTargets}
            />
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <BrowseTabs
              baseUrl={baseUrl}
              currentView={data.view}
              counts={{
                folders: fileCounts.folders,
                textures: fileCounts.texture,
                models: fileCounts.model,
                sounds: fileCounts.audio,
                all: fileCounts.all,
              }}
            />
            {fileCounts.all > 0 ? (
              <LuckyButton folderId={folder.id} sourceLabel={folder.name} />
            ) : null}
          </div>

          {data.view === "folders" ? null : (
            <SearchBar
              action={baseUrl}
              currentView={data.view}
              currentQuery={data.query}
              currentTag={data.tagSlug}
              tags={data.tags}
            />
          )}

          {data.view === "folders" ? (
            <FolderContents
              data={data}
              textures={textures}
              models={models}
              otherFiles={otherFiles}
            />
          ) : (
            <FileCollection
              files={data.searchResults?.files ?? []}
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

function AdminFolderControls(
  handle: Handle<{
    folder: DirectoryPageData["folder"];
    action: string;
    moveTargets: DirectoryPageData["allFolders"];
  }>,
) {
  return () => {
    const { folder, action, moveTargets } = handle.props;
    return (
      <details className="card mb-5">
        <summary className="cursor-pointer text-sm font-medium">Manage folder</summary>
        <div className="grid grid-cols-2 gap-6 mt-4 max-md:grid-cols-1">
          <form method="post" action={action}>
            <input type="hidden" name="_action" value="rename" />
            <label className="block text-xs uppercase tracking-wide text-text-muted mb-1">
              Folder name
            </label>
            <div className="flex gap-2">
              <input className="input flex-1" name="name" value={folder.name} required />
              <button className="btn" type="submit">
                Rename
              </button>
            </div>
          </form>
          <form method="post" action={action}>
            <input type="hidden" name="_action" value="move" />
            <label className="block text-xs uppercase tracking-wide text-text-muted mb-1">
              Parent folder
            </label>
            <div className="flex gap-2">
              <select className="input flex-1" name="newParentId">
                <option value="" selected={!folder.parentId}>
                  Root level
                </option>
                {moveTargets.map((candidate) => (
                  <option
                    key={candidate.id}
                    value={candidate.id}
                    selected={folder.parentId === candidate.id}
                  >
                    {candidate.slug}
                  </option>
                ))}
              </select>
              <button className="btn" type="submit">
                Move
              </button>
            </div>
          </form>
          <form method="post" action={action} className="col-span-2 max-md:col-span-1">
            <input type="hidden" name="_action" value="update-description" />
            <label className="block text-xs uppercase tracking-wide text-text-muted mb-1">
              Description
            </label>
            <textarea
              name="description"
              className="input w-full"
              rows={3}
              placeholder="Describe this folder"
              value={folder.description ?? ""}
            />
            <button className="btn mt-2" type="submit">
              Save description
            </button>
          </form>
          <form method="post" action={action} className="col-span-2 max-md:col-span-1">
            <input type="hidden" name="_action" value="delete" />
            <label className="block text-xs uppercase tracking-wide text-danger mb-1">
              Type “{folder.name}” to permanently delete this folder
            </label>
            <div className="flex gap-2">
              <input className="input flex-1" name="confirmName" required />
              <button className="btn btn-danger" type="submit">
                Delete
              </button>
            </div>
          </form>
        </div>
      </details>
    );
  };
}

function FolderContents(
  handle: Handle<{
    data: DirectoryPageData;
    textures: DirectoryPageData["files"];
    models: DirectoryPageData["files"];
    otherFiles: DirectoryPageData["files"];
  }>,
) {
  return () => {
    const { data, textures, models, otherFiles } = handle.props;
    const baseUrl = routes.folder.index.href({ path: data.folder.slug });
    return (
      <>
        {data.childFolders.length || data.wadLibraries.length ? (
          <section className="mb-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
              {data.childFolders.length && data.wadLibraries.length
                ? "Folders and WADs"
                : data.wadLibraries.length
                  ? "WAD libraries"
                  : "Subfolders"}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
              {data.childFolders.map((child) => (
                <FolderCard
                  key={child.id}
                  href={routes.folder.index.href({ path: child.slug })}
                  name={child.name}
                  previewPath={child.previewPath}
                />
              ))}
              {data.wadLibraries.map((library) => (
                <a
                  key={library.id}
                  href={routes.folder.index.href({ path: library.path })}
                  className="block border border-border-light bg-bg no-underline hover:border-border overflow-hidden"
                >
                  {library.previewTextures.length ? (
                    <div className="aspect-square grid grid-cols-2 bg-bg-hover">
                      {library.previewTextures.map((texture) => (
                        <div
                          key={texture.index}
                          className="overflow-hidden border border-border-light"
                        >
                          <img
                            className="w-full h-full object-cover block"
                            src={routes.api.wadTexture.href({
                              fileId: library.id,
                              textureIndex: String(texture.index),
                            })}
                            alt={texture.name}
                            loading="lazy"
                            style={{ imageRendering: "pixelated" }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="aspect-square flex items-center justify-center text-5xl text-border-light">
                      ▦
                    </div>
                  )}
                  <div className="px-3 py-2 border-t border-border-light">
                    <div className="font-medium mb-1">{library.name}</div>
                    <div className="text-xs text-text-muted">
                      {library.version} · {library.textureCount}{" "}
                      {library.textureCount === 1 ? "texture" : "textures"}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {textures.length ? (
          <AssetSection
            title={countLabel(textures.length, data.fileCounts.texture, "texture")}
            viewHref={`${baseUrl}?view=textures`}
            showViewAll={data.fileCounts.texture > textures.length}
          >
            <FileCollection files={textures} grid />
          </AssetSection>
        ) : null}
        {models.length ? (
          <AssetSection
            title={countLabel(models.length, data.fileCounts.model, "model")}
            viewHref={`${baseUrl}?view=models`}
            showViewAll={data.fileCounts.model > models.length}
          >
            <FileCollection files={models} grid />
          </AssetSection>
        ) : null}
        {otherFiles.length ? (
          <AssetSection
            title={`${otherFiles.length} other ${otherFiles.length === 1 ? "file" : "files"}`}
            viewHref={`${baseUrl}?view=all`}
            showViewAll={data.fileCounts.all > data.files.length}
          >
            <FileCollection files={otherFiles} showAudioPlayers />
          </AssetSection>
        ) : null}
        {!data.childFolders.length && !data.files.length ? (
          <div className="text-center p-12 text-text-muted">This folder is empty</div>
        ) : null}
      </>
    );
  };
}

function AssetSection(
  handle: Handle<{
    title: string;
    viewHref: string;
    showViewAll: boolean;
    children?: RemixNode;
  }>,
) {
  return () => (
    <section className="mb-8">
      <div className="flex justify-between items-center mb-4">
        <span className="text-xs text-text-muted">{handle.props.title}</span>
        {handle.props.showViewAll ? (
          <a href={handle.props.viewHref} className="text-xs text-text-muted no-underline">
            View all
          </a>
        ) : null}
      </div>
      {handle.props.children}
    </section>
  );
}

function FolderCard(handle: Handle<{ href: string; name: string; previewPath: string | null }>) {
  return () => (
    <a
      href={handle.props.href}
      className="block border border-border-light bg-bg no-underline hover:border-border overflow-hidden"
    >
      {handle.props.previewPath ? (
        <div className="aspect-square overflow-hidden bg-bg-hover">
          <img
            className="w-full h-full object-cover block"
            src={`/uploads/${handle.props.previewPath}`}
            alt=""
            loading="lazy"
          />
        </div>
      ) : (
        <div className="aspect-square flex items-center justify-center text-5xl text-border-light">
          📁
        </div>
      )}
      <div className="px-3 py-2 border-t border-border-light">
        <div className="font-medium mb-1">{handle.props.name}</div>
      </div>
    </a>
  );
}

function WadLibraryPage(handle: Handle<{ data: WadPageData; user: User }>) {
  return () => {
    const { data, user } = handle.props;
    const query = data.query.toLowerCase();
    const textures = data.contents.textures.filter((texture) =>
      texture.name.toLowerCase().includes(query),
    );
    const libraryHref = routes.folder.index.href({ path: data.file.path });

    return (
      <Page title={`${data.file.name} - artbin`} user={user}>
        <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
          <Breadcrumb items={data.folderTrail} current={data.file.name} />
          <div className="flex items-start justify-between gap-4 mb-5 max-sm:flex-col">
            <div>
              <h1 className="text-xl font-normal mb-1">{data.file.name}</h1>
              <p className="text-sm text-text-muted">
                {data.contents.version} texture library with {data.contents.textures.length}{" "}
                {data.contents.textures.length === 1 ? "texture" : "textures"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data.contents.textures.length ? (
                <LuckyButton
                  wadFileId={data.file.id}
                  sourceLabel={data.file.name}
                  label="Random texture"
                />
              ) : null}
              <a href={`/uploads/${data.file.path}`} className="btn btn-primary" download>
                Download WAD
              </a>
            </div>
          </div>
          <form method="get" action={libraryHref} className="flex items-center gap-2 mb-4">
            <label className="sr-only" htmlFor="wad-search">
              Search WAD textures
            </label>
            <input
              id="wad-search"
              type="search"
              name="q"
              value={data.query}
              className="input w-full max-w-xs"
              placeholder="Search textures"
            />
            <button className="btn" type="submit">
              Search
            </button>
            {data.query ? (
              <a className="btn btn-sm" href={libraryHref}>
                Clear
              </a>
            ) : null}
          </form>
          {textures.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
              {textures.map((texture) => (
                <a
                  key={texture.index}
                  href={routes.file.href({
                    path: `${data.file.path}/${textureFilename(texture, data.contents.textures)}`,
                  })}
                  className="group border border-border-light bg-bg no-underline hover:border-border"
                >
                  <div className="aspect-square overflow-hidden bg-bg-hover">
                    <img
                      src={routes.api.wadTexture.href({
                        fileId: data.file.id,
                        textureIndex: String(texture.index),
                      })}
                      alt={texture.name}
                      loading="lazy"
                      className="w-full h-full object-contain block"
                      style={{ imageRendering: "pixelated" }}
                    />
                  </div>
                  <div className="px-2 py-2 border-t border-border-light">
                    <div className="truncate text-xs text-text">{texture.name}</div>
                    <div className="text-[0.68rem] text-text-faint">
                      {texture.width} × {texture.height}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="border border-border-light p-12 text-center text-text-muted">
              No textures match this search.
            </div>
          )}
          <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-text-muted">Original file</dt>
            <dd>
              <code className="text-xs">{data.file.path}</code>
            </dd>
            <dt className="text-text-muted">Size</dt>
            <dd>{formatSize(data.file.size)}</dd>
            <dt className="text-text-muted">Format</dt>
            <dd>{data.contents.version}</dd>
          </dl>
        </main>
      </Page>
    );
  };
}

function Breadcrumb(
  handle: Handle<{
    items: Array<{ id: string; name: string; slug: string }>;
    current: string;
  }>,
) {
  return () => (
    <div className="text-xs text-text-muted mb-4">
      <a className="text-text-muted hover:text-text" href={routes.folders.href()}>
        Folders
      </a>
      {handle.props.items.map((item) => (
        <span key={item.id}>
          <span className="mx-2">/</span>
          <a
            className="text-text-muted hover:text-text"
            href={routes.folder.index.href({ path: item.slug })}
          >
            {item.name}
          </a>
        </span>
      ))}
      <span className="mx-2">/</span>
      <span>{handle.props.current}</span>
    </div>
  );
}

function providerName(provider: string): string {
  return provider === "gamebanana"
    ? "GameBanana"
    : provider === "scmapdb"
      ? "SCMapDB"
      : "direct archive";
}

function folderSearchHref(data: DirectoryPageData, cursor: string): string {
  const params = new URLSearchParams({ view: data.view, cursor });
  if (data.query) params.set("q", data.query);
  if (data.tagSlug) params.set("tag", data.tagSlug);
  return `${routes.folder.index.href({ path: data.folder.slug })}?${params}`;
}

function countLabel(visible: number, total: number, noun: string): string {
  const count = Math.max(visible, total);
  return `${visible}${total > visible ? ` of ${total}` : ""} ${count === 1 ? noun : `${noun}s`}`;
}

function textureFilename(
  texture: { index: number; name: string },
  textures: Array<{ index: number; name: string }>,
): string {
  const duplicate = textures.some(
    (candidate) =>
      candidate.index !== texture.index &&
      candidate.name.toLowerCase() === texture.name.toLowerCase(),
  );
  return `${texture.name}${duplicate ? `~${texture.index}` : ""}.png`;
}
