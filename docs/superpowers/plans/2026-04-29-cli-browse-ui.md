# CLI Browse UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `artbin scan`, open a local browser UI for browsing scan results, selecting archives, and importing them to the artbin server.

**Architecture:** The CLI starts a local HTTP server that serves a bundled React SPA and exposes scan data + import trigger APIs. Shared tree view components are extracted from `admin.archives.tsx` into a new `@artbin/ui` package, consumed by both the admin page and the CLI's local app. Non-admin users get pending uploads via updated CLI API endpoints.

**Tech Stack:** React 19, Vite (for SPA build), tsup (CLI bundle), `@artbin/ui` (shared components), Node HTTP server (local browse server)

---

### Task 1: Create `@artbin/ui` package scaffold

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@artbin/ui",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "react": "^19.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `src/types.ts`**

Extract the shared types used by both the admin archives page and the CLI browse UI. These currently live inline in `admin.archives.tsx`.

```typescript
export interface FoundArchive {
  path: string;
  name: string;
  type: string;
  size: number;
  fileCount: number;
  gameDir: string | null;
}

export interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  archives: FoundArchive[];
}
```

- [ ] **Step 4: Create `src/index.ts`**

```typescript
export { ScanTreeView } from "./ScanTreeView";
export { ArchiveItem } from "./ArchiveItem";
export { BatchControls } from "./BatchControls";
export { buildTree, countArchives, getAllArchivePaths } from "./tree-utils";
export type { FoundArchive, TreeNode } from "./types";
```

This will have import errors until the component files are created in subsequent tasks. That's expected.

- [ ] **Step 5: Install deps and verify workspace resolution**

Run: `pnpm install`

Verify that `@artbin/ui` appears in `pnpm-workspace.yaml` packages glob (`packages/*`).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/
git commit -m "scaffold @artbin/ui package with shared types"
```

---

### Task 2: Extract tree utilities into `@artbin/ui`

**Files:**
- Create: `packages/ui/src/tree-utils.ts`
- Modify: `apps/web/src/routes/admin.archives.tsx` (lines 238-289 -- the utility functions)

- [ ] **Step 1: Create `packages/ui/src/tree-utils.ts`**

Extract `buildTree`, `countArchives`, and `getAllArchivePaths` from `admin.archives.tsx` (lines 238-289). These are pure functions with no React or framework dependencies.

```typescript
import type { FoundArchive, TreeNode } from "./types";

export function buildTree(archives: FoundArchive[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), archives: [] };

  for (const archive of archives) {
    const parts = archive.path.split("/");
    const fileName = parts.pop()!;
    let current = root;

    for (const part of parts) {
      if (!current.children.has(part)) {
        const childPath = current.path ? `${current.path}/${part}` : part;
        current.children.set(part, {
          name: part,
          path: childPath,
          children: new Map(),
          archives: [],
        });
      }
      current = current.children.get(part)!;
    }

    current.archives.push(archive);
  }

  return root;
}

export function countArchives(node: TreeNode): number {
  let count = node.archives.length;
  for (const child of node.children.values()) {
    count += countArchives(child);
  }
  return count;
}

export function getAllArchivePaths(node: TreeNode): string[] {
  const paths: string[] = node.archives.map((a) => a.path);
  for (const child of node.children.values()) {
    paths.push(...getAllArchivePaths(child));
  }
  return paths;
}
```

- [ ] **Step 2: Update `admin.archives.tsx` to import from `@artbin/ui`**

Replace the inline `buildTree`, `countArchives`, `getAllArchivePaths` functions and the `FoundArchive`/`TreeNode` type definitions with imports:

```typescript
import { buildTree, countArchives, getAllArchivePaths } from "@artbin/ui/tree-utils";
import type { FoundArchive, TreeNode } from "@artbin/ui/types";
```

Delete the original function bodies (lines ~238-289) and the inline type definitions from the file.

- [ ] **Step 3: Run the admin archives tests / typecheck**

Run: `pnpm run ci` from repo root.
Expected: All tests pass, no type errors. The admin archives page uses the same logic from the new package.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/tree-utils.ts apps/web/src/routes/admin.archives.tsx
git commit -m "extract tree utilities from admin.archives into @artbin/ui"
```

---

### Task 3: Extract `ScanTreeView` component

**Files:**
- Create: `packages/ui/src/ScanTreeView.tsx`
- Modify: `apps/web/src/routes/admin.archives.tsx` (replace inline `TreeNodeView`)

- [ ] **Step 1: Create `packages/ui/src/ScanTreeView.tsx`**

Extract the `TreeNodeView` component (lines 290-380 of `admin.archives.tsx`). Make it generic -- accept callbacks as props instead of using `Form` or route-specific logic.

```tsx
import { useRef, useEffect, type ReactNode } from "react";
import type { TreeNode, FoundArchive } from "./types";
import { countArchives, getAllArchivePaths } from "./tree-utils";

export interface ScanTreeViewProps {
  node: TreeNode;
  depth?: number;
  selectedPaths: Set<string>;
  onToggleArchive: (path: string) => void;
  onToggleFolder: (paths: string[], selected: boolean) => void;
  renderArchive: (archive: FoundArchive, isSelected: boolean) => ReactNode;
}

export function ScanTreeView({
  node,
  depth = 0,
  selectedPaths,
  onToggleArchive,
  onToggleFolder,
  renderArchive,
}: ScanTreeViewProps) {
  // Path compression: collapse single-child chains with no archives
  let displayNode = node;
  let displayName = node.name;
  while (
    displayNode.children.size === 1 &&
    displayNode.archives.length === 0
  ) {
    const child = [...displayNode.children.values()][0];
    displayName = displayName ? `${displayName}/${child.name}` : child.name;
    displayNode = child;
  }

  const archiveCount = countArchives(displayNode);
  const allPaths = getAllArchivePaths(displayNode);
  const selectedCount = allPaths.filter((p) => selectedPaths.has(p)).length;
  const allSelected = selectedCount === archiveCount && archiveCount > 0;
  const someSelected = selectedCount > 0 && !allSelected;

  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const sortedChildren = [...displayNode.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <details open={depth < 2}>
      <summary className="flex items-center gap-2 py-1 cursor-pointer select-none hover:bg-bg-subtle -mx-2 px-2">
        {archiveCount > 0 && (
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={allSelected}
            onChange={() => onToggleFolder(allPaths, !allSelected)}
            className="shrink-0"
          />
        )}
        <span className="text-sm">
          {displayName}
        </span>
        {archiveCount > 0 && (
          <span className="text-xs text-text-faint">({archiveCount})</span>
        )}
      </summary>

      <div className="ml-4">
        {sortedChildren.map((child) => (
          <ScanTreeView
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPaths={selectedPaths}
            onToggleArchive={onToggleArchive}
            onToggleFolder={onToggleFolder}
            renderArchive={renderArchive}
          />
        ))}

        {displayNode.archives
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((archive) => renderArchive(archive, selectedPaths.has(archive.path)))}
      </div>
    </details>
  );
}
```

The key difference from the original: `renderArchive` is a render prop. The admin page passes its own `ArchiveItem` with the import form. The CLI browse UI passes a simpler version without server-side forms.

- [ ] **Step 2: Update `admin.archives.tsx` to use the extracted component**

Replace the inline `TreeNodeView` component with:

```typescript
import { ScanTreeView } from "@artbin/ui";
```

Adapt the call site to pass the `renderArchive` prop, rendering the existing `ArchiveItem` inline component.

- [ ] **Step 3: Run typecheck and verify**

Run: `pnpm run ci`
Expected: All tests pass. The admin archives page renders identically.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/ScanTreeView.tsx apps/web/src/routes/admin.archives.tsx
git commit -m "extract ScanTreeView component into @artbin/ui"
```

---

### Task 4: Extract `ArchiveItem` and `BatchControls` components

**Files:**
- Create: `packages/ui/src/ArchiveItem.tsx`
- Create: `packages/ui/src/BatchControls.tsx`
- Modify: `apps/web/src/routes/admin.archives.tsx`

- [ ] **Step 1: Create `packages/ui/src/ArchiveItem.tsx`**

Extract the archive item display component (lines 382-467 of `admin.archives.tsx`). This is the row with icon, name, badges, checkbox, and collapsible details.

Make it generic: the expandable content (import form vs. file list) is passed as a `children` prop or render prop.

```tsx
import type { FoundArchive } from "./types";

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function archiveIcon(type: string): string {
  switch (type) {
    case "pak": return "📦";
    case "pk3": return "📦";
    case "bsp": return "🗺️";
    case "zip": return "🗜️";
    case "wad": return "💾";
    default: return "📄";
  }
}

export interface ArchiveItemProps {
  archive: FoundArchive;
  isSelected: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}

export function ArchiveItem({ archive, isSelected, onToggle, children }: ArchiveItemProps) {
  return (
    <div className="flex items-start gap-2 py-1">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        className="mt-1 shrink-0"
      />
      <details className="flex-1 min-w-0">
        <summary className="flex items-center gap-2 cursor-pointer select-none">
          <span>{archiveIcon(archive.type)}</span>
          <span className="text-sm truncate">{archive.name}</span>
          <span className="text-xs px-1 bg-bg-subtle border border-border-light">
            {archive.type.toUpperCase()}
          </span>
          <span className="text-xs text-text-faint">{formatSize(archive.size)}</span>
          {archive.fileCount > 0 && (
            <span className="text-xs text-text-faint">({archive.fileCount} files)</span>
          )}
          {archive.gameDir && (
            <span className="text-xs px-1 bg-bg-subtle border border-border-light text-text-muted">
              {archive.gameDir}
            </span>
          )}
        </summary>
        {children && <div className="mt-2 ml-6">{children}</div>}
      </details>
    </div>
  );
}
```

- [ ] **Step 2: Create `packages/ui/src/BatchControls.tsx`**

Extract the batch import button/modal (lines 469-573). Make it generic -- the form content (folder name input, submit button) is passed as children.

```tsx
import { useState } from "react";

export interface BatchControlsProps {
  selectedCount: number;
  onClear: () => void;
  children: (props: { close: () => void }) => React.ReactNode;
}

export function BatchControls({ selectedCount, onClear, children }: BatchControlsProps) {
  const [open, setOpen] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <div className="border border-border-light bg-bg p-4 shadow-lg w-80">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">
              {selectedCount} archive{selectedCount === 1 ? "" : "s"} selected
            </span>
            <button
              type="button"
              className="text-xs text-text-muted hover:text-text"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          {children({ close: () => setOpen(false) })}
          <button
            type="button"
            className="btn btn-sm text-xs mt-2 w-full"
            onClick={() => { onClear(); setOpen(false); }}
          >
            Clear Selection
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setOpen(true)}
        >
          Import {selectedCount} Selected
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `admin.archives.tsx`**

Replace inline `ArchiveItem` and `BatchImportButton` with imports from `@artbin/ui`. Adapt call sites to pass children/render props for the admin-specific form content.

- [ ] **Step 4: Run CI**

Run: `pnpm run ci`
Expected: All tests pass. Admin archives page functionally identical.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/ apps/web/src/routes/admin.archives.tsx
git commit -m "extract ArchiveItem and BatchControls into @artbin/ui"
```

---

### Task 5: Non-admin CLI API support

**Files:**
- Create: `apps/web/src/lib/cli-auth-any.server.ts` (or modify `cli-auth.server.ts`)
- Modify: `apps/web/src/routes/api.cli.upload.tsx`
- Modify: `apps/web/src/routes/api.cli.folders.tsx`
- Modify: `apps/web/src/routes/api.cli.manifest.tsx`
- Test: `apps/web/test/cli-api.test.ts`

- [ ] **Step 1: Write failing tests for non-admin CLI upload**

Add to `apps/web/test/cli-api.test.ts`:

```typescript
test("non-admin upload creates pending files in inbox session", async () => {
  // Create a non-admin user with a session
  // Upload a file via /api/cli/upload
  // Assert: file has status "pending", is in an _inbox session folder
  // Assert: response includes pendingUpload: true
});

test("non-admin can read folders via /api/cli/folders", async () => {
  // Create a non-admin user with a session
  // POST to /api/cli/folders with no folders to create
  // Assert: 200 response (not 403)
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/cli-api.test.ts`
Expected: FAIL -- non-admin requests get 403 from `requireCliAdmin`.

- [ ] **Step 3: Add `requireCliAuth` to `cli-auth.server.ts`**

Add a new function that authenticates but does NOT require admin:

```typescript
export async function requireCliAuth(request: Request): Promise<User> {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);
  if (!user) {
    throw Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  return user;
}
```

- [ ] **Step 4: Update `api.cli.upload.tsx` for non-admin uploads**

Replace `requireCliAdmin` with `requireCliAuth`. After auth, check `user.isAdmin`:
- Admin: same as current (save to target folder, status approved)
- Non-admin: create upload session via `createUploadSession(user.id)`, save files to inbox session, set `status: "pending"`, set `suggestedFolderId` from the metadata's `parentFolder`

- [ ] **Step 5: Update `api.cli.folders.tsx` and `api.cli.manifest.tsx`**

Replace `requireCliAdmin` with `requireCliAuth`. Non-admins can read folders and check manifests but not create folders (return an error or skip folder creation for non-admins).

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run test/cli-api.test.ts`
Expected: All tests pass including the new non-admin tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ apps/web/test/
git commit -m "allow non-admin CLI uploads (pending status in inbox)"
```

---

### Task 6: CLI browse server

**Files:**
- Create: `apps/cli/src/lib/browse-server.ts`

- [ ] **Step 1: Implement the local HTTP server**

The browse server is a plain Node `http.createServer` that:
- Serves the bundled React SPA HTML at `GET /`
- Exposes scan results at `GET /api/scan-results`
- Exposes server info + folders at `GET /api/info`
- Accepts import requests at `POST /api/import`
- Reports import progress at `GET /api/import-status`

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { ScanResult } from "./scanner";
import type { ApiClient } from "./api";

interface BrowseServerOptions {
  scanResult: ScanResult;
  api: ApiClient;
  html: string; // The bundled SPA HTML
  serverUrl: string;
  user: { name: string; isAdmin: boolean };
}

export function startBrowseServer(options: BrowseServerOptions): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost`);

      if (url.pathname === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(options.html);
        return;
      }

      if (url.pathname === "/api/scan-results" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(options.scanResult));
        return;
      }

      if (url.pathname === "/api/info" && req.method === "GET") {
        // Fetch folder list from server via the API client.
        // The createFolders endpoint with an empty array returns existing folders.
        // Alternatively, add a GET /api/cli/folders read-only endpoint in Task 5.
        let folders: any[] = [];
        try {
          const result = await options.api.createFolders([]);
          folders = result.existing ?? [];
        } catch {}

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          serverUrl: options.serverUrl,
          user: options.user,
          folders,
        }));
        return;
      }

      if (url.pathname === "/api/import" && req.method === "POST") {
        // Parse body, trigger import pipeline
        // Stream progress back
        const body = await readBody(req);
        const { archives, destinationFolder } = JSON.parse(body);
        // ... trigger extraction + upload (reuse import.ts logic)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "started" }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    // Listen on random port
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => server.close(),
      });
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
```

- [ ] **Step 2: Extract reusable import pipeline from `import.ts`**

Refactor `apps/cli/src/commands/import.ts` to extract the core extraction + upload logic into a reusable function in `apps/cli/src/lib/importer.ts` that both the CLI `import` command and the browse server's `/api/import` handler can call.

Key function: `async function runImport(options: { scanResult, api, rootSlug, archives, onProgress })`

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/lib/
git commit -m "add browse server and extract reusable import pipeline"
```

---

### Task 7: CLI browse React SPA

**Files:**
- Create: `apps/cli/src/ui/index.html`
- Create: `apps/cli/src/ui/main.tsx`
- Create: `apps/cli/src/ui/App.tsx`
- Create: `apps/cli/ui.vite.config.ts`

- [ ] **Step 1: Create Vite config for the SPA build**

```typescript
// apps/cli/ui.vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "src/ui",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../../dist-ui",
    emptyOutDir: true,
  },
});
```

Install dev deps: `pnpm add -D --filter artbin vite @vitejs/plugin-react vite-plugin-singlefile`

- [ ] **Step 2: Create `src/ui/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>artbin - Browse Scan Results</title>
  <style>
    /* Inline minimal styles matching the artbin aesthetic */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Times New Roman', serif; background: #f5f5f0; color: #1a1a1a; }
    /* ... additional base styles ... */
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

- [ ] **Step 3: Create `src/ui/main.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 4: Create `src/ui/App.tsx`**

```tsx
import { useState, useEffect, useMemo } from "react";
import { ScanTreeView, ArchiveItem, BatchControls, buildTree } from "@artbin/ui";
import type { FoundArchive, TreeNode } from "@artbin/ui/types";

interface ServerInfo {
  serverUrl: string;
  user: { name: string; isAdmin: boolean };
  folders: { id: string; name: string; slug: string }[];
}

export function App() {
  const [scanResult, setScanResult] = useState<any>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetch("/api/scan-results").then(r => r.json()).then(setScanResult);
    fetch("/api/info").then(r => r.json()).then(setInfo);
  }, []);

  const archives: FoundArchive[] = useMemo(() => {
    if (!scanResult) return [];
    return scanResult.archives.map((a: any) => ({
      path: a.path,
      name: a.name,
      type: a.type,
      size: a.size,
      fileCount: a.entries?.length ?? 0,
      gameDir: a.gameDir,
    }));
  }, [scanResult]);

  const tree = useMemo(() => buildTree(archives), [archives]);

  // ... toggle handlers, import handler, render tree + batch controls
  // Uses the same ScanTreeView, ArchiveItem, BatchControls from @artbin/ui
  // Import handler POSTs to /api/import on the local server

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <h1>artbin - Scan Results</h1>
      {info && <p>Connected to {info.serverUrl} as {info.user.name}</p>}
      {/* Tree view with archive items */}
      {/* Batch controls */}
    </div>
  );
}
```

This is a skeleton -- the full implementation will compose the `@artbin/ui` components with local state management and the local server API calls.

- [ ] **Step 5: Build the SPA and verify it produces a single HTML file**

Run: `pnpm --filter artbin exec vite build --config ui.vite.config.ts`
Expected: `apps/cli/dist-ui/index.html` exists as a single file with inlined JS/CSS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/ui/ apps/cli/ui.vite.config.ts
git commit -m "add CLI browse React SPA with @artbin/ui components"
```

---

### Task 8: Wire up `artbin scan --browse`

**Files:**
- Modify: `apps/cli/src/commands/scan.ts`
- Modify: `apps/cli/tsup.config.ts`
- Modify: `apps/cli/package.json`

- [ ] **Step 1: Update scan command to offer browse after scan**

After scan completes and summary is printed, add:

```typescript
import { confirm } from "@clack/prompts";

// After scan summary...
const shouldBrowse = args["--browse"] || await confirm({
  message: "Open browser to browse and import?",
  initialValue: true,
});

if (shouldBrowse) {
  const { startBrowseServer } = await import("../lib/browse-server");
  const config = await loadConfig();
  if (!config) {
    log.error("Not logged in. Run 'artbin login' first.");
    return;
  }
  const api = new ApiClient(config);
  const whoami = await api.whoami();

  // Read the bundled HTML (inlined at build time)
  const html = BROWSE_UI_HTML; // injected by tsup define

  const { port, close } = await startBrowseServer({
    scanResult: result,
    api,
    html,
    serverUrl: config.serverUrl,
    user: { name: whoami.user.name, isAdmin: whoami.user.isAdmin },
  });

  log.info(`Browse UI at http://localhost:${port}/`);
  // Open browser
  const open = (await import("open")).default;
  await open(`http://localhost:${port}/`);

  // Keep running until user presses Ctrl+C
  await new Promise(() => {}); // block forever
}
```

- [ ] **Step 2: Update CLI build pipeline**

Update `apps/cli/package.json` scripts:

```json
{
  "scripts": {
    "build:ui": "vite build --config ui.vite.config.ts",
    "build": "pnpm run build:ui && tsup",
    "dev": "tsup --watch"
  }
}
```

Update `apps/cli/tsup.config.ts` to inline the built SPA HTML as a string constant:

```typescript
import { readFileSync } from "fs";

const uiHtml = readFileSync("dist-ui/index.html", "utf-8");

export default defineConfig({
  // ... existing config ...
  define: {
    BROWSE_UI_HTML: JSON.stringify(uiHtml),
  },
});
```

Add `open` to CLI dev dependencies: `pnpm add -D --filter artbin open`

- [ ] **Step 3: Add type declaration for the injected constant**

Create `apps/cli/src/globals.d.ts`:

```typescript
declare const BROWSE_UI_HTML: string;
```

- [ ] **Step 4: Build and test locally**

Run: `pnpm run --filter artbin build`
Run: `node apps/cli/dist/index.js scan ~/some-game-dir --browse`
Expected: Browser opens with the scan results tree view.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/
git commit -m "wire up artbin scan --browse to open local browse UI"
```

---

### Task 9: Import pipeline in browse server

**Files:**
- Modify: `apps/cli/src/lib/browse-server.ts`
- Modify: `apps/cli/src/lib/importer.ts` (created in Task 6)

- [ ] **Step 1: Implement `/api/import` handler**

The browse server's import endpoint:
1. Parses the request body: `{ archives: string[], destinationFolder: string }`
2. Filters the scan result to only the selected archive paths
3. Calls the reusable import pipeline (extracted in Task 6)
4. Stores progress in a shared state object
5. Returns `{ jobId: "local-1" }`

- [ ] **Step 2: Implement `/api/import-status` endpoint**

Returns the current import progress:

```json
{
  "status": "running",
  "progress": 45,
  "message": "Uploading batch 3/7...",
  "uploaded": 12,
  "failed": 0,
  "total": 28
}
```

Or when complete:

```json
{
  "status": "complete",
  "uploaded": 28,
  "failed": 0,
  "total": 28
}
```

- [ ] **Step 3: Wire progress polling in the React SPA**

Update `App.tsx` to poll `/api/import-status` every second after starting an import. Show a progress bar and result summary.

- [ ] **Step 4: Test locally end-to-end**

Run: `pnpm run --filter artbin build`
Test: Scan a directory, open browse UI, select some archives, import them, verify they appear on the server.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/
git commit -m "implement import pipeline in browse server with progress tracking"
```

---

### Task 10: Update `justfile` and CI

**Files:**
- Modify: `justfile`
- Modify: `apps/cli/package.json`

- [ ] **Step 1: Add UI deps to pnpm-workspace**

Verify `packages/ui` is picked up by the workspace glob in `pnpm-workspace.yaml`. Add `@artbin/ui` as a dev dependency to both `apps/web` and `apps/cli`:

```bash
pnpm add -D --filter @artbin/web @artbin/ui --workspace
pnpm add -D --filter artbin @artbin/ui --workspace
```

- [ ] **Step 2: Update justfile if needed**

Add `cli-build-ui` recipe if helpful, or verify `cli-build` runs the full pipeline.

- [ ] **Step 3: Run full CI from repo root**

Run: `pnpm run ci`
Expected: All packages typecheck and test successfully.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "finalize CLI browse UI build pipeline and CI integration"
```
