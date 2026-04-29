# Contribution & Approval Workflow Design

**Goal:** Allow any logged-in user to upload files to artbin. Uploads land in a hidden inbox. Admins review, edit, and approve or reject submissions. Approved files move into the public folder tree.

**Context:** Sub-project 3 of 3. The monorepo (sub-project 1) and CLI tool (sub-project 2) are complete. The current system only allows admin users to upload files. This work opens uploads to all authenticated users while keeping quality control through admin approval.

## Decisions

- **No new tables.** Reuse the existing `files` and `folders` tables with minimal column additions.
- **Inbox model.** All non-admin uploads land in a hidden `_inbox` folder. Each upload session gets its own subfolder (`_inbox/<nanoid>`). Files physically live there until approved.
- **Status column on files.** `pending`, `approved`, or `rejected`. Existing files are `approved`. Admin uploads skip the inbox and are `approved` immediately.
- **Physical file moves on approval.** Files move from `_inbox/<session>/` to the destination folder's disk path, consistent with how folder moves already work.
- **Auth middleware.** React Router v7 middleware enforces authentication on all app routes. No more per-loader auth checks. Unauthenticated users see only the login page.
- **Moderate admin editing.** Admins can rename files, pick destination folder, and add/edit tags before approving. No image transforms or kind re-detection.

## Schema Changes

### `files` table

Two new columns:

```sql
status TEXT NOT NULL DEFAULT 'approved'       -- 'pending' | 'approved' | 'rejected'
suggested_folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL  -- user's proposed destination
```

The `status` default is `'approved'` so existing files and admin uploads work unchanged. Non-admin uploads set `status = 'pending'`.

`suggested_folder_id` stores the folder the uploader thinks the file belongs in. The admin sees this as a pre-filled suggestion when approving. Nullable -- users don't have to suggest a folder.

### `folders` table

No schema changes. The `_inbox` folder and its session subfolders are regular folder records.

### Hidden folder convention

Folders with slugs starting with `_` are system folders, hidden from public navigation. The `_inbox` root folder is created at app startup if it doesn't exist. Session subfolders (`_inbox/<nanoid>`) are created per upload batch.

## Auth Middleware

A React Router v7 middleware on the `app-layout` route that:

1. Parses the session cookie
2. Looks up the user
3. If no valid session, redirects to `/login`
4. Attaches the user to the route context so all child loaders/actions can access it without re-querying

The `auth-layout` (login page) and standalone OAuth routes (`/auth/4orm`, `/auth/4orm/callback`, `/auth/cli/*`) sit outside this middleware and remain unauthenticated.

This replaces the scattered `getUserFromSession` + null-check pattern in every loader. Loaders that currently do their own auth checks switch to reading from context.

## Upload Flow (Non-Admin)

### User experience

1. User is logged in and browsing folders
2. User clicks "Upload" (visible to all authenticated users, not just admins)
3. Upload modal appears with:
   - File picker / drag-and-drop (same as current)
   - Optional "Suggested folder" dropdown (list of existing public folders)
   - Optional note text field (stored in the `source` column on the file record, e.g. "from my Quake install")
4. On submit:
   - A new session folder is created: `_inbox/<nanoid>` (DB record + disk directory)
   - Files are saved to that session folder on disk
   - DB records created with `status: 'pending'`, `folderId: sessionFolderId`, `suggestedFolderId: <selection or null>`
   - Image processing runs (previews, dimensions) same as admin uploads
5. User sees confirmation: "Uploaded! An admin will review your submission."

### Upload flow (Admin)

Unchanged. Admin uploads go directly to the selected folder with `status: 'approved'`. The inbox is bypassed entirely.

### "My Uploads" view

Non-admin users get a page (or section on their settings/profile page) showing their uploads with status indicators:
- Pending (waiting for review)
- Approved (with link to where it ended up)
- Rejected

## Admin Inbox View

New admin route: `/admin/inbox`

### Layout

Shows all files with `status = 'pending'`, grouped by upload session (shared `folderId` pointing at the same `_inbox/<nanoid>` folder). Each group shows:

- Uploader name and upload date
- Suggested destination folder (if any)
- Thumbnail grid of files in the session (for textures) or file list (for other kinds)
- Per-file: name, kind, size

### Actions

Approval and rejection operate on the entire upload session (all files in the batch), not individual files.

- **Approve** -- opens a form:
  - Destination folder (required, pre-filled with suggestion if one exists)
  - Tags to apply to all files (optional, multi-select or create)
  - On confirm: all files in the session move to destination, status becomes `approved`
- **Reject** -- sets `status = 'rejected'` on all files in the session (no rejection reason stored -- keep it simple)

### On approval (server-side)

1. Look up destination folder (must exist)
2. For each file in the session:
   - Move file on disk: `_inbox/<session>/<file>` -> `<destination-slug>/<file>` (plus preview if exists)
   - Update DB record: `status = 'approved'`, `folderId = destinationFolder.id`, `path = newPath`
3. Update destination folder's `fileCount` (increment by number of files)
4. Delete the now-empty session folder record and its disk directory

### On rejection (server-side)

1. Set `status = 'rejected'` on all files in the session
2. Files stay on disk in `_inbox/<session>/` until cleanup
3. Delete the session folder record (files remain on disk for cleanup job to handle)

## Public View Filtering

All queries that surface files to non-admin users must filter to `status = 'approved'`:

- **Folder file listings** (`folder.$slug.tsx` loader) -- add `WHERE status = 'approved'`
- **Search results** (`searchFiles` in `files.server.ts`) -- add status filter
- **File count queries** (`getFileCountsByKind`, folder `fileCount` column) -- only count approved files
- **Folder listings** -- exclude folders with slugs starting with `_`
- **Individual file view** (`file.$.tsx`) -- pending files visible only to the uploader or admins

The `fileCount` column on folders should only reflect approved files. When a file is approved and moved to a folder, that folder's count increments. The inbox session folder counts don't matter for public display since inbox folders are hidden.

## Admin Orphan Finder

New admin route: `/admin/orphans`

Triggered by a button (like the existing archive scanner -- runs as a job or inline scan).

Scans `public/uploads/` recursively and compares against DB:

- **Orphaned files**: files on disk with no matching DB record. Offers bulk delete.
- **Missing files**: DB records whose files are missing from disk. Offers bulk delete records.
- **Stale rejections**: files with `status = 'rejected'` older than 7 days. Offers bulk cleanup (delete file from disk + delete DB record).
- **Empty inbox sessions**: `_inbox/<nanoid>/` folders with no files remaining. Offers cleanup.

This is a maintenance tool, not something that runs automatically. Admin triggers it when they want to clean up.

## Testing

### Schema migration tests
- Verify `status` column defaults to `'approved'` for existing records
- Verify `suggested_folder_id` FK constraint works

### Auth middleware tests
- Unauthenticated request to app route redirects to `/login`
- Authenticated request passes through with user in context
- OAuth routes remain accessible without auth

### Upload flow tests
- Non-admin upload creates file with `status: 'pending'` in inbox session folder
- Admin upload creates file with `status: 'approved'` in target folder directly
- Upload session creates subfolder under `_inbox`
- Multiple files in one upload share the same session folder

### Approval/rejection tests
- Approve moves all session files on disk, updates status/path/folderId for each
- Approve updates destination folder file count (incremented by session file count)
- Approve cleans up empty session folder
- Reject sets status on all session files without moving them
- Reject cleans up session folder record

### Public filtering tests
- Folder view excludes pending/rejected files
- Search excludes pending/rejected files
- File counts only include approved files
- `_inbox` and `_inbox/*` folders excluded from public folder listings
- Pending files visible to uploader and admins, not other users

### Orphan finder tests
- Detects files on disk not in DB
- Detects DB records with missing files
- Detects stale rejected files
- Detects empty inbox session folders

## What This Does NOT Change

- Admin upload flow (web UI and CLI) -- unchanged, files go directly to approved
- Existing file/folder management -- move, delete, tags all work the same
- Public browsing experience -- visitors see the same content, just no pending files
- CLI tool -- remains admin-only, uploads as `approved`
- Job handlers (archive extraction, BSP extraction) -- create files as `approved`
