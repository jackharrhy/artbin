import type { Handle } from "remix/ui";

import type { User } from "#db";

import type { MyUploadsPageData } from "../data/my-uploads-page.ts";
import { routes } from "../routes.ts";
import { formatSize } from "../ui/file-collection.tsx";
import { Page } from "../ui/page.tsx";

export function MyUploadsPage(handle: Handle<{ data: MyUploadsPageData; user: User }>) {
  return () => {
    const { data, user } = handle.props;
    const total = data.countMap.pending + data.countMap.approved + data.countMap.rejected;
    const grouped = new Map<string, typeof data.files>();
    if (data.status === "approved") {
      for (const file of data.files) {
        const group = grouped.get(file.folderId) ?? [];
        group.push(file);
        grouped.set(file.folderId, group);
      }
    }

    return (
      <Page title="My uploads - artbin" user={user}>
        <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
          <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">My uploads</h1>
          {total === 0 ? (
            <p className="text-text-muted">You haven't uploaded any files yet.</p>
          ) : (
            <>
              <nav className="flex border-b border-border-light mb-6" aria-label="Upload status">
                {(["pending", "approved", "rejected"] as const).map((status) => (
                  <a
                    key={status}
                    href={`${routes.myUploads.href()}?status=${status}`}
                    aria-current={data.status === status ? "page" : undefined}
                    className={`px-4 py-2 text-sm no-underline border-b-2 -mb-px capitalize ${
                      data.status === status
                        ? "border-text text-text font-medium"
                        : "border-transparent text-text-muted"
                    }`}
                  >
                    {status} <span className="text-xs">({data.countMap[status]})</span>
                  </a>
                ))}
              </nav>
              {data.files.length === 0 ? (
                <p className="text-text-muted">No {data.status} uploads.</p>
              ) : data.status === "approved" ? (
                [...grouped].map(([folderId, group]) => (
                  <section key={folderId} className="mb-6">
                    {data.folderMap[folderId] ? (
                      <p className="text-xs text-text-muted mb-2">
                        Folder:{" "}
                        <a
                          href={routes.folder.index.href({ path: data.folderMap[folderId]!.slug })}
                        >
                          {data.folderMap[folderId]!.name}
                        </a>
                      </p>
                    ) : null}
                    <UploadFiles files={group} linkable />
                  </section>
                ))
              ) : (
                <UploadFiles files={data.files} linkable={false} />
              )}
              {data.nextCursor ? (
                <div className="mt-6 text-center">
                  <a
                    href={`${routes.myUploads.href()}?status=${data.status}&cursor=${data.nextCursor}`}
                    className="btn"
                  >
                    Load more
                  </a>
                </div>
              ) : null}
            </>
          )}
        </main>
      </Page>
    );
  };
}

function UploadFiles(handle: Handle<{ files: MyUploadsPageData["files"]; linkable: boolean }>) {
  return () => {
    const { files, linkable } = handle.props;
    const textures = files.filter((file) => file.kind === "texture");
    const others = files.filter((file) => file.kind !== "texture");
    return (
      <>
        {textures.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 mb-3">
            {textures.map((file) => {
              const contents = (
                <>
                  <img
                    src={`/uploads/${file.path}${file.hasPreview ? ".preview.png" : ""}`}
                    alt={file.name}
                    loading="lazy"
                    className="w-full aspect-square object-cover"
                  />
                  <div className="px-2 py-1 border-t border-border-light">
                    <p className="text-xs truncate" title={file.name}>
                      {file.name}
                    </p>
                    <p className="text-xs text-text-faint">{formatSize(file.size)}</p>
                  </div>
                </>
              );
              return linkable ? (
                <a
                  key={file.id}
                  href={routes.file.href({ path: file.path })}
                  className="block border border-border-light bg-bg no-underline overflow-hidden"
                >
                  {contents}
                </a>
              ) : (
                <div key={file.id} className="border border-border-light bg-bg overflow-hidden">
                  {contents}
                </div>
              );
            })}
          </div>
        ) : null}
        {others.map((file) => {
          const contents = (
            <div className="flex items-center gap-2 p-2 border-b border-border-light">
              <span className="text-lg">{fileIcon(file.kind)}</span>
              <div className="flex-1 min-w-0">
                <div className="truncate">{file.name}</div>
                <div className="text-xs text-text-faint">
                  {file.kind} · {formatSize(file.size)}
                </div>
              </div>
            </div>
          );
          return linkable ? (
            <a
              key={file.id}
              href={routes.file.href({ path: file.path })}
              className="block no-underline"
            >
              {contents}
            </a>
          ) : (
            <div key={file.id}>{contents}</div>
          );
        })}
      </>
    );
  };
}

function fileIcon(kind: string | null): string {
  return (
    { texture: "🖼️", model: "📦", audio: "🔊", map: "🗺️", archive: "📁", config: "📄" }[
      kind ?? ""
    ] ?? "📎"
  );
}
