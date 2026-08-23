import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { count, sql, sum } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { files, folders } from "#db";
import { db } from "#db/connection.server";
import { createJob } from "#lib/jobs.server";
import { queueRemoteImports } from "#lib/remote-import-queue.server";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import { formatSize } from "../../../ui/file-collection.tsx";

const sources = [
  {
    id: "texturetown",
    name: "TextureTown",
    description: "3,800+ retro game textures from textures.neocities.org",
    url: "https://textures.neocities.org/",
  },
  {
    id: "texture-station",
    name: "Texture Station",
    description: "Classic tiling backgrounds from thejang.com",
    url: "https://thejang.com/textures/",
  },
  {
    id: "sadgrl",
    name: "Sadgrl Tiled Backgrounds",
    description: "Tiled backgrounds organized by color",
    url: "https://sadgrlonline.github.io/archived-sadgrl.online/webmastery/downloads/tiledbgs.html",
  },
] as const;

export default createController(routes.admin.import, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const [[fileStats], [folderStats], byKind, destinationFolders] = await Promise.all([
        db.select({ count: count(), size: sum(files.size) }).from(files),
        db.select({ count: count() }).from(folders),
        db
          .select({ kind: files.kind, size: sum(files.size), count: count() })
          .from(files)
          .groupBy(files.kind),
        db.query.folders.findMany({
          where: sql`substr(${folders.slug}, 1, 1) <> '_'`,
          orderBy: (table, { asc }) => [asc(table.slug)],
        }),
      ]);

      return context.render(
        <AdminPage user={context.user} active="import" title="Import">
          <section className="card mb-6">
            <h2 className="font-medium mb-2">Current stats</h2>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt>Total files</dt>
              <dd>{fileStats?.count ?? 0}</dd>
              <dt>Total size</dt>
              <dd>{formatSize(Number(fileStats?.size) || 0)}</dd>
              <dt>Total folders</dt>
              <dd>{folderStats?.count ?? 0}</dd>
            </dl>
            <div className="mt-4 flex gap-4 flex-wrap text-xs text-text-muted">
              {byKind.map((kind) => (
                <span key={kind.kind}>
                  {kind.kind}: {kind.count} ({formatSize(Number(kind.size) || 0)})
                </span>
              ))}
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
              Import from site
            </h2>
            <form method="post" action={routes.admin.import.action.href()} className="card">
              <input type="hidden" name="intent" value="remote-site-import" />
              <p className="text-sm text-text-muted mb-4">
                Paste GameBanana or SCMapDB pages, or direct HTTPS links to ZIP, 7z, and RAR
                archives. Enter one URL per line, up to 20 at a time.
              </p>
              <label className="block text-sm mb-1" htmlFor="source-urls">
                Source URLs
              </label>
              <textarea
                id="source-urls"
                name="sourceUrls"
                rows={5}
                required
                className="input w-full font-mono"
                placeholder="https://gamebanana.com/mods/140244"
              />
              <label className="block text-sm mt-3 mb-1" htmlFor="import-target">
                Destination folder
              </label>
              <select id="import-target" name="targetFolderId" className="input w-full">
                <option value="">Top level</option>
                {destinationFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.slug}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-primary mt-4">
                Queue imports
              </button>
            </form>
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
              Local folder
            </h2>
            <form method="post" action={routes.admin.import.action.href()} className="card">
              <input type="hidden" name="intent" value="folder-import" />
              <label className="block text-sm mb-1">Folder path</label>
              <input className="input w-full font-mono" name="folderPath" required />
              <label className="block text-sm mt-3 mb-1">Collection name (optional)</label>
              <input className="input w-full" name="folderName" />
              <button type="submit" className="btn btn-primary mt-4">
                Import folder
              </button>
            </form>
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
              Local archives
            </h2>
            <div className="card flex justify-between items-center gap-4">
              <p className="text-sm text-text-muted">
                Scan and import PAK, PK3, WAD, ZIP, and BSP files on this computer.
              </p>
              <a href={routes.admin.archives.index.href()} className="btn btn-primary">
                Browse archives
              </a>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
              Maintenance
            </h2>
            <form method="post" action={routes.admin.import.action.href()} className="card">
              <input type="hidden" name="intent" value="regenerate-previews" />
              <p className="text-sm text-text-muted mb-3">
                Generate missing model previews and refresh folder preview images.
              </p>
              <button className="btn" type="submit">
                Regenerate previews
              </button>
            </form>
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
              Online sources
            </h2>
            {sources.map((source) => (
              <form
                key={source.id}
                method="post"
                action={routes.admin.import.action.href()}
                className="card mb-4 flex justify-between items-start gap-4"
              >
                <input type="hidden" name="intent" value={source.id} />
                <div>
                  <h3 className="font-medium">
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.name}
                    </a>
                  </h3>
                  <p className="text-sm text-text-muted">{source.description}</p>
                </div>
                <button type="submit" className="btn">
                  Import all
                </button>
              </form>
            ))}
          </section>
        </AdminPage>,
      );
    },

    async action(context) {
      const user = context.user;
      if (!user) return new Response("Unauthorized", { status: 401 });
      const form = await context.request.formData();
      const intent = form.get("intent");

      if (intent === "remote-site-import") {
        try {
          await queueRemoteImports({
            sourceUrls: stringValue(form.get("sourceUrls")),
            targetFolderId: stringValue(form.get("targetFolderId")) || null,
            userId: user.id,
          });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : "Invalid import URL", {
            status: 400,
          });
        }
      } else if (intent === "folder-import") {
        const folderPath = stringValue(form.get("folderPath")).trim();
        if (!folderPath || !existsSync(folderPath)) {
          return new Response("The source folder does not exist", { status: 400 });
        }
        const metadata = await stat(folderPath).catch(() => null);
        if (!metadata?.isDirectory()) {
          return new Response("The source path is not a directory", { status: 400 });
        }
        const name = stringValue(form.get("folderName")).trim() || basename(folderPath);
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (!slug) return new Response("Collection name is invalid", { status: 400 });
        await createJob({
          type: "folder-import",
          input: {
            sourcePath: folderPath,
            targetFolderSlug: slug,
            targetFolderName: name,
            userId: user.id,
          },
          userId: user.id,
        });
      } else if (intent === "regenerate-previews") {
        await createJob({
          type: "regenerate-previews",
          input: { userId: user.id, includeModels: true },
          userId: user.id,
        });
      } else if (intent === "texturetown" || intent === "texture-station" || intent === "sadgrl") {
        const type =
          intent === "texturetown"
            ? "texturetown-import"
            : intent === "texture-station"
              ? "texture-station-import"
              : "sadgrl-import";
        await createJob({ type, input: { userId: user.id }, userId: user.id });
      } else {
        return new Response("Unknown import action", { status: 400 });
      }

      return redirect(routes.admin.jobs.index.href(), 303);
    },
  },
});

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
