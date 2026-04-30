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

function userRequest(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: {
      Cookie: "artbin_session=user-session",
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
    expect(body.created[1].slug).toBe("quake/id1");
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
    expect(body.created[0].slug).toBe("quake/maps");
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
      where: eq(folders.slug, "root/child"),
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

  test("non-admin can read existing folders without 403", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await seedNonAdminSession(db);

    // Pre-create folders
    await db.insert(folders).values([
      { id: "folder-a", name: "Quake", slug: "quake" },
      { id: "folder-b", name: "Maps", slug: "quake/maps", parentId: "folder-a" },
    ]);

    const request = userRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "quake", name: "Quake" },
          { slug: "quake/maps", name: "Maps", parentSlug: "quake" },
        ],
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // Non-admin should see existing folders but not create new ones
    expect(body.existing).toHaveLength(2);
    expect(body.created).toHaveLength(0);
  });

  test("non-admin cannot create new folders", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const request = userRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [{ slug: "new-folder", name: "New Folder" }],
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.created).toHaveLength(0);
    expect(body.existing).toHaveLength(0);

    // Verify nothing was created in DB
    const all = await db.query.folders.findMany();
    expect(all).toHaveLength(0);
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

  test("non-admin can check manifest without 403", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    await db.insert(folders).values({ id: "folder-1", name: "Quake", slug: "quake" });
    await db.insert(files).values({
      id: "file-1",
      path: "quake/brick.png",
      name: "brick.png",
      mimeType: "image/png",
      size: 1024,
      kind: "texture",
      folderId: "folder-1",
    });

    const request = userRequest("http://localhost/api/cli/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentFolder: "quake",
        files: [
          { path: "brick.png", sha256: "abc", size: 1024 },
          { path: "stone.png", sha256: "def", size: 2048 },
        ],
      }),
    });

    const response = await callRoute(manifestAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.existingFiles).toEqual(["brick.png"]);
    expect(body.newFiles).toEqual(["stone.png"]);
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
    expect(fileRecord!.sha256).toMatch(/^[a-f0-9]{64}$/); // server-computed sha256
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

  test("uploads files with deep nested paths to correct folders", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Simulate what the CLI importer does: first create the folder hierarchy,
    // then upload files referencing those folders by path.
    // This mimics scanning ~/games/bdd3/ which has structure like:
    //   AVIAOZIN3/id1/maps/myhouse.bsp
    //   AVIAOZIN3/id1/gfx/conchars.png

    // Step 1: Create folder hierarchy (as api.cli.folders would)
    await db.insert(folders).values([
      { id: "root", name: "bdd3", slug: "bdd3", fileCount: 0 },
      { id: "av", name: "aviaozin3", slug: "bdd3/aviaozin3", parentId: "root", fileCount: 0 },
      { id: "id1", name: "id1", slug: "bdd3/aviaozin3/id1", parentId: "av", fileCount: 0 },
      {
        id: "maps",
        name: "maps",
        slug: "bdd3/aviaozin3/id1/maps",
        parentId: "id1",
        fileCount: 0,
      },
      { id: "gfx", name: "gfx", slug: "bdd3/aviaozin3/id1/gfx", parentId: "id1", fileCount: 0 },
    ]);

    // Step 2: Upload files with paths that include subdirectories
    const formData = new FormData();
    formData.set(
      "metadata",
      JSON.stringify({
        parentFolder: "bdd3",
        files: [
          {
            path: "aviaozin3/id1/maps/myhouse.bsp",
            kind: "map",
            mimeType: "application/octet-stream",
            sha256: "aaa",
          },
          {
            path: "aviaozin3/id1/gfx/conchars.png",
            kind: "texture",
            mimeType: "image/png",
            sha256: "bbb",
          },
          {
            path: "aviaozin3/readme.txt",
            kind: "other",
            mimeType: "text/plain",
            sha256: "ccc",
          },
        ],
      }),
    );
    formData.set("file_0", new Blob([new Uint8Array(64)]), "myhouse.bsp");
    formData.set("file_1", new Blob([new Uint8Array(32)]), "conchars.png");
    formData.set("file_2", new Blob([new Uint8Array(16)]), "readme.txt");

    const request = adminRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    const body = await response.json();

    expect(body.uploaded).toHaveLength(3);
    expect(body.errors).toHaveLength(0);

    // Verify files landed in the correct folders
    const bspFile = await db.query.files.findFirst({
      where: eq(files.path, "bdd3/aviaozin3/id1/maps/myhouse.bsp"),
    });
    expect(bspFile).toBeTruthy();
    expect(bspFile!.folderId).toBe("maps");

    const gfxFile = await db.query.files.findFirst({
      where: eq(files.path, "bdd3/aviaozin3/id1/gfx/conchars.png"),
    });
    expect(gfxFile).toBeTruthy();
    expect(gfxFile!.folderId).toBe("gfx");

    const readmeFile = await db.query.files.findFirst({
      where: eq(files.path, "bdd3/aviaozin3/readme.txt"),
    });
    expect(readmeFile).toBeTruthy();
    expect(readmeFile!.folderId).toBe("av");
  });

  test("folder creation endpoint builds correct parent hierarchy", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Simulate CLI importer sending sorted folder slugs (parents first)
    const request = adminRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "game", name: "game", parentSlug: null },
          { slug: "game/aviaozin3", name: "aviaozin3", parentSlug: "game" },
          { slug: "game/aviaozin3/id1", name: "id1", parentSlug: "game/aviaozin3" },
          {
            slug: "game/aviaozin3/id1/maps",
            name: "maps",
            parentSlug: "game/aviaozin3/id1",
          },
          { slug: "game/aviaozin3/id1/gfx", name: "gfx", parentSlug: "game/aviaozin3/id1" },
        ],
      }),
    });

    const response = await callRoute(foldersAction, request);
    const body = await response.json();

    expect(body.created).toHaveLength(5);
    expect(body.existing).toHaveLength(0);

    // Verify parent-child relationships
    const mapsFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, "game/aviaozin3/id1/maps"),
    });
    expect(mapsFolder).toBeTruthy();

    const id1Folder = await db.query.folders.findFirst({
      where: eq(folders.slug, "game/aviaozin3/id1"),
    });
    expect(id1Folder).toBeTruthy();
    expect(mapsFolder!.parentId).toBe(id1Folder!.id);

    const avFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, "game/aviaozin3"),
    });
    expect(avFolder).toBeTruthy();
    expect(id1Folder!.parentId).toBe(avFolder!.id);

    const rootFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, "game"),
    });
    expect(rootFolder).toBeTruthy();
    expect(avFolder!.parentId).toBe(rootFolder!.id);
    expect(rootFolder!.parentId).toBeNull();
  });

  test("non-admin upload creates pending files in inbox session", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    // Create the target folder that the non-admin wants to upload to
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

    const request = userRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pendingUpload).toBe(true);
    expect(body.uploadSessionId).toBeTruthy();

    // Verify the file was created with pending status
    const allFiles = await db.query.files.findMany();
    expect(allFiles).toHaveLength(1);
    expect(allFiles[0].status).toBe("pending");
    expect(allFiles[0].source).toBe("cli-upload");
    expect(allFiles[0].suggestedFolderId).toBe("folder-1");

    // Verify the file is in an inbox session folder, not the target folder
    expect(allFiles[0].folderId).not.toBe("folder-1");

    // Verify an inbox session folder was created
    const inboxFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, "_inbox"),
    });
    expect(inboxFolder).toBeTruthy();
  });
});
