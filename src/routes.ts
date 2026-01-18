import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("invite/:code", "routes/invite.$code.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("settings", "routes/settings.tsx"),
  route("upload", "routes/upload.tsx"),
  route("folders", "routes/folders.tsx"),
  route("folder/:slug/*", "routes/folder.$slug.tsx"),
  route("file/*", "routes/file.$.tsx"),
  route("moodboards", "routes/moodboards.tsx"),
  route("moodboard/:id", "routes/moodboard.$id.tsx"),
  route("admin/extract", "routes/admin.extract.tsx"),
  route("admin/jobs", "routes/admin.jobs.tsx"),
] satisfies RouteConfig;
