# CLI Browse UI Design

**Goal:** After scanning local game directories, the CLI opens a browser-based UI for browsing scan results in a tree view, selecting archives/files, and importing them to the artbin server. Replaces the terminal-only scan output with an interactive experience similar to the admin archives page.

**Context:** The CLI (`apps/cli`) already has `artbin scan` and `artbin import`. This adds a browser-based selection step between scan and import. Shared React components live in a new `@artbin/ui` package, used by both the admin archives page and the CLI's local browse UI.

## Decisions

- **Shared UI package.** New `packages/ui` (`@artbin/ui`) with the tree view, archive item, and batch selection components. Extracted from `admin.archives.tsx`. Used by both the admin page and the CLI's local React app.
- **Bundled React app.** The CLI bundles a small React SPA (built from `apps/cli/src/ui/`) that gets served from a local HTTP server. Built with Vite, output is a single HTML file with inlined JS/CSS.
- **Scan then prompt.** `artbin scan <path>` finishes, prints summary to terminal, then asks "Open browser to browse and import? (Y/n)". `--browse` flag skips the prompt and opens immediately.
- **CLI handles extraction + upload.** The local UI sends archive selections to the CLI's local server. The CLI extracts archives locally using `@artbin/core` and uploads via the existing `/api/cli/upload` endpoint. Admin users get direct uploads; non-admin users get staged/pending uploads.
- **Non-admin CLI support.** Update `/api/cli/upload` to check `user.isAdmin`. Non-admin uploads go to the inbox with `status: 'pending'`, same as the web upload flow. Remove the admin-only restriction from the CLI API endpoints (keep it on the auth routes -- non-admins can still log in, they just get pending uploads).

## Architecture

```
packages/ui/          @artbin/ui -- shared React components
  src/
    ScanTreeView.tsx  -- tree view with checkboxes, collapsible folders
    ArchiveItem.tsx   -- individual archive with type badge, size, game dir tag
    BatchControls.tsx -- "Import N selected" button + destination folder form
    types.ts          -- shared types (FoundArchive, TreeNode, etc.)

apps/cli/
  src/
    ui/
      index.html      -- entry point for the local React app
      App.tsx          -- main component: fetches scan data, renders tree, handles import
      main.tsx         -- React mount point
    commands/
      scan.ts          -- updated: after scan, prompt to open browse UI
    lib/
      browse-server.ts -- local HTTP server: serves the React app + scan data API + import trigger
```

## CLI Flow

1. `artbin scan ~/Games` runs the scan (same as before)
2. Terminal shows summary: "Found 15 archives and 23 loose files"
3. Prompt: "Open browser to browse and import? (Y/n)" (skipped with `--browse`)
4. If yes:
   - CLI starts a local HTTP server on a random port
   - Serves the built React app at `http://localhost:<port>/`
   - Exposes scan results at `GET /api/scan-results` (JSON)
   - Exposes server info at `GET /api/info` (server URL, user info, isAdmin)
   - Opens the browser to the local URL
5. User browses the tree view, selects archives, picks a destination folder (dropdown of existing server folders fetched from `/api/cli/folders` or similar)
6. User clicks "Import Selected"
7. The React app POSTs to the local server at `POST /api/import` with the selection
8. The CLI's local server runs the same extraction + upload pipeline as `artbin import`
9. Progress is streamed back to the React app (SSE or polling)
10. When done, the React app shows results. User can close the tab.
11. CLI detects the import is complete and exits (or keeps running for more selections)

## Local Server API

All endpoints on the CLI's local HTTP server (not the artbin server):

- `GET /` -- serves the React SPA HTML
- `GET /api/scan-results` -- returns the scan results JSON (archives + loose files)
- `GET /api/info` -- returns `{ serverUrl, user: { name, isAdmin }, folders: [...] }` (fetched from artbin server on startup)
- `POST /api/import` -- body: `{ archives: string[], destinationFolder: string }`. Triggers the extraction + upload pipeline. Returns streaming progress or a job ID to poll.
- `GET /api/import-status` -- poll for import progress (if not using SSE)

## `@artbin/ui` Package

### Package setup

```json
{
  "name": "@artbin/ui",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

No build step -- consumed via workspace resolution like `@artbin/core`. Uses `.tsx` source directly.

### Components to extract from `admin.archives.tsx`

1. **`ScanTreeView`** -- the recursive tree view with checkboxes. Props: `{ tree, selectedPaths, onToggleArchive, onToggleFolder }`. Extracted from `TreeNodeView`.

2. **`ArchiveItem`** -- a single archive row with type badge, size, game dir tag, checkbox. Props: `{ archive, isSelected, onToggle }`. Extracted from `ArchiveItem`.

3. **`BatchControls`** -- the floating "Import N selected" button and destination form. Props: `{ selectedCount, onImport, folders, onClear }`.

4. **Types** -- `FoundArchive`, `TreeNode` interfaces. `buildTree`, `countArchives`, `getAllArchivePaths` utility functions.

### What stays in admin.archives.tsx

The route-specific logic: loader (reads job results from DB), action (creates jobs), scanning controls, job status polling. These aren't reusable -- the CLI version uses a completely different data flow.

### What the CLI's React app provides

The CLI's `App.tsx` composes the shared components with its own data fetching (from the local server) and import action (POST to local server). It also provides the destination folder selector (fetched from the artbin server via the local proxy).

## Non-Admin CLI Upload Changes

Currently `api.cli.upload.tsx` uses `requireCliAdmin` which rejects non-admin users. Change this:

1. Replace `requireCliAdmin` with a new `requireCliAuth` that allows any authenticated user (not just admins)
2. In the upload handler, check `user.isAdmin`:
   - Admin: same as before (save to target folder, status approved)
   - Non-admin: create an upload session via `createUploadSession(user.id)`, save files to inbox, set status pending, store suggestedFolderId
3. Same change for `api.cli.folders` -- non-admins should be able to read folders (for the destination dropdown) but not create them
4. `api.cli.manifest` -- works for both admin and non-admin (just checks if files exist)

The `api.cli.whoami` endpoint already returns `isAdmin`, so the CLI and local UI know what UX to show.

## Build Pipeline

The CLI's React app needs to be built into a single HTML file (with inlined JS/CSS) that can be served from memory. Options:

1. **Vite build** in `apps/cli/` that outputs a single HTML file, which `tsup` then inlines as a string constant in the CLI bundle
2. **Pre-built during `pnpm run cli:build`** -- a separate Vite build step runs first, outputs to `apps/cli/src/ui/dist/`, then tsup bundles the CLI and inlines the HTML

Option 2 is simpler. The `cli:build` script becomes: `vite build --config ui.vite.config.ts && tsup`.

The React app's Vite config uses `@vitejs/plugin-react` and outputs a single HTML file with `build.rollupOptions.output.inlineDynamicImports`.

## Testing

- **`@artbin/ui` components**: Extracting from admin.archives.tsx is a refactor -- existing admin page should still work identically. No new component tests needed initially (the components are presentational).
- **CLI browse server**: Test the local API endpoints -- `/api/scan-results` returns correct JSON, `/api/import` triggers the upload pipeline.
- **Non-admin CLI upload**: Test that non-admin uploads via `api.cli.upload` go to inbox with pending status (add to existing `cli-api.test.ts`).

## What This Does NOT Change

- `artbin import` command -- unchanged, still works for direct CLI import without UI
- `artbin login` / `artbin logout` -- unchanged
- Admin archives page -- refactored to use `@artbin/ui` components but functionally identical
- Web upload flow -- unchanged
