import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("upload", "routes/upload.tsx"),
  route("textures", "routes/textures.tsx"),
  route("moodboards", "routes/moodboards.tsx"),
  route("moodboard/:id", "routes/moodboard.$id.tsx"),
  route("admin/import", "routes/admin.import.tsx"),
] satisfies RouteConfig;
