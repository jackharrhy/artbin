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
  layout("routes/auth-layout.tsx", [
    route("login", "routes/login.tsx"),
    route("register", "routes/register.tsx"),
    route("invite/:code", "routes/invite.$code.tsx"),
  ]),

  // API routes
  route("api/upload", "routes/api.upload.tsx"),
  route("api/folder", "routes/api.folder.tsx"),
  route("api/folder/move", "routes/api.folder.move.tsx"),
] satisfies RouteConfig;
