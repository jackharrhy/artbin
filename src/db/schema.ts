import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// ============================================================================
// Auth & Users
// ============================================================================

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
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const inviteCodes = sqliteTable("invite_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => users.id),
  maxUses: integer("max_uses"), // null = unlimited
  useCount: integer("use_count").default(0),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ============================================================================
// Folders - Directory structure matching filesystem
// ============================================================================

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),                    // Display name: "Thirty Flights"
  slug: text("slug").notNull().unique(),           // Path: "thirty-flights/maps" (unique!)
  description: text("description"),
  previewPath: text("preview_path"),               // Path to 3x3 preview image (relative to uploads)
  parentId: text("parent_id").references((): any => folders.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  visibility: text("visibility", { enum: ["public", "private", "unlisted"] }).default("public"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

// ============================================================================
// Files - Unified file storage
// ============================================================================

export const fileKinds = ["texture", "model", "audio", "map", "archive", "config", "other"] as const;
export type FileKind = typeof fileKinds[number];

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  
  // Path & naming - path is relative to uploads/, e.g. "thirty-flights/maps/lob1.bsp"
  path: text("path").notNull().unique(),
  name: text("name").notNull(),                    // Just filename: "lob1.bsp"
  
  // File metadata
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  
  // Asset classification
  kind: text("kind", { enum: fileKinds }).notNull().default("other"),
  
  // Image-specific (null for non-images)
  width: integer("width"),
  height: integer("height"),
  hasPreview: integer("has_preview", { mode: "boolean" }).default(false), // true if .preview.png exists
  
  // Relationships
  folderId: text("folder_id").references(() => folders.id, { onDelete: "cascade" }),
  uploaderId: text("uploader_id").references(() => users.id, { onDelete: "set null" }),
  
  // Source tracking
  source: text("source"),                          // "upload", "extracted-pk3", "extracted-pak", etc.
  sourceArchive: text("source_archive"),           // Original archive filename if extracted
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

// ============================================================================
// Tags - For categorizing files
// ============================================================================

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),           // Display: "Seamless"
  slug: text("slug").notNull().unique(),           // URL-safe: "seamless"
  category: text("category"),                      // Optional grouping: "material", "style", etc.
});

export const fileTags = sqliteTable("file_tags", {
  fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.fileId, table.tagId] }),
}));

// ============================================================================
// Jobs - Background processing queue
// ============================================================================

export const jobStatuses = ["pending", "running", "completed", "failed", "cancelled"] as const;
export type JobStatus = typeof jobStatuses[number];

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),                    // "extract-archive", "generate-previews", etc.
  status: text("status", { enum: jobStatuses }).notNull().default("pending"),
  
  // Job configuration (JSON)
  input: text("input").notNull(),                  // JSON: { tempFile: "...", targetFolder: "..." }
  
  // Progress tracking
  progress: integer("progress").default(0),        // 0-100
  progressMessage: text("progress_message"),       // "Extracting file 50/100..."
  
  // Results
  output: text("output"),                          // JSON result when completed
  error: text("error"),                            // Error message if failed
  
  // Ownership
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  
  // Timing
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// ============================================================================
// Settings - Key-value store for app configuration
// ============================================================================

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),                  // JSON-encoded value
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn((): Date => new Date()),
});

// ============================================================================
// Type exports
// ============================================================================

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type InviteCode = typeof inviteCodes.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type File = typeof files.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type FileTag = typeof fileTags.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Setting = typeof settings.$inferSelect;
