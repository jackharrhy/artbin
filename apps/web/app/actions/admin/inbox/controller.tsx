import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import type { Handle } from "remix/ui";

import { folders } from "#db";
import { db } from "#db/connection.server";
import { approveSession, getPendingSessionsWithFiles, rejectSession } from "#lib/inbox.server";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import { formatSize } from "../../../ui/file-collection.tsx";

type PendingSession = Awaited<ReturnType<typeof getPendingSessionsWithFiles>>[number];

export default createController(routes.admin.inbox, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);

      const [sessions, allFolders] = await Promise.all([
        getPendingSessionsWithFiles(),
        db.query.folders.findMany({
          where: and(isNull(folders.parentId), sql`substr(${folders.slug}, 1, 1) <> '_'`),
          orderBy: [desc(folders.createdAt)],
        }),
      ]);
      const uploaderMap = new Map<string, string>();
      for (const session of sessions) {
        if (session.uploader) uploaderMap.set(session.uploader.id, session.uploader.username);
      }
      const uploaders = [...uploaderMap].map(([id, username]) => ({ id, username }));
      const totalPendingFiles = sessions.reduce(
        (total, session) => total + session.files.length,
        0,
      );
      const notice = new URL(context.request.url).searchParams.get("notice");

      return context.render(
        <AdminPage user={context.user} active="inbox" title="Upload inbox">
          {notice ? <div className="alert alert-success mb-4">{notice}</div> : null}
          {totalPendingFiles ? (
            <p className="text-sm text-text-muted mb-4">
              {totalPendingFiles} file{totalPendingFiles === 1 ? "" : "s"} in {sessions.length}{" "}
              session{sessions.length === 1 ? "" : "s"}
            </p>
          ) : null}
          {sessions.length > 1 ? <BulkActions folders={allFolders} uploaders={uploaders} /> : null}
          {sessions.length ? (
            <div className="flex flex-col gap-6">
              {sessions.map((session) => (
                <InboxSession key={session.folder.id} session={session} folders={allFolders} />
              ))}
            </div>
          ) : (
            <p className="text-text-muted">No pending uploads.</p>
          )}
        </AdminPage>,
      );
    },

    async action(context) {
      const form = await context.request.formData();
      const intent = text(form.get("intent"));
      const uploaderId = text(form.get("uploaderId")) || null;

      if (intent === "approve-all" || intent === "reject-all") {
        const allSessions = await getPendingSessionsWithFiles();
        const sessions = uploaderId
          ? allSessions.filter((session) => session.uploader?.id === uploaderId)
          : allSessions;
        let changed = 0;
        let skipped = 0;
        let failed = 0;

        if (intent === "approve-all") {
          const destination = await findDestination(form.get("destinationFolderId"));
          if (destination instanceof Response) return destination;
          for (const session of sessions) {
            try {
              const result = await approveSession(
                session.folder.id,
                destination.id,
                destination.slug,
              );
              changed += result.approvedCount;
              skipped += result.skippedCount;
            } catch (error) {
              failed++;
              console.error("Unable to approve upload session", session.folder.id, error);
            }
          }
        } else {
          for (const session of sessions) {
            try {
              changed += (await rejectSession(session.folder.id)).rejectedCount;
            } catch (error) {
              failed++;
              console.error("Unable to reject upload session", session.folder.id, error);
            }
          }
        }

        const verb = intent === "approve-all" ? "Approved" : "Rejected";
        const details = [
          `${verb} ${changed} file${changed === 1 ? "" : "s"} across ${sessions.length} session${sessions.length === 1 ? "" : "s"}.`,
          skipped
            ? `${skipped} missing file record${skipped === 1 ? " was" : "s were"} moved.`
            : "",
          failed ? `${failed} session${failed === 1 ? "" : "s"} failed.` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return redirect(withNotice(details), 303);
      }

      const sessionId = text(form.get("sessionFolderId"));
      if (!sessionId) return new Response("Missing upload session", { status: 400 });

      if (intent === "approve") {
        const destination = await findDestination(form.get("destinationFolderId"));
        if (destination instanceof Response) return destination;
        try {
          const result = await approveSession(sessionId, destination.id, destination.slug);
          return redirect(
            withNotice(
              `Approved ${result.approvedCount} file${result.approvedCount === 1 ? "" : "s"}.${
                result.skippedCount
                  ? ` ${result.skippedCount} missing file record${result.skippedCount === 1 ? " was" : "s were"} moved.`
                  : ""
              }`,
            ),
            303,
          );
        } catch (error) {
          return new Response(
            `Approval failed: ${error instanceof Error ? error.message : String(error)}`,
            { status: 500 },
          );
        }
      }

      if (intent === "reject") {
        const result = await rejectSession(sessionId);
        return redirect(
          withNotice(
            `Rejected ${result.rejectedCount} file${result.rejectedCount === 1 ? "" : "s"}.`,
          ),
          303,
        );
      }

      return new Response("Unknown inbox action", { status: 400 });
    },
  },
});

function BulkActions(
  handle: Handle<{
    folders: Array<typeof folders.$inferSelect>;
    uploaders: Array<{ id: string; username: string }>;
  }>,
) {
  return () => (
    <section className="border border-border-light p-4 mb-6 bg-bg-subtle">
      <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
        Bulk actions
      </h2>
      <form
        method="post"
        action={routes.admin.inbox.action.href()}
        className="flex items-end gap-3 flex-wrap"
      >
        <div>
          <label className="block text-xs text-text-muted mb-1">Destination folder</label>
          <select name="destinationFolderId" className="input">
            <option value="">Select a folder</option>
            {handle.props.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>
        {handle.props.uploaders.length > 1 ? (
          <div>
            <label className="block text-xs text-text-muted mb-1">Filter by uploader</label>
            <select name="uploaderId" className="input">
              <option value="">All uploaders</option>
              {handle.props.uploaders.map((uploader) => (
                <option key={uploader.id} value={uploader.id}>
                  @{uploader.username}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button type="submit" name="intent" value="approve-all" className="btn btn-primary">
          Approve all
        </button>
        <button type="submit" name="intent" value="reject-all" className="btn btn-danger">
          Reject all
        </button>
      </form>
    </section>
  );
}

function InboxSession(
  handle: Handle<{
    session: PendingSession;
    folders: Array<typeof folders.$inferSelect>;
  }>,
) {
  return () => {
    const { session, folders: destinationFolders } = handle.props;
    return (
      <section className="border border-border-light p-4">
        <div className="mb-3 pb-3 border-b border-border-light">
          <p className="text-sm">
            <span className="text-text-muted">Uploaded by </span>
            <strong>{session.uploader ? `@${session.uploader.username}` : "Unknown"}</strong>
            <span className="text-text-muted"> on {formatDate(session.folder.createdAt)}</span>
          </p>
          {session.suggestedFolder ? (
            <p className="text-sm text-text-muted mt-1">
              Suggested folder: <span className="text-text">{session.suggestedFolder.name}</span>
            </p>
          ) : null}
          <p className="text-xs text-text-faint mt-1">
            {session.files.length} file{session.files.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 mb-4">
          {session.files.map((file) => {
            const thumbnail = thumbnailUrl(file);
            return (
              <div key={file.id} className="border border-border-light p-1 text-center">
                {thumbnail ? (
                  <img
                    src={thumbnail}
                    alt={file.name}
                    className="w-full aspect-square object-cover mb-1"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full aspect-square bg-bg-subtle flex items-center justify-center mb-1">
                    <span className="text-xs text-text-faint">{file.kind}</span>
                  </div>
                )}
                <p className="text-xs text-text-muted truncate" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-text-faint">{formatSize(file.size)}</p>
              </div>
            );
          })}
        </div>

        <div className="flex items-end gap-4 pt-3 border-t border-border-light">
          <form
            method="post"
            action={routes.admin.inbox.action.href()}
            className="flex items-end gap-2 flex-1"
          >
            <input type="hidden" name="sessionFolderId" value={session.folder.id} />
            <div className="flex-1">
              <label className="block text-xs text-text-muted mb-1">Destination folder</label>
              <select
                name="destinationFolderId"
                className="input w-full"
                value={session.suggestedFolder?.id ?? ""}
              >
                <option value="">Select a folder</option>
                {destinationFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" name="intent" value="approve" className="btn btn-primary">
              Approve
            </button>
          </form>
          <form method="post" action={routes.admin.inbox.action.href()}>
            <input type="hidden" name="sessionFolderId" value={session.folder.id} />
            <button type="submit" name="intent" value="reject" className="btn btn-danger">
              Reject
            </button>
          </form>
        </div>
      </section>
    );
  };
}

async function findDestination(value: FormDataEntryValue | null) {
  const id = text(value);
  if (!id) return new Response("Please select a destination folder", { status: 400 });
  const folder = await db.query.folders.findFirst({ where: eq(folders.id, id) });
  return folder ?? new Response("Destination folder not found", { status: 404 });
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function withNotice(notice: string): string {
  const url = new URL(routes.admin.inbox.index.href(), "http://artbin.local");
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}

function formatDate(value: Date | null): string {
  return value
    ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Unknown";
}

function thumbnailUrl(file: {
  path: string;
  mimeType: string;
  hasPreview: boolean | null;
}): string | null {
  if (
    ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(file.mimeType)
  ) {
    return `/uploads/${file.path}`;
  }
  return file.hasPreview ? `/uploads/${file.path}.preview.png` : null;
}
