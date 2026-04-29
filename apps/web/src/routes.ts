import { type RouteConfig, index, route, layout, prefix } from "@react-router/dev/routes";

export default [
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
  layout("routes/auth-layout.tsx", [route("login", "routes/login.tsx")]),

  // OAuth routes (no layout -- server-side redirects only)
  route("auth/4orm", "routes/auth.4orm.tsx"),
  route("auth/4orm/callback", "routes/auth.4orm.callback.tsx"),

  // API routes
  route("api/upload", "routes/api.upload.tsx"),
  route("api/folder", "routes/api.folder.tsx"),
  route("api/folder/move", "routes/api.folder.move.tsx"),
] satisfies RouteConfig;
