import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { files, folders, sessions, users } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";
import { eq } from "drizzle-orm";

// Mock filesystem operations
vi.mock("~/lib/files.server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ensureDir: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    deleteFolder: vi.fn(async () => {}),
  };
});

vi.mock("~/lib/folder-preview.server", () => ({
  generateFolderPreview: vi.fn(async () => null),
}));

// The userContext symbol for the mock context
const mockUserContextKey = Symbol("userContext");
const mockLoggerContextKey = Symbol("loggerContext");

vi.mock("~/lib/auth-context.server", () => {
  return {
    userContext: mockUserContextKey,
    authMiddleware: vi.fn(),
  };
});

// Mock evlog logger used by route handlers
vi.mock("evlog/react-router", () => ({
  useLogger: () => ({ set: () => {}, error: () => {}, emit: () => {} }),
  loggerContext: mockLoggerContextKey,
}));

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

function makeAdminContext() {
  const store = new Map();
  store.set(mockUserContextKey, {
    id: "admin-1",
    username: "admin",
    isAdmin: true,
    fourmId: "fourm-admin-1",
    createdAt: new Date(),
  });
  store.set(mockLoggerContextKey, { set: () => {}, error: () => {}, emit: () => {} });
  return {
    get: (key: any) => store.get(key),
    set: (key: any, value: any) => store.set(key, value),
  };
}

describe("/admin/orphans delete-duplicates action", () => {
  let action: Function;

  beforeAll(async () => {
    const mod = await import("~/routes/admin.orphans");
    action = mod.action;
  });

  async function callAction(formData: FormData) {
    const request = new Request("http://localhost/admin/orphans", {
      method: "POST",
      body: formData,
    });
    return action({ request, context: makeAdminContext(), params: {} });
  }

  test("deletes duplicate files but keeps the selected one", async () => {
    const db = setupDatabase();
    await db.insert(users).values({
      id: "admin-1",
      username: "admin",
      fourmId: "fourm-admin-1",
      isAdmin: true,
    });

    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
      fileCount: 3,
    });

    // Three files with the same sha256 (duplicates)
    const sha = "abc123def456";
    await db.insert(files).values([
      {
        id: "file-keep",
        path: "textures/wall.png",
        name: "wall.png",
        mimeType: "image/png",
        size: 1024,
        kind: "texture",
        folderId: "folder-1",
        sha256: sha,
      },
      {
        id: "file-delete-1",
        path: "textures/wall-copy.png",
        name: "wall-copy.png",
        mimeType: "image/png",
        size: 1024,
        kind: "texture",
        folderId: "folder-1",
        sha256: sha,
      },
      {
        id: "file-delete-2",
        path: "textures/wall-copy-2.png",
        name: "wall-copy-2.png",
        mimeType: "image/png",
        size: 1024,
        kind: "texture",
        folderId: "folder-1",
        sha256: sha,
      },
    ]);

    const fd = new FormData();
    fd.set("_action", "delete-duplicates");
    fd.set("keepId", "file-keep");
    fd.set("deleteIds", JSON.stringify(["file-delete-1", "file-delete-2"]));

    const result = await callAction(fd);

    expect(result.success).toBe(true);
    expect(result.action).toBe("delete-duplicates");
    expect(result.deleted).toBe(2);

    // Kept file should still exist
    const kept = await db.query.files.findFirst({
      where: eq(files.id, "file-keep"),
    });
    expect(kept).toBeTruthy();
    expect(kept?.path).toBe("textures/wall.png");

    // Deleted files should be gone
    const deleted1 = await db.query.files.findFirst({
      where: eq(files.id, "file-delete-1"),
    });
    expect(deleted1).toBeUndefined();

    const deleted2 = await db.query.files.findFirst({
      where: eq(files.id, "file-delete-2"),
    });
    expect(deleted2).toBeUndefined();
  });

  test("refuses to delete the kept file", async () => {
    const db = setupDatabase();
    await db.insert(users).values({
      id: "admin-1",
      username: "admin",
      fourmId: "fourm-admin-1",
      isAdmin: true,
    });

    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
      fileCount: 2,
    });

    await db.insert(files).values([
      {
        id: "file-a",
        path: "textures/a.png",
        name: "a.png",
        mimeType: "image/png",
        size: 1024,
        kind: "texture",
        folderId: "folder-1",
        sha256: "samehash",
      },
      {
        id: "file-b",
        path: "textures/b.png",
        name: "b.png",
        mimeType: "image/png",
        size: 1024,
        kind: "texture",
        folderId: "folder-1",
        sha256: "samehash",
      },
    ]);

    // Try to sneak the keepId into deleteIds
    const fd = new FormData();
    fd.set("_action", "delete-duplicates");
    fd.set("keepId", "file-a");
    fd.set("deleteIds", JSON.stringify(["file-a", "file-b"]));

    const result = await callAction(fd);

    expect(result.success).toBe(true);
    // Should only delete file-b, not file-a
    expect(result.deleted).toBe(1);

    const fileA = await db.query.files.findFirst({ where: eq(files.id, "file-a") });
    expect(fileA).toBeTruthy();

    const fileB = await db.query.files.findFirst({ where: eq(files.id, "file-b") });
    expect(fileB).toBeUndefined();
  });
});
