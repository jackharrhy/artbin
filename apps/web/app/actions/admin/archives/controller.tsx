import { desc, eq } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import type { Handle } from "remix/ui";

import { jobs } from "#db";
import { db } from "#db/connection.server";
import { createJob } from "#lib/jobs.server";
import type { FoundArchive } from "#lib/jobs/scan-archives-job.server";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import { formatSize } from "../../../ui/file-collection.tsx";
import { AutoRefresh } from "../../../ui/public/auto-refresh.tsx";

export default createController(routes.admin.archives, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const recentScan = await db.query.jobs.findFirst({
        where: eq(jobs.type, "scan-archives"),
        orderBy: [desc(jobs.createdAt)],
      });
      let archives: FoundArchive[] = [];
      if (recentScan?.status === "completed" && recentScan.output) {
        try {
          const output = JSON.parse(recentScan.output) as { archives?: FoundArchive[] };
          if (Array.isArray(output.archives)) archives = output.archives;
        } catch {
          // A malformed old scan should not prevent a new scan.
        }
      }
      const scanning = recentScan?.status === "pending" || recentScan?.status === "running";
      const notice = new URL(context.request.url).searchParams.get("notice");

      return context.render(
        <AdminPage user={context.user} active="archives" title="Local archives">
          <AutoRefresh active={scanning} />
          <p className="mb-6 text-text-muted">
            Scan this computer for PAK, PK3, WAD, ZIP, and BSP files, then import selected assets.
          </p>
          {notice ? <div className="alert alert-success mb-4">{notice}</div> : null}
          <section className="card mb-6">
            <div className="flex justify-between items-center gap-4">
              <div>
                <strong>Scan home directory</strong>
                <p className="text-sm text-text-muted m-0">
                  Scan settings control game directories and ignored paths.
                </p>
              </div>
              <form method="post" action={routes.admin.archives.action.href()}>
                <button type="submit" name="intent" value="scan" className="btn btn-primary">
                  {scanning ? "Scan running" : "Scan"}
                </button>
              </form>
            </div>
            {scanning ? (
              <div className="mt-4">
                <div className="w-full h-1.5 bg-bg-subtle overflow-hidden">
                  <div
                    className="h-full bg-[#4CAF50]"
                    style={{ width: `${recentScan?.progress ?? 0}%` }}
                  />
                </div>
                <p className="text-xs text-text-muted mt-2 mb-0">
                  {recentScan?.progressMessage ?? "Starting scan..."}
                </p>
              </div>
            ) : null}
          </section>

          {archives.length ? (
            <>
              <BatchArchiveForm archives={archives} />
              <p className="text-sm text-text-muted mb-3">
                Found {archives.length} archive{archives.length === 1 ? "" : "s"}. Each item can
                also be imported into its own folder.
              </p>
              <div className="flex flex-col gap-3">
                {archives.map((archive) => (
                  <ArchiveCard key={archive.path} archive={archive} />
                ))}
              </div>
            </>
          ) : recentScan?.status === "completed" ? (
            <p className="text-center p-8 text-text-muted">No game archives were found.</p>
          ) : !recentScan ? (
            <p className="text-center p-8 text-text-muted">No scan results yet.</p>
          ) : null}
        </AdminPage>,
      );
    },

    async action(context) {
      if (!context.user) return new Response("Unauthorized", { status: 401 });
      const form = await context.request.formData();
      const intent = text(form.get("intent"));

      if (intent === "scan") {
        await createJob({ type: "scan-archives", input: {}, userId: context.user.id });
        return redirect(withNotice("Archive scan queued."), 303);
      }

      const folderName = text(form.get("folderName")).trim();
      const folderSlug = slug(text(form.get("folderSlug")));
      if (!folderName || !folderSlug) {
        return new Response("A valid folder name and slug are required", { status: 400 });
      }

      if (intent === "import-archive") {
        const archivePath = text(form.get("archivePath"));
        const archiveType = text(form.get("archiveType"));
        if (!archivePath) return new Response("Archive path is required", { status: 400 });
        if (archiveType === "bsp") {
          await createJob({
            type: "extract-bsp",
            input: {
              bspPath: archivePath,
              targetFolderSlug: folderSlug,
              targetFolderName: folderName,
              userId: context.user.id,
            },
            userId: context.user.id,
          });
        } else {
          await createJob({
            type: "extract-archive",
            input: {
              tempFile: archivePath,
              originalName: archivePath.split("/").pop() || "archive",
              targetFolderSlug: folderSlug,
              targetFolderName: folderName,
              userId: context.user.id,
              skipTempCleanup: true,
            },
            userId: context.user.id,
          });
        }
        return redirect(withNotice(`Import queued for ${archivePath.split("/").pop()}.`), 303);
      }

      if (intent === "batch-import") {
        const selected = form
          .getAll("archivePath")
          .filter((value): value is string => typeof value === "string" && value.length > 0);
        if (!selected.length) return new Response("Select at least one archive", { status: 400 });
        const bspPaths = selected.filter((path) => path.toLowerCase().endsWith(".bsp"));
        const archivePaths = selected.filter((path) => !path.toLowerCase().endsWith(".bsp"));

        if (archivePaths.length) {
          await createJob({
            type: "batch-extract-archive",
            input: {
              parentFolderSlug: folderSlug,
              parentFolderName: folderName,
              archives: archivePaths.map((path) => ({
                path,
                subfolderSlug: slug(
                  path
                    .split("/")
                    .pop()
                    ?.replace(/\.[^.]+$/, "") || "archive",
                ),
              })),
              userId: context.user.id,
            },
            userId: context.user.id,
          });
        }
        if (bspPaths.length) {
          await createJob({
            type: "batch-extract-bsp",
            input: {
              parentFolderSlug: folderSlug,
              parentFolderName: folderName,
              bspFiles: bspPaths.map((path) => ({
                path,
                subfolderSlug: slug(
                  path
                    .split("/")
                    .pop()
                    ?.replace(/\.[^.]+$/, "") || "bsp",
                ),
              })),
              userId: context.user.id,
            },
            userId: context.user.id,
          });
        }
        return redirect(
          withNotice(
            `Queued ${selected.length} item${selected.length === 1 ? "" : "s"} for ${folderName}.`,
          ),
          303,
        );
      }

      return new Response("Unknown archive action", { status: 400 });
    },
  },
});

function BatchArchiveForm(handle: Handle<{ archives: FoundArchive[] }>) {
  return () => (
    <form method="post" action={routes.admin.archives.action.href()} className="card mb-6">
      <h2 className="font-medium mb-2">Batch import</h2>
      <p className="text-sm text-text-muted mb-3">
        Select files and import each one as a subfolder of a new collection.
      </p>
      <div className="max-h-64 overflow-auto border border-border-light p-2 mb-4">
        {handle.props.archives.map((archive) => (
          <label key={archive.path} className="flex gap-2 items-start py-1 text-sm">
            <input type="checkbox" name="archivePath" value={archive.path} />
            <span className="font-mono break-all">{archive.path}</span>
          </label>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          Parent folder name
          <input className="input w-full mt-1" name="folderName" required />
        </label>
        <label className="text-sm">
          Folder slug
          <input className="input w-full mt-1" name="folderSlug" pattern="[a-z0-9-]+" required />
        </label>
      </div>
      <button type="submit" name="intent" value="batch-import" className="btn btn-primary mt-4">
        Import selected
      </button>
    </form>
  );
}

function ArchiveCard(handle: Handle<{ archive: FoundArchive }>) {
  return () => {
    const archive = handle.props.archive;
    const defaultName = archive.gameDir
      ? `${archive.gameDir} - ${archive.name.replace(/\.[^.]+$/, "")}`
      : archive.name.replace(/\.[^.]+$/, "");
    return (
      <section className="border border-border-light p-4">
        <div className="flex justify-between gap-3 mb-3">
          <div className="min-w-0">
            <strong className="break-all">{archive.name}</strong>
            <p className="text-xs text-text-muted font-mono break-all">{archive.path}</p>
          </div>
          <span className="text-xs text-text-muted whitespace-nowrap">
            {archive.type.toUpperCase()} · {formatSize(archive.size)}
          </span>
        </div>
        <form
          method="post"
          action={routes.admin.archives.action.href()}
          className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end"
        >
          <input type="hidden" name="archivePath" value={archive.path} />
          <input type="hidden" name="archiveType" value={archive.type} />
          <label className="text-xs text-text-muted">
            Folder name
            <input className="input w-full mt-1" name="folderName" value={defaultName} required />
          </label>
          <label className="text-xs text-text-muted">
            Folder slug
            <input
              className="input w-full mt-1"
              name="folderSlug"
              value={slug(defaultName)}
              pattern="[a-z0-9-]+"
              required
            />
          </label>
          <button type="submit" name="intent" value="import-archive" className="btn btn-primary">
            Import
          </button>
        </form>
      </section>
    );
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function withNotice(notice: string): string {
  const url = new URL(routes.admin.archives.index.href(), "http://artbin.local");
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}
