import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("invite/:code", "routes/invite.$code.tsx"),
  route("settings", "routes/settings.tsx"),
  route("folders", "routes/folders.tsx"),
  route("folder/:slug/*", "routes/folder.$slug.tsx"),
  route("file/*", "routes/file.$.tsx"),

  route("admin/jobs", "routes/admin.jobs.tsx"),
  route("admin/import", "routes/admin.import.tsx"),
  route("admin/archives", "routes/admin.archives.tsx"),
  route("admin/scan-settings", "routes/admin.scan-settings.tsx"),
  
  // API routes
  route("api/upload", "routes/api.upload.tsx"),
  route("api/folder", "routes/api.folder.tsx"),
  route("api/folder/move", "routes/api.folder.move.tsx"),
] satisfies RouteConfig;
