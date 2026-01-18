import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).default(false),
  invitedBy: text("invited_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const inviteCodes = sqliteTable("invite_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => users.id),
  usedBy: text("used_by").references(() => users.id),
  usedAt: integer("used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Folders (nested, like filesystem directories)
export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  parentId: text("parent_id"), // null = root folder
  ownerId: text("owner_id").references(() => users.id), // null for external sources
  visibility: text("visibility", { enum: ["public", "private", "friends"] }).default("public"),
  source: text("source"), // e.g. "texturetown", "local", etc. - who owns it if no ownerId
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

// Collections (legacy, keeping for backwards compat)
export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id").notNull().references(() => users.id),
  visibility: text("visibility", { enum: ["public", "private", "friends"] }).default("public"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

// Textures
export const textures = sqliteTable("textures", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  width: integer("width"),
  height: integer("height"),
  isSeamless: integer("is_seamless", { mode: "boolean" }).default(false),
  folderId: text("folder_id").references(() => folders.id),
  collectionId: text("collection_id").references(() => collections.id), // legacy
  uploaderId: text("uploader_id").references(() => users.id), // null for external imports
  source: text("source"), // e.g. "texturetown" - external source name
  sourceUrl: text("source_url"), // original URL if imported
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

// Tags
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
});

// Texture-Tag junction
export const textureTags = sqliteTable("texture_tags", {
  textureId: text("texture_id").notNull().references(() => textures.id),
  tagId: text("tag_id").notNull().references(() => tags.id),
});

// Moodboards
export const moodboards = sqliteTable("moodboards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

// Moodboard Items
export const moodboardItems = sqliteTable("moodboard_items", {
  id: text("id").primaryKey(),
  moodboardId: text("moodboard_id").notNull().references(() => moodboards.id),
  type: text("type", { enum: ["text", "image", "texture", "link"] }).notNull(),
  content: text("content").notNull(), // JSON content based on type
  positionX: integer("position_x").default(0),
  positionY: integer("position_y").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type InviteCode = typeof inviteCodes.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type Texture = typeof textures.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Moodboard = typeof moodboards.$inferSelect;
export type MoodboardItem = typeof moodboardItems.$inferSelect;
