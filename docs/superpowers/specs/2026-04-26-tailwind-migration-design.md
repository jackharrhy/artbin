# Tailwind Migration Design

**Goal:** Replace all hand-written CSS (app.css component classes, inline `<style>` tags, inline `style={{}}` props) with Tailwind v4 utility classes while preserving the museum-catalog aesthetic.

**Architecture:** Tailwind v4 is already installed and configured (`@tailwindcss/vite` plugin, `@import "tailwindcss"`, `@theme` block). It's just unused outside the error boundary. This migration wires it up properly.

## Design Tokens

Extend the existing `@theme` block with tokens for hardcoded values scattered across inline styles. The current 9 tokens cover the basics but many inline styles use `#888`, `#999`, `#eee`, `#f5f5f5` without referencing tokens.

New `@theme`:

```css
@theme {
  --font-sans: "Times New Roman", Georgia, serif;
  --font-mono: "Courier New", Courier, monospace;

  --color-border: #222;
  --color-border-light: #ccc;
  --color-text: #111;
  --color-text-muted: #666;
  --color-text-faint: #999;
  --color-bg: #fff;
  --color-bg-hover: #f5f5f5;
  --color-bg-page: #f0f0f0;
  --color-bg-subtle: #eee;
  --color-accent: #111;
}
```

Tailwind v4 automatically generates utilities from `@theme` variables (e.g., `text-text-muted`, `bg-bg-hover`, `border-border-light`).

## What Stays in app.css

After migration, `app.css` retains only:

1. `@import "tailwindcss"` and `@theme` block
2. Base element resets (`html`, `body`, `a`, `::selection`, scrollbar)
3. `@utility` rules for high-reuse patterns that would be unwieldy as inline utilities:
   - `.btn` / `.btn-primary` / `.btn-sm` / `.btn-danger` (used dozens of times)
   - `.input` (form inputs, used many times)
   - `.card` (used across routes)
   - `.modal-overlay` / `.modal` (complex overlay positioning)
   - `.upload-zone` (drag-and-drop styling with complex states)

Everything else moves to inline Tailwind utilities in JSX.

## What Gets Converted to Inline Utilities

All of these become `className="..."` strings:

- Layout classes (`.header`, `.main-content`, `.page-title`, etc.)
- Grid systems (`.texture-grid`, `.folder-grid`, `.file-list-container`)
- Component layout (`.breadcrumb`, `.detail-grid`, `.form-group`)
- All 222 inline `style={{}}` props
- All 5 inline `<style>` tag blocks
- Admin page styles (`.archive-tree`, `.pagination`, etc.)

## Aesthetic Preservation

The Tailwind output preserves the spirit of the current design:

- Serif font via `font-sans` (mapped to Times New Roman in theme)
- No `rounded-*` classes anywhere -- everything stays sharp-cornered
- Monochrome palette from theme tokens
- Dense, catalog-like spacing using Tailwind's scale (snapping to nearest rather than exact pixel values)
- Thin 1px borders via `border` + `border-border` / `border-border-light`

## File Migration Order

Migrate bottom-up: shared components first, then routes.

**Phase 1 -- Shared components (8 files):**
Header, BrowseTabs, SearchBar, FileGrid, FileList, MoveFolderModal, UploadModal, ModelViewer

**Phase 2 -- Route pages (12 UI files):**
home, login, register, settings, invite.$code, folders, folder.$slug, file.$, admin.jobs, admin.import, admin.scan-settings, admin.archives

**Phase 3 -- Cleanup:**
Delete all dead CSS from app.css. Run format/lint/typecheck/test. Verify visual appearance matches.

## Verification

After each phase: `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test`.
After full migration: visual spot-check of key pages (folders list, file detail, admin pages).
