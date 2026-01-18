import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("invite/:code", "routes/invite.$code.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("settings", "routes/settings.tsx"),
  route("upload", "routes/upload.tsx"),
  route("textures", "routes/textures.tsx"),
  route("texture/:id", "routes/texture.$id.tsx"),
  route("folders", "routes/folders.tsx"),
  route("folder/:slug*", "routes/folder.$slug.tsx"),
  route("moodboards", "routes/moodboards.tsx"),
  route("moodboard/:id", "routes/moodboard.$id.tsx"),
  route("admin/import", "routes/admin.import.tsx"),
  route("admin/extract", "routes/admin.extract.tsx"),
] satisfies RouteConfig;
