import { useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/my-uploads";
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { files, folders } from "~/db";
import { eq, desc, and, sql, lt, or } from "drizzle-orm";

const PAGE_SIZE = 60;

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  const url = new URL(request.url);
  const validStatuses = ["pending", "approved", "rejected"] as const;
  type FileStatus = (typeof validStatuses)[number];
  const rawStatus = url.searchParams.get("status") || "pending";
  const status: FileStatus = validStatuses.includes(rawStatus as FileStatus)
    ? (rawStatus as FileStatus)
    : "pending";
  const cursor = url.searchParams.get("cursor") || undefined;

  // Counts per status (always load these for the tabs)
  const counts = await db
    .select({ status: files.status, count: sql<number>`count(*)` })
    .from(files)
    .where(eq(files.uploaderId, user.id))
    .groupBy(files.status);

  const countMap: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const row of counts) {
    if (row.status) countMap[row.status] = row.count;
  }

  // Build query for current status tab
  const conditions: any[] = [eq(files.uploaderId, user.id), eq(files.status, status)];

  if (cursor) {
    const cursorFile = await db.query.files.findFirst({ where: eq(files.id, cursor) });
    if (cursorFile?.createdAt) {
      conditions.push(
        or(
          lt(files.createdAt, cursorFile.createdAt),
          and(eq(files.createdAt, cursorFile.createdAt), lt(files.id, cursor)),
        ),
      );
    }
  }

  const pageFiles = await db
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
      status: files.status,
      folderId: files.folderId,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(and(...conditions))
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = pageFiles.length > PAGE_SIZE;
  const displayFiles = hasMore ? pageFiles.slice(0, PAGE_SIZE) : pageFiles;
  const nextCursor = hasMore ? displayFiles[displayFiles.length - 1].id : null;

  // For approved files, load their folder info
  const folderMap: Record<string, { name: string; slug: string }> = {};
  if (status === "approved") {
    const folderIds = [...new Set(displayFiles.map((f) => f.folderId))];
    for (const folderId of folderIds) {
      const folder = await db.query.folders.findFirst({
        where: eq(folders.id, folderId),
        columns: { name: true, slug: true },
      });
      if (folder) {
        folderMap[folderId] = folder;
      }
    }
  }

  return { files: displayFiles, countMap, status, nextCursor, folderMap };
}

export function meta() {
  return [{ title: "My Uploads - artbin" }];
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function thumbnailUrl(file: {
  path: string;
  kind: string | null;
  hasPreview: boolean | null;
}): string | null {
  if (file.kind !== "texture") return null;
  if (file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return `/uploads/${file.path}`;
}

function getFileIcon(kind: string | null): string {
  switch (kind) {
    case "texture":
      return "🖼️";
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

type FileRow = {
  id: string;
  path: string;
  name: string;
  kind: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  hasPreview: boolean | null;
  status: string;
  folderId: string;
  createdAt: Date | null;
};

function TextureGrid({ files, linkable }: { files: FileRow[]; linkable: boolean }) {
  const textures = files.filter((f) => f.kind === "texture");
  const others = files.filter((f) => f.kind !== "texture");

  return (
    <>
      {textures.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 mb-3">
          {textures.map((file) => {
            const thumb = thumbnailUrl(file);
            const inner = (
              <>
                {thumb ? (
                  <img
                    src={thumb}
                    alt={file.name}
                    loading="lazy"
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div className="w-full aspect-square bg-bg-hover flex items-center justify-center">
                    <span className="text-xs text-text-faint">texture</span>
                  </div>
                )}
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
                href={`/file/${file.path}`}
                className="block border border-border-light bg-bg no-underline transition-colors hover:border-border overflow-hidden"
              >
                {inner}
              </a>
            ) : (
              <div key={file.id} className="border border-border-light bg-bg overflow-hidden">
                {inner}
              </div>
            );
          })}
        </div>
      )}
      {others.length > 0 && (
        <div>
          {others.map((file) => {
            const inner = (
              <div className="flex items-center gap-2 p-2 border-b border-border-light">
                <span className="text-lg">{getFileIcon(file.kind)}</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{file.name}</div>
                  <div className="text-xs text-text-faint">
                    {file.kind} &middot; {formatSize(file.size)}
                  </div>
                </div>
              </div>
            );

            return linkable ? (
              <a
                key={file.id}
                href={`/file/${file.path}`}
                className="block no-underline text-inherit hover:bg-bg-hover"
              >
                {inner}
              </a>
            ) : (
              <div key={file.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function MyUploads() {
  const {
    files: pageFiles,
    countMap,
    status,
    nextCursor,
    folderMap,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const total = countMap.pending + countMap.approved + countMap.rejected;

  const tabs: { key: string; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: countMap.pending },
    { key: "approved", label: "Approved", count: countMap.approved },
    { key: "rejected", label: "Rejected", count: countMap.rejected },
  ];

  const linkable = status === "approved";

  // Group approved files by folder
  const groupedByFolder = (() => {
    if (status !== "approved") return null;
    const byFolder: Record<string, FileRow[]> = {};
    for (const file of pageFiles as FileRow[]) {
      const key = file.folderId;
      if (!byFolder[key]) byFolder[key] = [];
      byFolder[key].push(file);
    }
    return byFolder;
  })();

  return (
    <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
      <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">My Uploads</h1>

      {total === 0 ? (
        <p className="text-text-muted">You haven't uploaded any files yet.</p>
      ) : (
        <>
          {/* Status tabs */}
          <div className="flex gap-0 border-b border-border-light mb-6">
            {tabs.map((tab) => (
              <a
                key={tab.key}
                href={`/my-uploads?status=${tab.key}`}
                className={`px-4 py-2 text-sm no-underline border-b-2 -mb-px ${
                  status === tab.key
                    ? "border-text text-text font-medium"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 text-xs text-text-faint">({tab.count})</span>
                )}
              </a>
            ))}
          </div>

          {pageFiles.length === 0 ? (
            <p className="text-text-muted">No {status} uploads.</p>
          ) : groupedByFolder ? (
            // Approved: group by folder
            Object.entries(groupedByFolder).map(([folderId, folderFiles]) => {
              const folder = folderMap[folderId];
              return (
                <div key={folderId} className="mb-4">
                  {folder && (
                    <p className="text-xs text-text-muted mb-2">
                      in{" "}
                      <a
                        href={`/folder/${folder.slug}`}
                        className="text-text-muted hover:text-text"
                      >
                        {folder.name}
                      </a>
                    </p>
                  )}
                  <TextureGrid files={folderFiles} linkable={true} />
                </div>
              );
            })
          ) : (
            <TextureGrid files={pageFiles as FileRow[]} linkable={linkable} />
          )}

          {/* Pagination */}
          {nextCursor && (
            <div className="mt-6 text-center">
              <a href={`/my-uploads?status=${status}&cursor=${nextCursor}`} className="btn">
                Load more
              </a>
            </div>
          )}
        </>
      )}
    </main>
  );
}
