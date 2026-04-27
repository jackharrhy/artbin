# Nested Routes + Root Layout Design

**Goal:** Replace flat route structure with nested routes using layout components. Eliminates duplicated Header rendering and auth loading across every route file.

## Route Structure

```ts
// routes.ts
layout("routes/app-layout.tsx", [
  index("routes/home.tsx"),
  route("settings", "routes/settings.tsx"),
  route("folders", "routes/folders.tsx"),
  route("folder/:slug/*", "routes/folder.$slug.tsx"),
  route("file/*", "routes/file.$.tsx"),
  ...prefix("admin", [
    route("jobs", "routes/admin.jobs.tsx"),
    route("import", "routes/admin.import.tsx"),
    route("archives", "routes/admin.archives.tsx"),
    route("scan-settings", "routes/admin.scan-settings.tsx"),
  ]),
]),
layout("routes/auth-layout.tsx", [
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("invite/:code", "routes/invite.$code.tsx"),
]),
// API routes (no layout)
route("api/upload", "routes/api.upload.tsx"),
route("api/folder", "routes/api.folder.tsx"),
route("api/folder/move", "routes/api.folder.move.tsx"),
```

## New Files

**`routes/app-layout.tsx`** -- main app layout
- Loader: loads user via `parseSessionCookie` + `getUserFromSession`
- Component: renders `<Header user={user}>`, `<Outlet>`
- No `<main>` wrapper -- each route controls its own max-width since admin pages use narrower widths

**`routes/auth-layout.tsx`** -- auth pages layout
- No loader (no auth needed)
- Component: renders `<Header>` (no user), `<Outlet>`

## Changes to Existing Routes

Every route that currently renders `<Header>`:
1. Remove `<Header user={user} />` from component
2. Remove `parseSessionCookie` + `getUserFromSession` from loader (access user from layout's loader data via `useRouteLoaderData` or just pass through)
3. Keep route-specific loader logic (db queries, etc.)

For admin routes: the admin auth check (`if (!user.isAdmin) redirect`) stays in each admin route's loader since it's authorization, not authentication. The layout provides the user; admin routes check admin status.

## What Does NOT Change

- No UI changes -- pages look identical
- No API route changes
- No component changes (Header stays the same)
- No test changes (tests don't render routes)
