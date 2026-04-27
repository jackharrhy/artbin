import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.import";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db } from "~/db/connection.server";
import { files, folders } from "~/db";
import { count, sum, eq } from "drizzle-orm";
import { createJob } from "~/lib/jobs.server";
import { existsSync } from "fs";
import { stat } from "fs/promises";
import { basename } from "path";

// Import sources configuration
const IMPORT_SOURCES = [
  {
    id: "texturetown",
    name: "TextureTown",
    description: "textures.neocities.org - 3800+ retro game textures",
    url: "https://textures.neocities.org/",
  },
  {
    id: "texture-station",
    name: "Texture Station",
    description: "thejang.com/textures - 392 classic tiling backgrounds from 1996",
    url: "https://thejang.com/textures/",
  },
  {
    id: "sadgrl",
    name: "Sadgrl Tiled Backgrounds",
    description: "sadgrl.online archive - 500+ tiled backgrounds organized by color",
    url: "https://sadgrlonline.github.io/archived-sadgrl.online/webmastery/downloads/tiledbgs.html",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/folders");
  }

  // Get current counts and sizes
  const [[{ total: fileCount }], [{ total: folderCount }], [{ total: totalSize }]] =
    await Promise.all([
      db.select({ total: count() }).from(files),
      db.select({ total: count() }).from(folders),
      db.select({ total: sum(files.size) }).from(files),
    ]);

  // Get size by kind
  const sizeByKind = await db
    .select({
      kind: files.kind,
      size: sum(files.size),
      count: count(),
    })
    .from(files)
    .groupBy(files.kind);

  return {
    user,
    sources: IMPORT_SOURCES,
    stats: {
      fileCount,
      folderCount,
      totalSize: Number(totalSize) || 0,
      byKind: sizeByKind.map((k) => ({
        kind: k.kind,
        size: Number(k.size) || 0,
        count: k.count,
      })),
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // TextureTown import
  if (intent === "texturetown") {
    const job = await createJob({
      type: "texturetown-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "texturetown" };
  }

  // Texture Station import
  if (intent === "texture-station") {
    const job = await createJob({
      type: "texture-station-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "texture-station" };
  }

  // Sadgrl import
  if (intent === "sadgrl") {
    const job = await createJob({
      type: "sadgrl-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "sadgrl" };
  }

  // Folder import
  if (intent === "folder-import") {
    const folderPath = formData.get("folderPath") as string;
    const folderName = formData.get("folderName") as string;

    if (!folderPath || !folderPath.trim()) {
      return { error: "Please enter a folder path" };
    }

    // Validate the path exists and is a directory
    if (!existsSync(folderPath)) {
      return { error: `Path does not exist: ${folderPath}` };
    }

    try {
      const stats = await stat(folderPath);
      if (!stats.isDirectory()) {
        return { error: `Path is not a directory: ${folderPath}` };
      }
    } catch {
      return { error: `Cannot access path: ${folderPath}` };
    }

    // Generate slug from folder name or path
    const name = folderName?.trim() || basename(folderPath);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const job = await createJob({
      type: "folder-import",
      input: {
        sourcePath: folderPath,
        targetFolderSlug: slug,
        targetFolderName: name,
        userId: user.id,
      },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "folder-import", folderName: name };
  }

  return { error: "Unknown action" };
}

export function meta() {
  return [{ title: "Import - Admin - artbin" }];
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    texture: "Textures",
    audio: "Audio",
    model: "Models",
    map: "Maps",
    archive: "Archives",
    config: "Configs",
    other: "Other",
  };
  return labels[kind] || kind;
}

export default function AdminImport() {
  const { user, sources, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <main className="max-w-[900px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
        <div className="text-xs text-text-muted mb-4">
          <a className="text-text-muted hover:text-text" href="/folders">
            Folders
          </a>
          <span className="mx-2">/</span>
          <a className="text-text-muted hover:text-text" href="/admin/jobs">
            Admin
          </a>
          <span className="mx-2">/</span>
          <span>Import</span>
        </div>

        <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">Import</h1>

        {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}

        {actionData?.success && actionData.action === "texturetown" && (
          <div className="alert alert-success">
            <p>
              <strong>TextureTown import started!</strong>
            </p>
            <p>
              <a href="/admin/jobs">View job progress</a>
            </p>
          </div>
        )}

        {actionData?.success && actionData.action === "texture-station" && (
          <div className="alert alert-success">
            <p>
              <strong>Texture Station import started!</strong>
            </p>
            <p>
              <a href="/admin/jobs">View job progress</a>
            </p>
          </div>
        )}

        {actionData?.success && actionData.action === "sadgrl" && (
          <div className="alert alert-success">
            <p>
              <strong>Sadgrl Tiled Backgrounds import started!</strong>
            </p>
            <p>
              <a href="/admin/jobs">View job progress</a>
            </p>
          </div>
        )}

        {actionData?.success && actionData.action === "folder-import" && (
          <div className="alert alert-success">
            <p>
              <strong>Folder import started: {actionData.folderName}</strong>
            </p>
            <p>
              <a href="/admin/jobs">View job progress</a>
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="card mb-6">
          <h2 className="font-medium mb-2">Current Stats</h2>
          <dl className="detail-info">
            <dt>Total Files</dt>
            <dd>{stats.fileCount.toLocaleString()}</dd>
            <dt>Total Size</dt>
            <dd>{formatSize(stats.totalSize)}</dd>
            <dt>Total Folders</dt>
            <dd>{stats.folderCount.toLocaleString()}</dd>
          </dl>

          {stats.byKind.length > 0 && (
            <div className="mt-4 pt-4 border-t border-bg-subtle">
              <h3 className="font-medium text-sm mb-2">By Type</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                {stats.byKind
                  .sort((a, b) => b.size - a.size)
                  .map((k) => (
                    <div key={k.kind} className="text-[0.8125rem]">
                      <span className="text-text-muted">{kindLabel(k.kind)}</span>
                      <br />
                      <span>{k.count.toLocaleString()} files</span>
                      <br />
                      <span className="text-text-faint">{formatSize(k.size)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Local Folder Import */}
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
            Local Folder
          </h2>

          <div className="card mb-4">
            <h3 className="font-medium mb-2">Import from Folder Path</h3>
            <p className="text-sm text-text-muted mb-4">
              Recursively import all supported files from a local folder (images, audio, models,
              etc.)
            </p>

            <Form method="post">
              <input type="hidden" name="intent" value="folder-import" />

              <div className="mb-3">
                <label className="block text-sm mb-1">Folder Path</label>
                <input
                  type="text"
                  name="folderPath"
                  placeholder="/path/to/game/assets"
                  className="input w-full font-mono"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm mb-1">Collection Name (optional)</label>
                <input
                  type="text"
                  name="folderName"
                  placeholder="Leave blank to use folder name"
                  className="input w-full"
                />
              </div>

              <div className="flex justify-between items-center">
                <span className="text-xs text-text-faint">
                  Supports: png, jpg, tga, bmp, wav, ogg, mp3, obj, md5mesh, etc.
                </span>
                <button
                  type="submit"
                  className="btn btn-primary"
                  onClick={(e) => {
                    const form = e.currentTarget.form;
                    const pathInput = form?.querySelector(
                      'input[name="folderPath"]',
                    ) as HTMLInputElement;
                    if (!pathInput?.value.trim()) {
                      e.preventDefault();
                      alert("Please enter a folder path");
                      return;
                    }
                    if (
                      !confirm(
                        `Import all supported files from:\n${pathInput.value}\n\nThis may take a while for large folders.`,
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  Import Folder
                </button>
              </div>
            </Form>
          </div>
        </section>

        {/* Local Archives */}
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
            Local Archives
          </h2>

          <div className="card mb-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h3 className="font-medium mb-1">Scan & Import Local Archives</h3>
                <p className="text-sm text-text-muted m-0">
                  Find PAK, PK3, WAD, and ZIP files in game directories on this computer
                </p>
              </div>
              <div className="flex gap-2">
                <a href="/admin/scan-settings" className="btn">
                  Settings
                </a>
                <a href="/admin/archives" className="btn btn-primary">
                  Browse Archives
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Online Sources */}
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
            Online Sources
          </h2>

          {sources.map((source) => (
            <div key={source.id} className="card mb-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="font-medium mb-1">
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.name}
                    </a>
                  </h3>
                  <p className="text-sm text-text-muted m-0">{source.description}</p>
                </div>

                <Form method="post">
                  <input type="hidden" name="intent" value={source.id} />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    onClick={(e) => {
                      if (!confirm(`Start importing from ${source.name}? This may take a while.`)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Import All
                  </button>
                </Form>
              </div>
            </div>
          ))}
        </section>

        <p className="mt-8 text-sm text-text-muted">
          <a href="/admin/jobs">View Jobs</a> | <a href="/folders">Browse Folders</a>
        </p>
    </main>
  );
}
