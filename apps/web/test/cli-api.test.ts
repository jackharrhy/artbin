import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { files, folders, sessions, users } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import { loader as whoamiLoader } from "~/routes/api.cli.whoami";
import { action as foldersAction } from "~/routes/api.cli.folders";
import { action as manifestAction } from "~/routes/api.cli.manifest";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";
import { eq } from "drizzle-orm";

// Mock filesystem operations used by the folders endpoint
vi.mock("~/lib/files.server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ensureDir: vi.fn(async () => {}),
    slugToPath: (slug: string) => `/mock-uploads/${slug}`,
    saveFile: vi.fn(async (_buffer: Buffer, folderSlug: string, filename: string) => ({
      path: `${folderSlug}/${filename}`,
      name: filename,
    })),
    processImage: vi.fn(async () => ({
      isOk: () => true,
      isErr: () => false,
      value: { width: 64, height: 64, hasPreview: false },
    })),
  };
});

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

async function seedAdminSession(db: ReturnType<typeof setupDatabase>) {
  await db.insert(users).values({
    id: "admin-1",

    username: "admin",
    fourmId: "fourm-admin-1",
    isAdmin: true,
  });
  await db.insert(sessions).values({
    id: "admin-session",
    userId: "admin-1",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function seedNonAdminSession(db: ReturnType<typeof setupDatabase>) {
  await db.insert(users).values({
    id: "user-1",

    username: "user",
    fourmId: "fourm-user-1",
    isAdmin: false,
  });
  await db.insert(sessions).values({
    id: "user-session",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function adminRequest(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: {
      Cookie: "artbin_session=admin-session",
      ...init?.headers,
    },
  });
}

/**
 * Route handlers using requireCliAdmin throw Response objects on auth failure.
 * This helper catches thrown Responses and returns them.
 */
async function callRoute(handler: Function, request: Request): Promise<Response> {
  try {
    return await handler({ request, params: {}, context: {} });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

// ─── whoami ──────────────────────────────────────────────────────────────────

describe("/api/cli/whoami", () => {
  test("returns user info for authenticated admin", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const request = adminRequest("http://localhost/api/cli/whoami");
    const response = await callRoute(whoamiLoader, request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      user: { id: "admin-1", name: "admin", isAdmin: true },
    });
  });

  test("returns 401 for unauthenticated request", async () => {
    setupDatabase();

    const request = new Request("http://localhost/api/cli/whoami");
    const response = await callRoute(whoamiLoader, request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Not authenticated" });
  });

  test("returns 403 for non-admin user", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const request = new Request("http://localhost/api/cli/whoami", {
      headers: { Cookie: "artbin_session=user-session" },
    });
    const response = await callRoute(whoamiLoader, request);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "Admin access required" });
  });
});

// ─── folders ─────────────────────────────────────────────────────────────────

describe("/api/cli/folders", () => {
  test("creates folders and returns their IDs", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const request = adminRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "quake", name: "Quake" },
          { slug: "quake/id1", name: "id1", parentSlug: "quake" },
        ],
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.created).toHaveLength(2);
    expect(body.created[0].slug).toBe("quake");
    expect(body.created[1].slug).toBe("quake-id1");
    expect(body.existing).toHaveLength(0);

    // Verify in DB
    const all = await db.query.folders.findMany();
    expect(all).toHaveLength(2);
  });

  test("returns existing folders without duplicating", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Pre-create a folder
    await db.insert(folders).values({
      id: "existing-1",
      name: "Quake",
      slug: "quake",
    });

    const request = adminRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "quake", name: "Quake" },
          { slug: "quake/maps", name: "maps", parentSlug: "quake" },
        ],
      }),
    });

    const response = await callRoute(foldersAction, request);
    const body = await response.json();

    expect(body.existing).toHaveLength(1);
    expect(body.existing[0].slug).toBe("quake");
    expect(body.existing[0].id).toBe("existing-1");
    expect(body.created).toHaveLength(1);
    expect(body.created[0].slug).toBe("quake-maps");
  });

  test("links child folders to parent", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const request = adminRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "root", name: "Root" },
          { slug: "root/child", name: "Child", parentSlug: "root" },
        ],
      }),
    });

    const response = await callRoute(foldersAction, request);
    const body = await response.json();
    expect(body.created).toHaveLength(2);

    const child = await db.query.folders.findFirst({
      where: eq(folders.slug, "root-child"),
    });
    expect(child).toBeTruthy();
    expect(child!.parentId).toBe(body.created[0].id);
  });

  test("rejects unauthenticated request", async () => {
    setupDatabase();

    const request = new Request("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folders: [{ slug: "test", name: "Test" }] }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(401);
  });
});

// ─── manifest ────────────────────────────────────────────────────────────────

describe("/api/cli/manifest", () => {
  test("identifies new files vs existing files", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Create a folder and a file that already exists
    await db.insert(folders).values({ id: "folder-1", name: "Quake", slug: "quake" });
    await db.insert(files).values({
      id: "file-1",
      path: "quake/textures/brick.png",
      name: "brick.png",
      mimeType: "image/png",
      size: 1024,
      kind: "texture",
      folderId: "folder-1",
    });

    const request = adminRequest("http://localhost/api/cli/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentFolder: "quake",
        files: [
          { path: "textures/brick.png", sha256: "abc", size: 1024 },
          { path: "textures/stone.png", sha256: "def", size: 2048 },
          { path: "maps/e1m1.bsp", sha256: "ghi", size: 500000 },
        ],
      }),
    });

    const response = await callRoute(manifestAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.existingFiles).toEqual(["textures/brick.png"]);
    expect(body.newFiles).toContain("textures/stone.png");
    expect(body.newFiles).toContain("maps/e1m1.bsp");
    expect(body.newFiles).toHaveLength(2);
  });

  test("all files are new when folder is empty", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const request = adminRequest("http://localhost/api/cli/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentFolder: "new-folder",
        files: [
          { path: "a.png", sha256: "abc", size: 100 },
          { path: "b.png", sha256: "def", size: 200 },
        ],
      }),
    });

    const response = await callRoute(manifestAction, request);
    const body = await response.json();

    expect(body.newFiles).toHaveLength(2);
    expect(body.existingFiles).toHaveLength(0);
  });

  test("rejects unauthenticated request", async () => {
    setupDatabase();

    const request = new Request("http://localhost/api/cli/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentFolder: "test", files: [] }),
    });

    const response = await callRoute(manifestAction, request);
    expect(response.status).toBe(401);
  });
});

// ─── upload ──────────────────────────────────────────────────────────────────

describe("/api/cli/upload", () => {
  // Upload tests need the actual action import, but saveFile/processImage are mocked above
  let uploadAction: (typeof import("~/routes/api.cli.upload"))["action"];

  // Dynamic import so mocks are applied first
  beforeAll(async () => {
    const mod = await import("~/routes/api.cli.upload");
    uploadAction = mod.action;
  });

  test("uploads a file and creates a DB record", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Create the target folder
    await db.insert(folders).values({
      id: "folder-1",
      name: "Quake",
      slug: "quake",
      fileCount: 0,
    });

    const formData = new FormData();
    formData.set(
      "metadata",
      JSON.stringify({
        parentFolder: "quake",
        files: [
          {
            path: "brick.png",
            kind: "texture",
            mimeType: "image/png",
            sha256: "abc123",
          },
        ],
      }),
    );
    formData.set("file_0", new Blob([new Uint8Array(64)]), "brick.png");

    const request = adminRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.uploaded).toEqual(["brick.png"]);
    expect(body.errors).toHaveLength(0);

    // Verify file was inserted in DB
    const fileRecord = await db.query.files.findFirst({
      where: eq(files.path, "quake/brick.png"),
    });
    expect(fileRecord).toBeTruthy();
    expect(fileRecord!.kind).toBe("texture");
    expect(fileRecord!.sha256).toBe("abc123");
    expect(fileRecord!.source).toBe("cli-upload");

    // Verify folder file count was incremented
    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(folder!.fileCount).toBe(1);
  });

  test("uploads files into nested folders", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    await db.insert(folders).values([
      { id: "root", name: "Quake", slug: "quake" },
      { id: "textures", name: "textures", slug: "quake/textures", parentId: "root" },
    ]);

    const formData = new FormData();
    formData.set(
      "metadata",
      JSON.stringify({
        parentFolder: "quake",
        files: [
          {
            path: "textures/wall.png",
            kind: "texture",
            mimeType: "image/png",
            sha256: "def456",
          },
        ],
      }),
    );
    formData.set("file_0", new Blob([new Uint8Array(32)]), "wall.png");

    const request = adminRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    const body = await response.json();

    expect(body.uploaded).toEqual(["textures/wall.png"]);

    const fileRecord = await db.query.files.findFirst({
      where: eq(files.path, "quake/textures/wall.png"),
    });
    expect(fileRecord).toBeTruthy();
    expect(fileRecord!.folderId).toBe("textures");
  });

  test("returns error when folder does not exist", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const formData = new FormData();
    formData.set(
      "metadata",
      JSON.stringify({
        parentFolder: "nonexistent",
        files: [
          {
            path: "brick.png",
            kind: "texture",
            mimeType: "image/png",
            sha256: "abc",
          },
        ],
      }),
    );
    formData.set("file_0", new Blob([new Uint8Array(8)]), "brick.png");

    const request = adminRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    const body = await response.json();

    expect(body.uploaded).toHaveLength(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].path).toBe("brick.png");
    expect(body.errors[0].error).toContain("Folder not found");
  });

  test("returns error when file data is missing", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    await db.insert(folders).values({ id: "f1", name: "Test", slug: "test" });

    const formData = new FormData();
    formData.set(
      "metadata",
      JSON.stringify({
        parentFolder: "test",
        files: [{ path: "missing.png", kind: "texture", mimeType: "image/png", sha256: "x" }],
      }),
    );
    // Intentionally not setting file_0

    const request = adminRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    const body = await response.json();

    expect(body.uploaded).toHaveLength(0);
    expect(body.errors[0].error).toContain("Missing file data");
  });

  test("returns 400 when metadata is missing", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const formData = new FormData();
    // No metadata field

    const request = adminRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("metadata");
  });

  test("rejects unauthenticated request", async () => {
    setupDatabase();

    const formData = new FormData();
    formData.set("metadata", JSON.stringify({ parentFolder: "test", files: [] }));

    const request = new Request("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    expect(response.status).toBe(401);
  });
});
