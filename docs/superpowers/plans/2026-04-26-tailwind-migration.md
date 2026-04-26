# Tailwind Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hand-written CSS with Tailwind v4 utility classes while preserving the museum-catalog aesthetic.

**Architecture:** Tailwind v4 is already installed. The `@theme` block holds design tokens. Migration converts CSS classes and inline styles to utility classes in JSX, keeping only base resets and high-reuse `@utility` rules in `app.css`.

**Tech Stack:** Tailwind CSS v4, React, React Router

---

## Reference: Design Token Mapping

Use these Tailwind classes throughout. The `@theme` tokens generate utilities automatically:

| CSS value | Tailwind class |
|---|---|
| `color: var(--color-text)` / `#111` | `text-text` |
| `color: var(--color-text-muted)` / `#666` | `text-text-muted` |
| `color: #999` | `text-text-faint` (new token) |
| `background: #fff` | `bg-bg` or `bg-white` |
| `background: var(--color-bg-hover)` / `#f5f5f5` | `bg-bg-hover` |
| `background: #f0f0f0` | `bg-bg-page` (new token) |
| `background: #eee` | `bg-bg-subtle` (new token) |
| `border-color: var(--color-border)` / `#222` | `border-border` |
| `border-color: var(--color-border-light)` / `#ccc` | `border-border-light` |
| `font-family: var(--font-mono)` | `font-mono` |
| `font-size: 0.75rem` | `text-xs` |
| `font-size: 0.875rem` | `text-sm` |
| `font-size: 1rem` | `text-base` |
| `font-size: 1.125rem` | `text-lg` |
| `font-size: 1.25rem` | `text-xl` |
| `gap: 0.5rem` | `gap-2` |
| `gap: 0.75rem` | `gap-3` |
| `gap: 1rem` | `gap-4` |
| `padding: 0.5rem` | `p-2` |
| `padding: 0.75rem` | `p-3` |
| `padding: 1rem` | `p-4` |
| `margin-bottom: 0.5rem` | `mb-2` |
| `margin-bottom: 1rem` | `mb-4` |

**Important:** No `rounded-*` classes anywhere. Everything stays sharp-cornered.

## Reference: Classes to Keep as @utility in app.css

These appear too many times to inline every occurrence. Keep them as `@utility` rules:

- `.btn` / `.btn-primary` / `.btn-sm` / `.btn-danger` -- used 50+ times across the app
- `.input` -- used in every form
- `.card` -- used across many routes
- `.modal-overlay` / `.modal` / `.modal-header` / `.modal-body` / `.modal-footer` / `.modal-close` -- complex overlay system
- `.upload-zone` / `.upload-progress-bar` / `.upload-progress-fill` -- complex states
- `.alert` / `.alert-error` / `.alert-success` -- reusable pattern

Convert these from plain CSS classes to `@utility` blocks in Tailwind v4 syntax:
```css
@utility btn {
  display: inline-block;
  padding: 0.375rem 0.75rem;
  /* ... */
}
```

---

### Task 1: Update @theme and convert app.css to @utility rules

**Files:**
- Modify: `src/app.css`

- [ ] **Step 1: Extend @theme with missing tokens**

Add `--color-text-faint`, `--color-bg-page`, `--color-bg-subtle`, `--color-danger`, `--color-success` to the `@theme` block.

- [ ] **Step 2: Convert high-reuse classes to @utility blocks**

Convert `.btn`, `.btn-primary`, `.btn-sm`, `.btn-danger`, `.input`, `.card`, `.card-bordered`, `.modal-*`, `.upload-zone`, `.upload-progress-*`, `.alert`, `.alert-error`, `.alert-success`, `.tag`, `.tag-active` to `@utility` blocks.

- [ ] **Step 3: Delete all other class definitions**

Remove every CSS class rule that will be replaced by inline utilities in JSX: `.header`, `.header-*`, `.main-content`, `.texture-grid`, `.texture-card`, `.folder-grid`, `.folder-card`, `.page-title`, `.section`, `.section-title`, `.filters`, `.breadcrumb`, `.form-group`, `.form-label`, `.form-help`, `.invite-*`, `.auth-*`, `.detail-*`, `.badge-admin`, `.empty-state`, `.grid-header`, `.grid-count`, `.pagination-*`, `.archive-*`, `.tree-*`, `.batch-import-fab`, `.form-row`.

Keep: `@import "tailwindcss"`, `@theme`, base element resets (`html`, `body`, `a`, `::selection`, scrollbar), and the `@utility` blocks.

- [ ] **Step 4: Verify build**

Run: `pnpm run typecheck && pnpm run test`

Note: The app will look broken at this point because JSX still references deleted classes. That's expected -- we fix it file by file in subsequent tasks.

- [ ] **Step 5: Commit**

```
git add src/app.css && git commit -m "refactor app.css: extend theme tokens, convert reusable classes to @utility, delete migrated classes"
```

---

### Task 2: Migrate shared components (Header, BrowseTabs, SearchBar)

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/components/BrowseTabs.tsx`
- Modify: `src/components/SearchBar.tsx`

- [ ] **Step 1: Convert Header.tsx**

Replace all `className="header"`, `className="header-logo"`, `className="header-nav"`, `className="header-link"` with equivalent Tailwind utility strings. Remove any inline `style={{}}` props.

- [ ] **Step 2: Convert BrowseTabs.tsx**

Replace all class names and the inline `<style>` tag with Tailwind utilities.

- [ ] **Step 3: Convert SearchBar.tsx**

Replace all class names and the inline `<style>` tag with Tailwind utilities.

- [ ] **Step 4: Verify**

Run: `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 5: Commit**

```
git add src/components/Header.tsx src/components/BrowseTabs.tsx src/components/SearchBar.tsx
git commit -m "migrate Header, BrowseTabs, SearchBar to Tailwind utilities"
```

---

### Task 3: Migrate FileGrid and FileList

**Files:**
- Modify: `src/components/FileGrid.tsx`
- Modify: `src/components/FileList.tsx`

- [ ] **Step 1: Convert FileGrid.tsx**

Replace `.texture-grid`, `.texture-card`, `.texture-card-info` classes and any inline styles with Tailwind utilities. The texture grid uses `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))` -- use Tailwind's arbitrary value syntax: `grid-cols-[repeat(auto-fill,minmax(180px,1fr))]`.

- [ ] **Step 2: Convert FileList.tsx**

Replace all class names and the inline `<style>` tag with Tailwind utilities.

- [ ] **Step 3: Verify and commit**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
git add src/components/FileGrid.tsx src/components/FileList.tsx
git commit -m "migrate FileGrid and FileList to Tailwind utilities"
```

---

### Task 4: Migrate MoveFolderModal and UploadModal

**Files:**
- Modify: `src/components/MoveFolderModal.tsx`
- Modify: `src/components/UploadModal.tsx`

- [ ] **Step 1: Convert MoveFolderModal.tsx**

Replace all class names (`.modal-*`, `.form-group`, `.form-label`, etc.) and inline `style={{}}` with Tailwind utilities. The modal overlay/container classes stay as `@utility` -- just keep using `className="modal-overlay"` etc.

- [ ] **Step 2: Convert UploadModal.tsx**

Same approach. This is the largest component (595 lines). Replace all inline styles and CSS classes. Keep `.modal-*`, `.btn`, `.input`, `.upload-zone`, `.upload-progress-*` class references since those are `@utility` rules.

- [ ] **Step 3: Verify and commit**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
git add src/components/MoveFolderModal.tsx src/components/UploadModal.tsx
git commit -m "migrate MoveFolderModal and UploadModal to Tailwind utilities"
```

---

### Task 5: Migrate ModelViewer

**Files:**
- Modify: `src/components/ModelViewer.tsx`

- [ ] **Step 1: Convert ModelViewer.tsx**

Replace all inline `style={{}}` props (14 occurrences) with Tailwind utilities. This component has complex Three.js rendering -- only touch the JSX styling, not the scene/animation logic.

- [ ] **Step 2: Verify and commit**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
git add src/components/ModelViewer.tsx
git commit -m "migrate ModelViewer to Tailwind utilities"
```

---

### Task 6: Migrate auth routes (login, register, invite)

**Files:**
- Modify: `src/routes/login.tsx`
- Modify: `src/routes/register.tsx`
- Modify: `src/routes/invite.$code.tsx`

- [ ] **Step 1: Convert all three files**

Replace `.auth-container`, `.auth-title`, `.form-group`, `.form-label`, `.form-help` and all inline styles. These are simple forms with the auth-page layout.

- [ ] **Step 2: Verify and commit**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
git add src/routes/login.tsx src/routes/register.tsx src/routes/invite.\$code.tsx
git commit -m "migrate auth routes to Tailwind utilities"
```

---

### Task 7: Migrate home and settings routes

**Files:**
- Modify: `src/routes/home.tsx`
- Modify: `src/routes/settings.tsx`

- [ ] **Step 1: Convert both files**

Replace all CSS classes and inline styles. Settings page uses `.invite-item`, `.invite-code`, `.invite-meta`, `.form-group` etc.

- [ ] **Step 2: Verify and commit**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
git add src/routes/home.tsx src/routes/settings.tsx
git commit -m "migrate home and settings routes to Tailwind utilities"
```

---

### Task 8: Migrate folders and folder.$slug routes

**Files:**
- Modify: `src/routes/folders.tsx`
- Modify: `src/routes/folder.$slug.tsx`

- [ ] **Step 1: Convert folders.tsx**

Replace `.folder-grid`, `.folder-card`, `.folder-*`, `.page-title`, `.grid-header`, `.grid-count`, `.empty-state`, `.breadcrumb`, and all inline styles.

- [ ] **Step 2: Convert folder.$slug.tsx**

Same classes plus `.section`, `.section-title`, `.detail-grid`. This is a large file (~564 lines) with many inline styles.

- [ ] **Step 3: Verify and commit**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
git add src/routes/folders.tsx src/routes/folder.\$slug.tsx
git commit -m "migrate folders and folder detail routes to Tailwind utilities"
```

---

### Task 9: Migrate file.$ route

**Files:**
- Modify: `src/routes/file.$.tsx`

- [ ] **Step 1: Convert file.$.tsx**

This is the largest route file. Replace `.breadcrumb`, `.file-detail`, `.file-preview`, `.detail-info`, `.text-preview-*`, and the inline `<style>` tag plus all 36 inline `style={{}}` props.

- [ ] **Step 2: Verify and commit**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
git add src/routes/file.\$.tsx
git commit -m "migrate file detail route to Tailwind utilities"
```

---

### Task 10: Migrate admin routes

**Files:**
- Modify: `src/routes/admin.jobs.tsx`
- Modify: `src/routes/admin.import.tsx`
- Modify: `src/routes/admin.scan-settings.tsx`
- Modify: `src/routes/admin.archives.tsx`

- [ ] **Step 1: Convert admin.jobs.tsx**

Replace all inline styles (34 occurrences). Uses `.card`, `.btn` (keep as-is), plus many layout styles.

- [ ] **Step 2: Convert admin.import.tsx**

Replace all inline styles (30 occurrences) and CSS classes.

- [ ] **Step 3: Convert admin.scan-settings.tsx**

Replace `.form-group`, `.form-label`, `.form-help` and inline styles (18 occurrences).

- [ ] **Step 4: Convert admin.archives.tsx**

The most complex admin page. Replace `.archive-tree`, `.tree-folder`, `.tree-archive`, `.tree-*`, `.archive-*`, `.batch-import-fab`, `.pagination-*`, `.form-row` and inline styles (25 occurrences).

- [ ] **Step 5: Verify and commit**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
git add src/routes/admin.jobs.tsx src/routes/admin.import.tsx src/routes/admin.scan-settings.tsx src/routes/admin.archives.tsx
git commit -m "migrate admin routes to Tailwind utilities"
```

---

### Task 11: Final cleanup and verification

**Files:**
- Modify: `src/app.css` (if any dead rules remain)
- Modify: `src/root.tsx` (update error boundary classes if needed)

- [ ] **Step 1: Audit app.css for dead rules**

Search the entire codebase for any CSS class names still defined in app.css. If a class is defined but never referenced in any `.tsx` file, delete it.

- [ ] **Step 2: Search for remaining inline styles**

Run: `grep -r 'style={{' src/` -- there should be zero or near-zero results (some may remain for truly dynamic values like width percentages from data).

- [ ] **Step 3: Search for remaining `<style>` tags**

Run: `grep -r '<style>' src/` -- there should be zero results.

- [ ] **Step 4: Run full verification pipeline**

```
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
```

- [ ] **Step 5: Final commit**

```
git add -A && git commit -m "complete Tailwind migration: remove dead CSS, verify zero inline styles"
```
