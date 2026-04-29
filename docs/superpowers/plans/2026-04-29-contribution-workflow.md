# Contribution & Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any authenticated user to upload files to a hidden inbox. Admins review upload sessions and approve (move to public folder) or reject them as a batch.

**Architecture:** Add `status` and `suggestedFolderId` columns to `files`. Use React Router v7 middleware on `app-layout` for auth, replacing per-route checks. Non-admin uploads land in `_inbox/<nanoid>` session folders. Admin inbox view at `/admin/inbox` with approve/reject actions. All public queries filter to `status = 'approved'` and exclude `_` prefixed folders.

**Tech Stack:** React Router v7 (middleware, framework mode), Drizzle ORM (SQLite), vitest

**Spec:** `docs/superpowers/specs/2026-04-29-contribution-workflow-design.md`

---

### Task 1: Schema changes -- add `status` and `suggestedFolderId` to files

**Files:**
- Modify: `apps/web/src/db/schema.ts`
- Modify: `apps/web/src/lib/files.server.ts` (CreateFileRecord interface + insertFileRecord)

- [ ] **Step 1: Add columns to schema**

In `apps/web/src/db/schema.ts`, add to the `files` table definition:

```ts
status: text("status", { enum: ["pending", "approved", "rejected"] as const }).notNull().default("approved"),
suggestedFolderId: text("suggested_folder_id").references(() => folders.id, { onDelete: "set null" }),
```

Add an index on `status`:
```ts
statusIdx: index("idx_files_status").on(table.status),
```

- [ ] **Step 2: Push schema change**

Run: `pnpm run --filter @artbin/web db:push`

- [ ] **Step 3: Update `CreateFileRecord` and `insertFileRecord` in `files.server.ts`**

Add to the `CreateFileRecord` interface:
```ts
status?: "pending" | "approved" | "rejected";
suggestedFolderId?: string | null;
```

Add to the `db.insert(files).values({...})` call in `insertFileRecord`:
```ts
status: record.status ?? "approved",
suggestedFolderId: record.suggestedFolderId ?? null,
```

- [ ] **Step 4: Run CI**

Run: `pnpm run ci`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "add status and suggestedFolderId columns to files table"
```

---

### Task 2: Auth middleware -- replace per-route auth checks

Enable React Router v7 middleware on the `app-layout` route. Create a shared auth context. Remove redundant auth checks from child route loaders.

**Files:**
- Modify: `apps/web/react-router.config.ts`
- Create: `apps/web/src/lib/auth-context.server.ts`
- Modify: `apps/web/src/routes/app-layout.tsx`
- Modify: all route loaders under `app-layout` that do their own auth checks (15 files)

- [ ] **Step 1: Enable middleware in react-router config**

In `apps/web/react-router.config.ts`:
```ts
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  appDirectory: "src",
  future: {
    v8_middleware: true,
  },
} satisfies Config;
```

- [ ] **Step 2: Create auth context module**

```ts
// apps/web/src/lib/auth-context.server.ts

import { createContext, redirect } from "react-router";
import { parseSessionCookie, getUserFromSession } from "./auth.server";
import type { User } from "~/db";

export const userContext = createContext<User | null>(null);

export async function authMiddleware({
  request,
  context,
}: {
  request: Request;
  context: any;
}) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    throw redirect("/login");
  }

  context.set(userContext, user);
}
```

- [ ] **Step 3: Add middleware to app-layout**

Replace the `app-layout.tsx` loader with middleware:

```tsx
import { Outlet, useLoaderData } from "react-router";
import type { Route } from "./+types/app-layout";
import { authMiddleware, userContext } from "~/lib/auth-context.server";
import { Header } from "~/components/Header";

export const middleware = [authMiddleware];

export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  return { user };
}

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <>
      <Header user={user} />
      <Outlet />
    </>
  );
}
```

- [ ] **Step 4: Remove redundant auth checks from child route loaders**

For each route under `app-layout` that currently does `parseSessionCookie` + `getUserFromSession` + redirect:

Replace the auth boilerplate with reading from context. The user is guaranteed to exist because the middleware redirects unauthenticated users.

Routes to update (check each one for the pattern and remove it):
- `routes/home.tsx`
- `routes/settings.tsx`
- `routes/folders.tsx`
- `routes/folder.$slug.tsx`
- `routes/file.$.tsx`
- `routes/admin.jobs.tsx`
- `routes/admin.import.tsx`
- `routes/admin.archives.tsx`
- `routes/admin.scan-settings.tsx`
- `routes/admin.users.tsx`

For each, replace:
```ts
const sessionId = parseSessionCookie(request.headers.get("Cookie"));
const user = await getUserFromSession(sessionId);
if (!user) return redirect("/login");
```

With:
```ts
const user = context.get(userContext);
```

And add the import:
```ts
import { userContext } from "~/lib/auth-context.server";
```

Remove unused imports of `parseSessionCookie`, `getUserFromSession`, `redirect` (if redirect was only used for auth).

**Note:** The API routes (`api.upload.tsx`, `api.folder.tsx`, `api.folder.move.tsx`) are NOT under the `app-layout` middleware -- they're standalone routes. They keep their own auth checks. The CLI API routes (`api.cli.*`) use `requireCliAdmin` which also stays.

- [ ] **Step 5: Update tests**

Update `test/cli-api.test.ts` and `test/route-actions.test.ts` if they're affected by the context change. The API routes under test are standalone (not under app-layout), so they should be unaffected. Verify by running tests.

- [ ] **Step 6: Run CI**

Run: `pnpm run ci`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "add auth middleware to app-layout, remove per-route auth checks

- enable future.v8_middleware in react-router config
- authMiddleware on app-layout redirects to /login if no session
- userContext provides user to all child loaders via context.get()
- removed redundant parseSessionCookie/getUserFromSession from 10 routes"
```

---

### Task 3: Inbox infrastructure -- create `_inbox` folder at startup, helper functions

**Files:**
- Create: `apps/web/src/lib/inbox.server.ts`
- Modify: `apps/web/src/entry.server.tsx` or server startup (ensure `_inbox` folder exists)

- [ ] **Step 1: Create inbox helper module**

```ts
// apps/web/src/lib/inbox.server.ts

import { db } from "~/db/connection.server";
import { folders, files, users } from "~/db";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ensureDir, slugToPath, moveFile, deleteFolder } from "./files.server";
import { recalculateFolderCounts } from "./files.server";

const INBOX_SLUG = "_inbox";
const INBOX_NAME = "Inbox";

/**
 * Ensure the _inbox root folder exists. Called at app startup.
 */
export async function ensureInboxFolder(): Promise<string> {
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, INBOX_SLUG),
  });

  if (existing) return existing.id;

  const id = nanoid();
  await db.insert(folders).values({
    id,
    name: INBOX_NAME,
    slug: INBOX_SLUG,
  });
  await ensureDir(slugToPath(INBOX_SLUG));
  return id;
}

/**
 * Create a new upload session folder under _inbox.
 * Returns the session folder's id and slug.
 */
export async function createUploadSession(uploaderId: string): Promise<{
  id: string;
  slug: string;
}> {
  const inboxId = await ensureInboxFolder();
  const sessionId = nanoid();
  const sessionSlug = `${INBOX_SLUG}/${sessionId}`;

  await db.insert(folders).values({
    id: sessionId,
    name: sessionId,
    slug: sessionSlug,
    parentId: inboxId,
    ownerId: uploaderId,
  });
  await ensureDir(slugToPath(sessionSlug));

  return { id: sessionId, slug: sessionSlug };
}

/**
 * Approve all pending files in a session: move to destination folder.
 */
export async function approveSession(
  sessionFolderId: string,
  destinationFolderId: string,
  destinationSlug: string,
): Promise<{ approvedCount: number }> {
  const sessionFiles = await db.query.files.findMany({
    where: and(
      eq(files.folderId, sessionFolderId),
      eq(files.status, "pending"),
    ),
  });

  for (const file of sessionFiles) {
    const newPath = `${destinationSlug}/${file.name}`;

    // Move file on disk (including preview)
    await moveFile(file.path, newPath);

    // Update DB record
    await db
      .update(files)
      .set({
        status: "approved",
        folderId: destinationFolderId,
        path: newPath,
      })
      .where(eq(files.id, file.id));
  }

  // Recalculate destination folder file count
  await recalculateFolderCounts([destinationFolderId]);

  // Clean up empty session folder
  const sessionFolder = await db.query.folders.findFirst({
    where: eq(folders.id, sessionFolderId),
  });
  if (sessionFolder) {
    await deleteFolder(sessionFolder.slug);
    await db.delete(folders).where(eq(folders.id, sessionFolderId));
  }

  return { approvedCount: sessionFiles.length };
}

/**
 * Reject all pending files in a session.
 */
export async function rejectSession(sessionFolderId: string): Promise<{ rejectedCount: number }> {
  const sessionFiles = await db.query.files.findMany({
    where: and(
      eq(files.folderId, sessionFolderId),
      eq(files.status, "pending"),
    ),
  });

  for (const file of sessionFiles) {
    await db
      .update(files)
      .set({ status: "rejected" })
      .where(eq(files.id, file.id));
  }

  // Delete the session folder record (files stay on disk for cleanup)
  const sessionFolder = await db.query.folders.findFirst({
    where: eq(folders.id, sessionFolderId),
  });
  if (sessionFolder) {
    await db.delete(folders).where(eq(folders.id, sessionFolderId));
  }

  return { rejectedCount: sessionFiles.length };
}

/**
 * Get all pending upload sessions with their files.
 */
export async function getPendingSessionsWithFiles() {
  const inboxFolder = await db.query.folders.findFirst({
    where: eq(folders.slug, INBOX_SLUG),
  });
  if (!inboxFolder) return [];

  const sessionFolders = await db.query.folders.findMany({
    where: eq(folders.parentId, inboxFolder.id),
  });

  const sessions = [];
  for (const session of sessionFolders) {
    const sessionFiles = await db.query.files.findMany({
      where: and(
        eq(files.folderId, session.id),
        eq(files.status, "pending"),
      ),
    });

    if (sessionFiles.length === 0) continue;

    // Look up uploader
    const uploader = session.ownerId
      ? await db.query.users.findFirst({ where: eq(users.id, session.ownerId) })
      : null;

    // Get suggested folder from first file that has one
    const suggestedFolderId = sessionFiles.find((f) => f.suggestedFolderId)?.suggestedFolderId;
    const suggestedFolder = suggestedFolderId
      ? await db.query.folders.findFirst({ where: eq(folders.id, suggestedFolderId) })
      : null;

    sessions.push({
      folder: session,
      files: sessionFiles,
      uploader,
      suggestedFolder,
    });
  }

  return sessions;
}
```

- [ ] **Step 2: Call `ensureInboxFolder` at server startup**

Find where the server initializes (likely `entry.server.tsx` or a startup module). Add:

```ts
import { ensureInboxFolder } from "~/lib/inbox.server";
// Call once on startup
ensureInboxFolder().catch(console.error);
```

If there's no obvious startup hook, add it to the `app-layout` loader as a lazy init (check if `_inbox` exists, create if not, cache the result).

- [ ] **Step 3: Write tests for inbox functions**

Create `apps/web/test/inbox.test.ts` with tests for:
- `ensureInboxFolder` creates the folder if missing, returns existing id if present
- `createUploadSession` creates a subfolder under `_inbox` with correct parentId and ownerId
- `approveSession` moves files, updates status/path/folderId, cleans up session folder
- `rejectSession` updates status to rejected, deletes session folder record

Mock filesystem operations (ensureDir, moveFile, deleteFolder) same pattern as cli-api tests.

- [ ] **Step 4: Run CI**

Run: `pnpm run ci`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "add inbox infrastructure for contribution workflow

- ensureInboxFolder creates _inbox root folder at startup
- createUploadSession creates _inbox/<nanoid> per upload batch
- approveSession moves files to destination, cleans up session
- rejectSession marks files rejected, cleans up session folder
- tests for all inbox functions"
```

---

### Task 4: Public view filtering -- hide pending/rejected files and system folders

**Files:**
- Modify: `apps/web/src/lib/files.server.ts` (searchFiles, getFileCountsByKind)
- Modify: `apps/web/src/routes/folders.tsx` (exclude `_` folders)
- Modify: `apps/web/src/routes/folder.$slug.tsx` (filter files by status)
- Modify: `apps/web/src/routes/file.$.tsx` (allow uploader + admin to see pending)

- [ ] **Step 1: Add status filter to `searchFiles`**

In the `searchFiles` function in `files.server.ts`, add a default condition:
```ts
// Always filter to approved files unless explicitly overridden
if (!options.includeAllStatuses) {
  conditions.push(eq(files.status, "approved"));
}
```

Add `includeAllStatuses?: boolean` to `SearchFilesOptions`.

- [ ] **Step 2: Add status filter to `getFileCountsByKind`**

Add `eq(files.status, "approved")` to the condition in `getFileCountsByKind`.

- [ ] **Step 3: Filter `_` folders from folder listings**

In `routes/folders.tsx` loader, when querying top-level folders, add:
```ts
// Exclude system folders (slug starting with _)
.where(and(
  isNull(folders.parentId),
  not(like(folders.slug, "\\_%")),
))
```

In `routes/folder.$slug.tsx` loader, when querying child folders, add the same filter.

- [ ] **Step 4: Filter pending files from folder view**

In `routes/folder.$slug.tsx` loader, when querying `folderFiles`, add `eq(files.status, "approved")` to the where clause.

- [ ] **Step 5: Handle file detail view for pending files**

In `routes/file.$.tsx`, allow the uploader and admins to view pending files. Other users get 404:
```ts
if (file.status !== "approved") {
  const isOwner = user && file.uploaderId === user.id;
  const isAdmin = user?.isAdmin;
  if (!isOwner && !isAdmin) {
    throw new Response("Not found", { status: 404 });
  }
}
```

- [ ] **Step 6: Write tests for filtering**

Add tests to `apps/web/test/contribution.test.ts`:
- `searchFiles` excludes pending/rejected files by default
- `searchFiles` with `includeAllStatuses: true` returns all files
- `getFileCountsByKind` only counts approved files
- File detail view returns 404 for pending file when accessed by non-owner non-admin
- File detail view succeeds for pending file when accessed by owner or admin

- [ ] **Step 7: Run CI**

Run: `pnpm run ci`

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "filter pending/rejected files from public views

- searchFiles defaults to approved-only
- getFileCountsByKind counts approved-only
- folder listings exclude _ prefixed system folders
- pending files visible only to uploader and admins"
```

---

### Task 5: Non-admin upload flow -- modify upload to create pending files in inbox

**Files:**
- Modify: `apps/web/src/routes/api.upload.tsx`
- Modify: `apps/web/src/components/UploadModal.tsx`

- [ ] **Step 1: Update `api.upload.tsx` to route non-admin uploads to inbox**

In the `handleFileUpload` function:
- If user is NOT admin:
  - Call `createUploadSession(user.id)` to get a session folder
  - Save files to the session folder instead of the specified folderId
  - Set `status: "pending"` on file records
  - Set `suggestedFolderId` to the folderId the user selected (if any)
- If user IS admin:
  - Behavior unchanged (save to selected folder, status `approved`)

The upload action already receives `folderId` from the form data. For non-admins, this becomes the `suggestedFolderId` instead of the actual destination.

- [ ] **Step 2: Update UploadModal for non-admin experience**

When the user is not admin:
- Change the folder selector label from "Upload to" to "Suggest folder" (or similar)
- After successful upload, show "Uploaded! An admin will review your submission." instead of the current success message
- Hide the "Create folder" option (non-admins shouldn't create folders)

The modal already receives `currentFolder` as a prop. Also pass `isAdmin` (or `user`) so it knows which UX to show.

- [ ] **Step 3: Write tests**

Add to `apps/web/test/contribution.test.ts`:
- Non-admin upload creates file in `_inbox/<session>` with `status: 'pending'`
- Non-admin upload stores `suggestedFolderId` from form data
- Admin upload still creates file directly in target folder with `status: 'approved'`

- [ ] **Step 4: Run CI**

Run: `pnpm run ci`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "route non-admin uploads to inbox with pending status

- non-admin files go to _inbox/<session> with status pending
- suggested folder stored for admin review
- admin uploads unchanged (direct to folder, approved)
- upload modal adapts UX for non-admin users"
```

---

### Task 6: Admin inbox view -- `/admin/inbox` route

**Files:**
- Create: `apps/web/src/routes/admin.inbox.tsx`
- Modify: `apps/web/src/routes.ts`

- [ ] **Step 1: Create the admin inbox route**

```tsx
// apps/web/src/routes/admin.inbox.tsx

// Loader: calls getPendingSessionsWithFiles(), also loads all public folders for the approve dropdown
// Action: handles _action = "approve" | "reject"
//   - approve: reads destinationFolderId from form, calls approveSession()
//   - reject: calls rejectSession()
// Component: renders grouped upload sessions with approve/reject UI
```

The loader:
- Uses `context.get(userContext)` to get user (from middleware)
- Checks `user.isAdmin`, returns 403 if not
- Calls `getPendingSessionsWithFiles()` from `inbox.server.ts`
- Loads all non-system folders for the destination dropdown

The action:
- Reads `_action`, `sessionFolderId`, and optionally `destinationFolderId`
- For approve: calls `approveSession(sessionFolderId, destinationFolderId, destinationSlug)`
- For reject: calls `rejectSession(sessionFolderId)`

The component:
- Lists each session as a card with uploader info, file thumbnails/list, suggested folder
- Each card has an approve form (folder dropdown + submit) and a reject button
- Empty state: "No pending uploads"

- [ ] **Step 2: Register route**

In `apps/web/src/routes.ts`, add to the admin prefix:
```ts
route("inbox", "routes/admin.inbox.tsx"),
```

- [ ] **Step 3: Add inbox link to admin navigation**

Add a link to `/admin/inbox` in the Header or admin nav (wherever the other admin links live). Include a pending count badge if there are pending uploads.

- [ ] **Step 4: Write tests**

Add to `apps/web/test/contribution.test.ts`:
- Admin inbox loader returns pending sessions grouped correctly
- Admin inbox rejects non-admin users
- Approve action moves files and cleans up session
- Reject action marks files rejected and cleans up session
- Empty inbox returns empty array

- [ ] **Step 5: Run CI**

Run: `pnpm run ci`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "add admin inbox view for reviewing uploads

- /admin/inbox shows pending upload sessions grouped by uploader
- approve moves all session files to destination folder
- reject marks all session files as rejected
- pending count badge in admin nav"
```

---

### Task 7: Admin orphan finder -- `/admin/orphans` route

**Files:**
- Create: `apps/web/src/routes/admin.orphans.tsx`
- Modify: `apps/web/src/routes.ts`

- [ ] **Step 1: Create the orphan finder route**

Loader:
- Admin-only check
- Optionally runs scan (triggered by `?scan=true` query param or form action)
- Scan walks `public/uploads/` recursively, compares file paths against DB
- Returns: orphaned files (on disk, not in DB), missing files (in DB, not on disk), stale rejections (status=rejected, older than 7 days), empty inbox sessions

Action:
- `_action = "delete-orphans"`: deletes orphaned files from disk
- `_action = "delete-missing"`: deletes DB records for missing files
- `_action = "cleanup-rejected"`: deletes rejected file records and their disk files
- `_action = "cleanup-sessions"`: deletes empty inbox session folders

Component:
- "Scan" button to trigger the scan
- Results grouped by category with counts
- Cleanup buttons per category

- [ ] **Step 2: Register route**

In `apps/web/src/routes.ts`, add to admin prefix:
```ts
route("orphans", "routes/admin.orphans.tsx"),
```

- [ ] **Step 3: Run CI**

Run: `pnpm run ci`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "add admin orphan finder for uploads cleanup

- /admin/orphans scans uploads dir vs DB
- finds orphaned files, missing files, stale rejections, empty sessions
- cleanup actions for each category"
```

---

### Task 8: My Uploads view for non-admin users

**Files:**
- Create: `apps/web/src/routes/my-uploads.tsx`
- Modify: `apps/web/src/routes.ts`
- Modify: `apps/web/src/components/Header.tsx` (add link)

- [ ] **Step 1: Create my-uploads route**

Loader:
- Gets user from context
- Queries files where `uploaderId = user.id`, ordered by createdAt desc
- Groups by status (pending, approved, rejected)

Component:
- Three sections: Pending, Approved, Rejected
- Each file shows: thumbnail (if texture), name, status, destination folder (if approved)
- Pending section shows "Waiting for admin review"

- [ ] **Step 2: Register route and add nav link**

In `routes.ts`, add under app-layout:
```ts
route("my-uploads", "routes/my-uploads.tsx"),
```

Add "My Uploads" link to the Header for non-admin users.

- [ ] **Step 3: Run CI**

Run: `pnpm run ci`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "add my-uploads page for non-admin users

- shows user's uploads grouped by status
- pending/approved/rejected sections
- linked from header navigation"
```

---

### Task 9: End-to-end verification and polish

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci`

- [ ] **Step 2: Verify the full flow manually if possible**

- Non-admin uploads a file -> lands in inbox with pending status
- Admin sees it in /admin/inbox
- Admin approves -> file moves to destination, appears in public view
- Admin rejects -> file marked rejected, not visible
- Orphan finder detects stale rejections

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "polish contribution workflow"
```
