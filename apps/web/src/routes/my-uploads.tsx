import { useLoaderData } from "react-router";
import type { Route } from "./+types/my-uploads";
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { files, folders } from "~/db";
import { eq, desc } from "drizzle-orm";

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);

  const userFiles = await db
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
    .where(eq(files.uploaderId, user.id))
    .orderBy(desc(files.createdAt));

  // For approved files, load their folder info
  const approvedFolderIds = [
    ...new Set(
      userFiles.filter((f) => f.status === "approved" && f.folderId).map((f) => f.folderId),
    ),
  ];

  const folderMap: Record<string, { name: string; slug: string }> = {};
  for (const folderId of approvedFolderIds) {
    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
      columns: { name: true, slug: true },
    });
    if (folder) {
      folderMap[folderId] = folder;
    }
  }

  const pending = userFiles.filter((f) => f.status === "pending");
  const approved = userFiles.filter((f) => f.status === "approved");
  const rejected = userFiles.filter((f) => f.status === "rejected");

  return { pending, approved, rejected, folderMap };
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
  const { pending, approved, rejected, folderMap } = useLoaderData<typeof loader>();

  const total = pending.length + approved.length + rejected.length;

  if (total === 0) {
    return (
      <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
        <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">My Uploads</h1>
        <p className="text-text-muted">You haven't uploaded any files yet.</p>
      </main>
    );
  }

  return (
    <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
      <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">My Uploads</h1>

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
            Pending &middot; Waiting for review ({pending.length})
          </h2>
          <TextureGrid files={pending as FileRow[]} linkable={false} />
        </section>
      )}

      {approved.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
            Approved ({approved.length})
          </h2>
          {/* Show folder info for approved files */}
          {(() => {
            // Group approved files by folder
            const byFolder: Record<string, FileRow[]> = {};
            for (const file of approved as FileRow[]) {
              const key = file.folderId;
              if (!byFolder[key]) byFolder[key] = [];
              byFolder[key].push(file);
            }

            return Object.entries(byFolder).map(([folderId, folderFiles]) => {
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
            });
          })()}
        </section>
      )}

      {rejected.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-red-800 mb-3">
            Rejected ({rejected.length})
          </h2>
          <TextureGrid files={rejected as FileRow[]} linkable={false} />
        </section>
      )}
    </main>
  );
}
