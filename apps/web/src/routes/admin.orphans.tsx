import { Form, redirect, useLoaderData, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/admin.orphans";
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { files, folders } from "~/db";
import { eq, and, lt, like, inArray } from "drizzle-orm";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, relative } from "path";
import { UPLOADS_DIR, deleteFile, deleteFolder } from "~/lib/files.server";
import { deleteFileRecord } from "~/lib/files.server";

// ---------------------------------------------------------------------------
// Walk uploads dir, collecting file paths relative to UPLOADS_DIR
// ---------------------------------------------------------------------------
async function walkDir(dir: string, base: string): Promise<string[]> {
  const paths: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return paths;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walkDir(full, base)));
    } else if (entry.isFile()) {
      // Skip preview files and folder previews — they are expected on disk without DB records
      if (entry.name.endsWith(".preview.png") || entry.name === "_folder-preview.png") continue;
      paths.push(relative(base, full));
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Scan logic
// ---------------------------------------------------------------------------
interface ScanResults {
  orphanedFiles: string[]; // on disk, not in DB
  missingFiles: { id: string; path: string }[]; // in DB, not on disk
  staleRejected: { id: string; path: string }[]; // rejected + older than 7d
  emptyInboxSessions: { id: string; slug: string }[]; // inbox session folders with 0 pending files
}

async function performScan(): Promise<ScanResults> {
  // 1. Get all file paths on disk
  const diskPaths = existsSync(UPLOADS_DIR) ? await walkDir(UPLOADS_DIR, UPLOADS_DIR) : [];
  const diskSet = new Set(diskPaths);

  // 2. Get all file records from DB
  const allFiles = await db
    .select({ id: files.id, path: files.path, status: files.status, createdAt: files.createdAt })
    .from(files);
  const dbPathMap = new Map(allFiles.map((f) => [f.path, f]));

  // 3. Orphaned files: on disk but not in DB
  const orphanedFiles: string[] = [];
  for (const diskPath of diskPaths) {
    if (!dbPathMap.has(diskPath)) {
      orphanedFiles.push(diskPath);
    }
  }

  // 4. Missing files: in DB but not on disk
  const missingFiles: { id: string; path: string }[] = [];
  for (const file of allFiles) {
    if (!diskSet.has(file.path)) {
      missingFiles.push({ id: file.id, path: file.path });
    }
  }

  // 5. Stale rejected: status='rejected' and older than 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const staleRejected = allFiles
    .filter((f) => f.status === "rejected" && f.createdAt && f.createdAt < sevenDaysAgo)
    .map((f) => ({ id: f.id, path: f.path }));

  // 6. Empty inbox sessions: _inbox/* folders with no pending files
  const inboxFolder = await db.query.folders.findFirst({
    where: eq(folders.slug, "_inbox"),
  });

  const emptyInboxSessions: { id: string; slug: string }[] = [];
  if (inboxFolder) {
    const sessionFolders = await db.query.folders.findMany({
      where: eq(folders.parentId, inboxFolder.id),
    });
    for (const session of sessionFolders) {
      const pendingFiles = await db.query.files.findMany({
        where: and(eq(files.folderId, session.id), eq(files.status, "pending")),
      });
      if (pendingFiles.length === 0) {
        emptyInboxSessions.push({ id: session.id, slug: session.slug });
      }
    }
  }

  return { orphanedFiles, missingFiles, staleRejected, emptyInboxSessions };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  if (!user.isAdmin) {
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const scan = url.searchParams.get("scan") === "true";

  const scanResults = scan ? await performScan() : null;
  return { scanResults };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext);
  if (!user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const _action = formData.get("_action") as string;

  if (_action === "delete-orphans") {
    const pathsRaw = formData.get("paths") as string;
    const paths: string[] = pathsRaw ? JSON.parse(pathsRaw) : [];
    let deleted = 0;
    for (const p of paths) {
      try {
        const { unlink } = await import("fs/promises");
        await unlink(join(UPLOADS_DIR, p));
        deleted++;
      } catch {
        // skip files that can't be deleted
      }
    }
    return { success: true, action: _action, deleted };
  }

  if (_action === "delete-missing") {
    const idsRaw = formData.get("ids") as string;
    const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [];
    let deleted = 0;
    for (const id of ids) {
      const result = await deleteFileRecord(id);
      if (result.isOk()) deleted++;
    }
    return { success: true, action: _action, deleted };
  }

  if (_action === "cleanup-rejected") {
    const itemsRaw = formData.get("items") as string;
    const items: { id: string; path: string }[] = itemsRaw ? JSON.parse(itemsRaw) : [];
    let deleted = 0;
    for (const item of items) {
      try {
        await deleteFile(item.path);
      } catch {
        // disk file may already be gone
      }
      const result = await deleteFileRecord(item.id);
      if (result.isOk()) deleted++;
    }
    return { success: true, action: _action, deleted };
  }

  if (_action === "cleanup-sessions") {
    const sessionsRaw = formData.get("sessions") as string;
    const sessionList: { id: string; slug: string }[] = sessionsRaw ? JSON.parse(sessionsRaw) : [];
    let deleted = 0;
    for (const session of sessionList) {
      try {
        await deleteFolder(session.slug);
      } catch {
        // folder may already be gone
      }
      try {
        await db.delete(folders).where(eq(folders.id, session.id));
        deleted++;
      } catch {
        // skip on error
      }
    }
    return { success: true, action: _action, deleted };
  }

  return { error: "Unknown action" };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------
export function meta() {
  return [{ title: "Orphan Finder - Admin - artbin" }];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AdminOrphans() {
  const { scanResults } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isScanning = navigation.state === "loading" && navigation.location?.search === "?scan=true";
  const isSubmitting = navigation.state === "submitting";

  const allClean =
    scanResults &&
    scanResults.orphanedFiles.length === 0 &&
    scanResults.missingFiles.length === 0 &&
    scanResults.staleRejected.length === 0 &&
    scanResults.emptyInboxSessions.length === 0;

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
        <span>Orphans</span>
      </div>

      <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">Orphan Finder</h1>

      {actionData?.error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-3 py-2 text-sm mb-4">
          {actionData.error}
        </div>
      )}

      {actionData?.success && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 px-3 py-2 text-sm mb-4">
          Cleaned up {actionData.deleted} item{actionData.deleted === 1 ? "" : "s"} (
          {actionData.action}).
        </div>
      )}

      <div className="mb-6">
        <a
          href="?scan=true"
          className={`btn btn-primary ${isScanning ? "opacity-50 pointer-events-none" : ""}`}
        >
          {isScanning ? "Scanning..." : "Scan"}
        </a>
      </div>

      {!scanResults && !isScanning && (
        <p className="text-text-muted text-sm">
          Click Scan to compare uploads directory with the database.
        </p>
      )}

      {scanResults && allClean && <p className="text-green-400 text-sm">Everything looks clean.</p>}

      {scanResults && !allClean && (
        <div className="flex flex-col gap-3">
          {/* Orphaned files */}
          <div className="flex items-center justify-between border border-border-light px-4 py-3">
            <span className="text-sm">
              <strong>{scanResults.orphanedFiles.length}</strong> orphaned file
              {scanResults.orphanedFiles.length === 1 ? "" : "s"} on disk
            </span>
            {scanResults.orphanedFiles.length > 0 && (
              <Form method="post">
                <input type="hidden" name="_action" value="delete-orphans" />
                <input
                  type="hidden"
                  name="paths"
                  value={JSON.stringify(scanResults.orphanedFiles)}
                />
                <button type="submit" className="btn btn-danger btn-sm" disabled={isSubmitting}>
                  Delete Orphans
                </button>
              </Form>
            )}
          </div>

          {/* Missing files */}
          <div className="flex items-center justify-between border border-border-light px-4 py-3">
            <span className="text-sm">
              <strong>{scanResults.missingFiles.length}</strong> missing file
              {scanResults.missingFiles.length === 1 ? "" : "s"} in DB
            </span>
            {scanResults.missingFiles.length > 0 && (
              <Form method="post">
                <input type="hidden" name="_action" value="delete-missing" />
                <input
                  type="hidden"
                  name="ids"
                  value={JSON.stringify(scanResults.missingFiles.map((f) => f.id))}
                />
                <button type="submit" className="btn btn-danger btn-sm" disabled={isSubmitting}>
                  Delete Records
                </button>
              </Form>
            )}
          </div>

          {/* Stale rejected */}
          <div className="flex items-center justify-between border border-border-light px-4 py-3">
            <span className="text-sm">
              <strong>{scanResults.staleRejected.length}</strong> stale rejected file
              {scanResults.staleRejected.length === 1 ? "" : "s"}
            </span>
            {scanResults.staleRejected.length > 0 && (
              <Form method="post">
                <input type="hidden" name="_action" value="cleanup-rejected" />
                <input
                  type="hidden"
                  name="items"
                  value={JSON.stringify(scanResults.staleRejected)}
                />
                <button type="submit" className="btn btn-danger btn-sm" disabled={isSubmitting}>
                  Cleanup
                </button>
              </Form>
            )}
          </div>

          {/* Empty inbox sessions */}
          <div className="flex items-center justify-between border border-border-light px-4 py-3">
            <span className="text-sm">
              <strong>{scanResults.emptyInboxSessions.length}</strong> empty inbox session
              {scanResults.emptyInboxSessions.length === 1 ? "" : "s"}
            </span>
            {scanResults.emptyInboxSessions.length > 0 && (
              <Form method="post">
                <input type="hidden" name="_action" value="cleanup-sessions" />
                <input
                  type="hidden"
                  name="sessions"
                  value={JSON.stringify(scanResults.emptyInboxSessions)}
                />
                <button type="submit" className="btn btn-danger btn-sm" disabled={isSubmitting}>
                  Cleanup
                </button>
              </Form>
            )}
          </div>
        </div>
      )}

      <footer className="mt-6 pt-4 border-t border-border-light flex gap-2">
        <a href="/admin/jobs" className="btn btn-sm">
          Jobs
        </a>
        <a href="/admin/inbox" className="btn btn-sm">
          Inbox
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
