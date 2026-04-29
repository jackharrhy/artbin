import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.inbox";
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { folders } from "~/db";
import { isNull, not, like, and, desc, eq } from "drizzle-orm";
import { getPendingSessionsWithFiles, approveSession, rejectSession } from "~/lib/inbox.server";

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);

  if (!user.isAdmin) {
    throw redirect("/");
  }

  const [sessions, allFolders] = await Promise.all([
    getPendingSessionsWithFiles(),
    db.query.folders.findMany({
      where: and(isNull(folders.parentId), not(like(folders.slug, "\\_%"))),
      orderBy: [desc(folders.createdAt)],
    }),
  ]);

  // Get unique uploaders for the filter dropdown
  const uploaderMap = new Map<string, string>();
  for (const session of sessions) {
    if (session.uploader) {
      uploaderMap.set(session.uploader.id, session.uploader.username);
    }
  }
  const uploaders = Array.from(uploaderMap.entries()).map(([id, username]) => ({ id, username }));

  const totalPendingFiles = sessions.reduce((sum, s) => sum + s.files.length, 0);

  return { sessions, allFolders, uploaders, totalPendingFiles };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext);

  if (!user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const _action = formData.get("_action") as string;
  const sessionFolderId = formData.get("sessionFolderId") as string;

  if (!sessionFolderId) {
    return { error: "Missing session folder ID" };
  }

  if (_action === "approve") {
    const destinationFolderId = formData.get("destinationFolderId") as string;
    if (!destinationFolderId) {
      return { error: "Please select a destination folder" };
    }

    const destinationFolder = await db.query.folders.findFirst({
      where: eq(folders.id, destinationFolderId),
    });

    if (!destinationFolder) {
      return { error: "Destination folder not found" };
    }

    const result = await approveSession(
      sessionFolderId,
      destinationFolderId,
      destinationFolder.slug,
    );
    return { success: true, action: "approve", count: result.approvedCount };
  }

  if (_action === "reject") {
    const result = await rejectSession(sessionFolderId);
    return { success: true, action: "reject", count: result.rejectedCount };
  }

  if (_action === "approve-all") {
    const destinationFolderId = formData.get("destinationFolderId") as string;
    const filterUploaderId = formData.get("filterUploaderId") as string | null;

    if (!destinationFolderId) {
      return { error: "Please select a destination folder" };
    }

    const destinationFolder = await db.query.folders.findFirst({
      where: eq(folders.id, destinationFolderId),
    });

    if (!destinationFolder) {
      return { error: "Destination folder not found" };
    }

    const allSessions = await getPendingSessionsWithFiles();
    const sessionsToApprove = filterUploaderId
      ? allSessions.filter((s) => s.uploader?.id === filterUploaderId)
      : allSessions;

    let totalApproved = 0;
    for (const session of sessionsToApprove) {
      const result = await approveSession(
        session.folder.id,
        destinationFolderId,
        destinationFolder.slug,
      );
      totalApproved += result.approvedCount;
    }

    return {
      success: true,
      action: "approve-all",
      count: totalApproved,
      sessionCount: sessionsToApprove.length,
    };
  }

  if (_action === "reject-all") {
    const filterUploaderId = formData.get("filterUploaderId") as string | null;

    const allSessions = await getPendingSessionsWithFiles();
    const sessionsToReject = filterUploaderId
      ? allSessions.filter((s) => s.uploader?.id === filterUploaderId)
      : allSessions;

    let totalRejected = 0;
    for (const session of sessionsToReject) {
      const result = await rejectSession(session.folder.id);
      totalRejected += result.rejectedCount;
    }

    return {
      success: true,
      action: "reject-all",
      count: totalRejected,
      sessionCount: sessionsToReject.length,
    };
  }

  return { error: "Unknown action" };
}

export function meta() {
  return [{ title: "Upload Inbox - Admin - artbin" }];
}

function formatDate(date: Date | null): string {
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function isWebImage(mimeType: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(mimeType);
}

function thumbnailUrl(file: {
  path: string;
  mimeType: string;
  hasPreview: boolean | null;
}): string | null {
  if (isWebImage(file.mimeType)) {
    return `/uploads/${file.path}`;
  }
  if (file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return null;
}

export default function AdminInbox() {
  const { sessions, allFolders, uploaders, totalPendingFiles } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
      <div className="text-xs text-text-muted mb-4">
        <a className="text-text-muted hover:text-text" href="/folders">
          Folders
        </a>
        <span className="mx-2">/</span>
        <a className="text-text-muted hover:text-text" href="/admin/jobs">
          Admin
        </a>
        <span className="mx-2">/</span>
        <span>Inbox</span>
      </div>

      <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">
        Upload Inbox
        {totalPendingFiles > 0 && (
          <span className="text-sm font-normal text-text-muted ml-2">
            ({totalPendingFiles} file{totalPendingFiles === 1 ? "" : "s"} in {sessions.length}{" "}
            session{sessions.length === 1 ? "" : "s"})
          </span>
        )}
      </h1>

      {actionData?.error && <div className="alert alert-error mb-4">{actionData.error}</div>}

      {actionData?.success && actionData.action === "approve" && (
        <div className="alert alert-success mb-4">
          Approved {actionData.count} file{actionData.count === 1 ? "" : "s"}.
        </div>
      )}

      {actionData?.success && actionData.action === "reject" && (
        <div className="alert alert-success mb-4">
          Rejected {actionData.count} file{actionData.count === 1 ? "" : "s"}.
        </div>
      )}

      {actionData?.success && actionData.action === "approve-all" && (
        <div className="alert alert-success mb-4">
          Approved {actionData.count} file{actionData.count === 1 ? "" : "s"} across{" "}
          {actionData.sessionCount} session{actionData.sessionCount === 1 ? "" : "s"}.
        </div>
      )}

      {actionData?.success && actionData.action === "reject-all" && (
        <div className="alert alert-success mb-4">
          Rejected {actionData.count} file{actionData.count === 1 ? "" : "s"} across{" "}
          {actionData.sessionCount} session{actionData.sessionCount === 1 ? "" : "s"}.
        </div>
      )}

      {/* Bulk actions */}
      {sessions.length > 1 && (
        <div className="border border-border-light p-4 mb-6 bg-bg-subtle">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
            Bulk Actions
          </h2>
          <Form method="post" className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-text-muted mb-1">Destination folder</label>
              <select name="destinationFolderId" className="input">
                <option value="" disabled selected>
                  Select a folder...
                </option>
                {allFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            {uploaders.length > 1 && (
              <div>
                <label className="block text-xs text-text-muted mb-1">Filter by uploader</label>
                <select name="filterUploaderId" className="input">
                  <option value="">All uploaders</option>
                  {uploaders.map((u) => (
                    <option key={u.id} value={u.id}>
                      @{u.username}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {uploaders.length === 1 && <input type="hidden" name="filterUploaderId" value="" />}
            <button
              type="submit"
              name="_action"
              value="approve-all"
              className="btn btn-primary"
              onClick={(e) => {
                if (!confirm(`Approve all pending uploads to the selected folder?`)) {
                  e.preventDefault();
                }
              }}
            >
              Approve All
            </button>
            <button
              type="submit"
              name="_action"
              value="reject-all"
              className="btn btn-danger"
              onClick={(e) => {
                if (!confirm(`Reject all pending uploads?`)) {
                  e.preventDefault();
                }
              }}
            >
              Reject All
            </button>
          </Form>
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-text-muted">No pending uploads.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {sessions.map((session) => (
            <div key={session.folder.id} className="border border-border-light p-4">
              <div className="flex items-start justify-between mb-3 pb-3 border-b border-border-light">
                <div>
                  <p className="text-sm">
                    <span className="text-text-muted">Uploaded by </span>
                    <strong>
                      {session.uploader ? `@${session.uploader.username}` : "Unknown"}
                    </strong>
                    <span className="text-text-muted">
                      {" "}
                      on {formatDate(session.folder.createdAt)}
                    </span>
                  </p>
                  {session.suggestedFolder && (
                    <p className="text-sm text-text-muted mt-1">
                      Suggested folder:{" "}
                      <span className="text-text">{session.suggestedFolder.name}</span>
                    </p>
                  )}
                  <p className="text-xs text-text-faint mt-1">
                    {session.files.length} file
                    {session.files.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              {/* File list */}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 mb-4">
                {session.files.map((file) => {
                  const thumb = thumbnailUrl(file);
                  return (
                    <div key={file.id} className="border border-border-light p-1 text-center">
                      {thumb ? (
                        <img
                          src={thumb}
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

              {/* Actions */}
              <div className="flex items-end gap-4 pt-3 border-t border-border-light">
                <Form method="post" className="flex items-end gap-2 flex-1">
                  <input type="hidden" name="_action" value="approve" />
                  <input type="hidden" name="sessionFolderId" value={session.folder.id} />
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1">Destination folder</label>
                    <select
                      name="destinationFolderId"
                      className="input w-full"
                      defaultValue={session.suggestedFolder?.id ?? ""}
                    >
                      <option value="" disabled>
                        Select a folder...
                      </option>
                      {allFolders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Approve
                  </button>
                </Form>

                <Form method="post">
                  <input type="hidden" name="_action" value="reject" />
                  <input type="hidden" name="sessionFolderId" value={session.folder.id} />
                  <button
                    type="submit"
                    className="btn btn-danger"
                    onClick={(e) => {
                      if (
                        !confirm(
                          `Reject ${session.files.length} file${session.files.length === 1 ? "" : "s"} from this upload?`,
                        )
                      ) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Reject
                  </button>
                </Form>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="mt-6 pt-4 border-t border-border-light flex gap-2">
        <a href="/admin/jobs" className="btn btn-sm">
          Jobs
        </a>
        <a href="/admin/import" className="btn btn-sm">
          Import
        </a>
        <a href="/admin/users" className="btn btn-sm">
          Users
        </a>
      </footer>
    </main>
  );
}
