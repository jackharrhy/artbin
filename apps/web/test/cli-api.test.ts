import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { files, folders, jobs, remoteImports, sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { loader as whoamiLoader } from "#api/api.cli.whoami";
import { action as foldersAction, loader as foldersLoader } from "#api/api.cli.folders";
import { action as manageFolderAction } from "#api/api.cli.folder.manage";
import { loader as downloadFolderLoader } from "#api/api.folder.download";
import { action as manifestAction } from "#api/api.cli.manifest";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";
import { eq } from "drizzle-orm";

// Mock BSP detection to control when extract-bsp jobs are queued
vi.mock("@artbin/core/parsers/bsp", () => ({
  isBSPFile: (buf: Buffer) => {
    // Check for Quake BSP magic (version 29 LE)
    return buf.length >= 4 && buf.readUInt32LE(0) === 29;
  },
}));

// Mock filesystem operations used by the folders endpoint
vi.mock("#lib/files.server", async (importOriginal) => {
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
async function callRoute(
  handler: Function,
  request: Request,
  params: Record<string, string> = {},
): Promise<Response> {
  try {
    return await handler({ request, params, context: {} });
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

  test("returns user info for an authenticated non-admin", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const request = new Request("http://localhost/api/cli/whoami", {
      headers: { Cookie: "artbin_session=user-session" },
    });
    const response = await callRoute(whoamiLoader, request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ user: { id: "user-1", name: "user", isAdmin: false } });
  });
});

// ─── folders ─────────────────────────────────────────────────────────────────

describe("/api/cli/folders", () => {
  test("lists the public folder tree with aggregate counts", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);
    await db.insert(folders).values([
      { id: "maps", name: "Maps", slug: "maps", fileCount: 2 },
      {
        id: "tower",
        name: "Tower",
        slug: "maps/tower",
        parentId: "maps",
        fileCount: 3,
      },
      { id: "inbox", name: "Inbox", slug: "_inbox", fileCount: 9 },
    ]);

    const response = await callRoute(
      foldersLoader,
      userRequest("http://localhost/api/cli/folders"),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.folders).toHaveLength(2);
    expect(body.folders[0]).toMatchObject({
      slug: "maps",
      childCount: 1,
      descendantCount: 1,
      totalFileCount: 5,
    });
    expect(body.folders.some((folder: { slug: string }) => folder.slug === "_inbox")).toBe(false);
  });

  test("lets admins include system folders", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values([
      { id: "maps", name: "Maps", slug: "maps" },
      { id: "inbox", name: "Inbox", slug: "_inbox" },
    ]);

    const response = await callRoute(
      foldersLoader,
      adminRequest("http://localhost/api/cli/folders?includeSystem=true"),
    );
    const body = await response.json();
    expect(body.folders.map((folder: { slug: string }) => folder.slug)).toEqual(["_inbox", "maps"]);
  });

  test("shows folder children and import source metadata", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values([
      { id: "tower", name: "Tower", slug: "tower", fileCount: 1 },
      {
        id: "textures",
        name: "Textures",
        slug: "tower/textures",
        parentId: "tower",
        fileCount: 2,
      },
    ]);
    await db.insert(remoteImports).values({
      id: "import-1",
      provider: "scmapdb",
      externalId: "tower",
      destinationKey: "root",
      sourceUrl: "https://scmapdb.example/tower",
      title: "Tower",
      author: "Larry",
      game: "Sven Co-op",
      metadata: "{}",
      folderId: "tower",
    });

    const response = await callRoute(
      foldersLoader,
      adminRequest("http://localhost/api/cli/folders?slug=tower"),
    );
    const body = await response.json();
    expect(body.folder).toMatchObject({
      slug: "tower",
      totalFileCount: 3,
      source: { provider: "scmapdb", author: "Larry", game: "Sven Co-op" },
    });
    expect(body.folder.children.map((folder: { slug: string }) => folder.slug)).toEqual([
      "tower/textures",
    ]);
  });

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
        execution: { mode: "apply", confirm: true },
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
        execution: { mode: "apply", confirm: true },
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
          { slug: "root/child", name: "Child", parentSlug: "root" },
          { slug: "root", name: "Root" },
        ],
        execution: { mode: "apply", confirm: true },
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

  test("plans a batch without mutating and requires explicit apply confirmation", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    const planned = await callRoute(
      foldersAction,
      adminRequest("http://localhost/api/cli/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folders: [{ slug: "planned", name: "Planned" }],
          execution: { mode: "plan" },
        }),
      }),
    );
    expect(planned.status).toBe(200);
    expect(await planned.json()).toMatchObject({
      applied: false,
      plan: { create: [{ slug: "planned" }] },
    });
    expect(await db.query.folders.findFirst()).toBeUndefined();

    const unconfirmed = await callRoute(
      foldersAction,
      adminRequest("http://localhost/api/cli/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folders: [{ slug: "planned", name: "Planned" }],
          execution: { mode: "apply" },
        }),
      }),
    );
    expect(unconfirmed.status).toBe(400);
    expect(await db.query.folders.findFirst()).toBeUndefined();
  });

  test("rejects a mismatched hierarchy before creating any folder", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    const response = await callRoute(
      foldersAction,
      adminRequest("http://localhost/api/cli/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folders: [
            { slug: "valid", name: "Valid" },
            { slug: "valid/child", name: "Child", parentSlug: "somewhere-else" },
          ],
          execution: { mode: "apply", confirm: true },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await db.query.folders.findMany()).toHaveLength(0);
  });

  test("rejects unauthenticated request", async () => {
    setupDatabase();

    const request = new Request("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [{ slug: "test", name: "Test" }],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(401);
  });

  test("non-admin cannot use the folder creation operation", async () => {
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
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Administrator access required" },
    });
  });

  test("non-admin cannot create new folders", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const request = userRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [{ slug: "new-folder", name: "New Folder" }],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(403);

    // Verify nothing was created in DB
    const all = await db.query.folders.findMany();
    expect(all).toHaveLength(0);
  });
});

describe("/api/cli/folder/manage", () => {
  test("previews a recursive rename without changing data", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values([
      { id: "maps", name: "Maps", slug: "maps" },
      { id: "tower", name: "Tower", slug: "maps/tower", parentId: "maps" },
    ]);
    await db.insert(files).values({
      id: "file-1",
      path: "maps/tower/tower.bsp",
      name: "tower.bsp",
      mimeType: "application/octet-stream",
      size: 100,
      kind: "map",
      folderId: "tower",
    });

    const response = await callRoute(
      manageFolderAction,
      adminRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "rename",
          slug: "maps",
          name: "GoldSource Maps",
          execution: { mode: "plan" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.plan).toMatchObject({
      from: { slug: "maps" },
      to: { slug: "goldsource-maps" },
      affected: { folders: 2, files: 1 },
    });
    expect(await db.query.folders.findFirst({ where: eq(folders.id, "maps") })).toMatchObject({
      name: "Maps",
      slug: "maps",
    });
  });

  test("applies a display-only rename", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });

    const response = await callRoute(
      manageFolderAction,
      adminRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "rename",
          slug: "maps",
          name: "MAPS",
          execution: { mode: "apply", confirm: true },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await db.query.folders.findFirst({ where: eq(folders.id, "maps") })).toMatchObject({
      name: "MAPS",
      slug: "maps",
    });
  });

  test("rejects mutations from non-admin users", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });

    const response = await callRoute(
      manageFolderAction,
      userRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "move",
          slug: "maps",
          destinationSlug: null,
          execution: { mode: "plan" },
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required" });
  });

  test("rejects malformed mutation bodies", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });

    const response = await callRoute(
      manageFolderAction,
      adminRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "move", slug: "maps" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: "Operation input is invalid" },
    });
  });

  test("does not move public folders into system folders", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values([
      { id: "maps", name: "Maps", slug: "maps" },
      { id: "inbox", name: "Inbox", slug: "_inbox" },
    ]);

    const response = await callRoute(
      manageFolderAction,
      adminRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "move",
          slug: "maps",
          destinationSlug: "_inbox",
          execution: { mode: "plan" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Cannot move a public folder into a system folder",
      },
    });
  });
});

describe("/api/folder/download", () => {
  test("requires authentication", async () => {
    setupDatabase();
    const response = await callRoute(
      downloadFolderLoader,
      new Request("http://localhost/api/folder/download/maps"),
      { "*": "maps" },
    );

    expect(response.status).toBe(401);
  });

  test("hides system folders from non-admin users", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);
    await db.insert(folders).values({ id: "inbox", name: "Inbox", slug: "_inbox" });

    const response = await callRoute(
      downloadFolderLoader,
      userRequest("http://localhost/api/folder/download/_inbox"),
      { "*": "_inbox" },
    );

    expect(response.status).toBe(404);
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
  let uploadAction: (typeof import("#api/api.cli.upload"))["action"];

  // Dynamic import so mocks are applied first
  beforeAll(async () => {
    const mod = await import("#api/api.cli.upload");
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
        execution: { mode: "apply", confirm: true },
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

  test("folder creation rejects non-canonical slugs", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    const response = await callRoute(
      foldersAction,
      adminRequest("http://localhost/api/cli/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folders: [{ slug: "Dirty Folder", name: "Dirty Folder" }],
          execution: { mode: "apply", confirm: true },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: "Invalid folder slug: Dirty Folder" },
    });
  });

  test("end-to-end: normalized folders -> upload with raw paths -> files land correctly", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Step 1: Create folders via the folders endpoint, using paths with
    // uppercase, spaces, and special characters -- exactly as the CLI
    // importer would send them (it calls cleanFolderPath on slugs).
    const folderRequest = adminRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "my-game", name: "my-game", parentSlug: null },
          { slug: "my-game/goodies", name: "GOODIES", parentSlug: "my-game" },
          {
            slug: "my-game/goodies/wallpapers-and-pfp-s",
            name: "Wallpapers and PFP's",
            parentSlug: "my-game/goodies",
          },
          { slug: "my-game/id1", name: "id1", parentSlug: "my-game" },
          { slug: "my-game/id1/s-wrath", name: "S_Wrath", parentSlug: "my-game/id1" },
        ],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const folderResponse = await callRoute(foldersAction, folderRequest);
    const folderBody = await folderResponse.json();
    expect(folderBody.created).toHaveLength(5);

    // Verify the slugs were cleaned (lowercase, dashes instead of spaces/underscores)
    const wallpapersFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, "my-game/goodies/wallpapers-and-pfp-s"),
    });
    expect(wallpapersFolder).toBeTruthy();

    const wrathFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, "my-game/id1/s-wrath"),
    });
    expect(wrathFolder).toBeTruthy();

    // Step 2: Upload files with RAW paths (not cleaned) -- the upload handler
    // must clean the path segments to match the created folder slugs.
    const formData = new FormData();
    formData.set(
      "metadata",
      JSON.stringify({
        parentFolder: "my-game",
        files: [
          {
            path: "GOODIES/Wallpapers and PFP's/back.png",
            kind: "texture",
            mimeType: "image/png",
            sha256: "aaa",
          },
          {
            path: "id1/S_Wrath/smash.wav",
            kind: "other",
            mimeType: "audio/wav",
            sha256: "bbb",
          },
        ],
      }),
    );
    formData.set("file_0", new Blob([new Uint8Array(32)]), "back.png");
    formData.set("file_1", new Blob([new Uint8Array(16)]), "smash.wav");

    const uploadRequest = adminRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const uploadResponse = await callRoute(uploadAction, uploadRequest);
    const uploadBody = await uploadResponse.json();

    // This is the critical assertion -- files must upload, not error
    expect(uploadBody.errors).toHaveLength(0);
    expect(uploadBody.uploaded).toHaveLength(2);

    // Verify files are in the correct cleaned folders
    const backFile = await db.query.files.findFirst({
      where: eq(files.path, "my-game/goodies/wallpapers-and-pfp-s/back.png"),
    });
    expect(backFile).toBeTruthy();
    expect(backFile!.folderId).toBe(wallpapersFolder!.id);

    const smashFile = await db.query.files.findFirst({
      where: eq(files.path, "my-game/id1/s-wrath/smash.wav"),
    });
    expect(smashFile).toBeTruthy();
    expect(smashFile!.folderId).toBe(wrathFolder!.id);
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

  test("BSP upload queues extract-bsp job with texture folder co-located next to BSP", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Create nested folder hierarchy as the CLI would
    await db.insert(folders).values([
      { id: "root", name: "game", slug: "game", fileCount: 0 },
      { id: "id1", name: "id1", slug: "game/id1", parentId: "root", fileCount: 0 },
      { id: "maps", name: "maps", slug: "game/id1/maps", parentId: "id1", fileCount: 0 },
    ]);

    // Create a minimal valid Quake BSP buffer (magic number 29)
    const bspBuffer = Buffer.alloc(64);
    bspBuffer.writeUInt32LE(29, 0); // BSP version 29

    const formData = new FormData();
    formData.set(
      "metadata",
      JSON.stringify({
        parentFolder: "game",
        files: [
          {
            path: "id1/maps/dm_test.bsp",
            kind: "map",
            mimeType: "application/octet-stream",
            sha256: "bsphash",
          },
        ],
      }),
    );
    formData.set("file_0", new Blob([bspBuffer]), "dm_test.bsp");

    const request = adminRequest("http://localhost/api/cli/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    const body = await response.json();

    expect(body.uploaded).toHaveLength(1);
    expect(body.errors).toHaveLength(0);

    // Verify the extract-bsp job was queued
    const allJobs = await db.query.jobs.findMany();
    expect(allJobs).toHaveLength(1);
    expect(allJobs[0].type).toBe("extract-bsp");

    // Parse the job input and verify the target folder slug
    // is co-located with the BSP, NOT at the root level
    const jobInput = JSON.parse(allJobs[0].input);
    expect(jobInput.targetFolderSlug).toBe("game/id1/maps/dm-test-textures");
    expect(jobInput.targetFolderName).toBe("dm_test Textures");
  });
});
