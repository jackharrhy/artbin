import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { folders, files, sessions, users } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import { searchFiles, getFileCountsByKind, insertFileRecord } from "~/lib/files.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

// Mock filesystem operations (same pattern as cli-api tests)
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

async function seedFolder(db: ReturnType<typeof setupDatabase>) {
  await db.insert(folders).values({
    id: "folder-1",
    name: "Textures",
    slug: "textures",
  });
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

async function callRoute(handler: Function, request: Request): Promise<Response> {
  try {
    return await handler({ request, params: {}, context: {} });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

async function seedFiles(db: ReturnType<typeof setupDatabase>) {
  await seedFolder(db);

  await insertFileRecord({
    id: "file-approved",
    path: "textures/wall.png",
    name: "wall.png",
    mimeType: "image/png",
    size: 100,
    kind: "texture",
    folderId: "folder-1",
    status: "approved",
  });

  await insertFileRecord({
    id: "file-pending",
    path: "textures/pending.png",
    name: "pending.png",
    mimeType: "image/png",
    size: 200,
    kind: "texture",
    folderId: "folder-1",
    status: "pending",
  });

  await insertFileRecord({
    id: "file-rejected",
    path: "textures/rejected.png",
    name: "rejected.png",
    mimeType: "image/png",
    size: 300,
    kind: "texture",
    folderId: "folder-1",
    status: "rejected",
  });
}

describe("searchFiles status filtering", () => {
  test("excludes pending files by default", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const result = await searchFiles({});
    const names = result.files.map((f) => f.name);

    expect(names).toContain("wall.png");
    expect(names).not.toContain("pending.png");
  });

  test("excludes rejected files by default", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const result = await searchFiles({});
    const names = result.files.map((f) => f.name);

    expect(names).toContain("wall.png");
    expect(names).not.toContain("rejected.png");
  });

  test("returns only approved files by default", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const result = await searchFiles({});

    expect(result.files).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.files[0].name).toBe("wall.png");
  });

  test("returns all files when includeAllStatuses is true", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const result = await searchFiles({ includeAllStatuses: true });

    expect(result.files).toHaveLength(3);
    expect(result.total).toBe(3);
  });
});

describe("getFileCountsByKind status filtering", () => {
  test("only counts approved files", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const counts = await getFileCountsByKind();

    expect(counts.texture).toBe(1);
    expect(counts.all).toBe(1);
  });

  test("only counts approved files within specified folders", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const counts = await getFileCountsByKind(["folder-1"]);

    expect(counts.texture).toBe(1);
    expect(counts.all).toBe(1);
  });
});

// ─── Upload API (non-admin vs admin) ────────────────────────────────────────

describe("/api/upload", () => {
  let uploadAction: (typeof import("~/routes/api.upload"))["action"];

  beforeAll(async () => {
    const mod = await import("~/routes/api.upload");
    uploadAction = mod.action;
  });

  test("admin upload creates file with status approved in target folder", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await seedFolder(db);

    const formData = new FormData();
    formData.set("file", new Blob([new Uint8Array(64)]), "wall.png");
    formData.set("folderId", "folder-1");
    formData.set("relativePath", "wall.png");

    const request = adminRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.fileSuccess).toBeTruthy();
    expect(body.fileSuccess.fileName).toBe("wall.png");

    // Verify file record in DB
    const fileRecord = await db.query.files.findFirst({
      where: eq(files.name, "wall.png"),
    });
    expect(fileRecord).toBeTruthy();
    expect(fileRecord!.status).toBe("approved");
    expect(fileRecord!.folderId).toBe("folder-1");
    expect(fileRecord!.suggestedFolderId).toBeNull();
  });

  test("non-admin upload creates file with status pending in inbox session", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);
    await seedFolder(db);

    const formData = new FormData();
    formData.set("file", new Blob([new Uint8Array(64)]), "brick.png");
    formData.set("folderId", "folder-1");
    formData.set("relativePath", "brick.png");

    const request = userRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pendingUpload).toBe(true);
    expect(body.message).toContain("admin will review");

    // Verify file record in DB
    const fileRecord = await db.query.files.findFirst({
      where: eq(files.name, "brick.png"),
    });
    expect(fileRecord).toBeTruthy();
    expect(fileRecord!.status).toBe("pending");
    expect(fileRecord!.suggestedFolderId).toBe("folder-1");

    // Verify the file is in an inbox session folder, not in the target folder
    expect(fileRecord!.folderId).not.toBe("folder-1");

    const sessionFolder = await db.query.folders.findFirst({
      where: eq(folders.id, fileRecord!.folderId),
    });
    expect(sessionFolder).toBeTruthy();
    expect(sessionFolder!.slug).toMatch(/^_inbox\//);
    expect(sessionFolder!.ownerId).toBe("user-1");
  });

  test("non-admin upload stores suggestedFolderId from selected folder", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);
    await seedFolder(db);

    const formData = new FormData();
    formData.set("file", new Blob([new Uint8Array(32)]), "stone.png");
    formData.set("folderId", "folder-1");
    formData.set("relativePath", "stone.png");

    const request = userRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    const body = await response.json();
    expect(body.pendingUpload).toBe(true);

    const fileRecord = await db.query.files.findFirst({
      where: eq(files.name, "stone.png"),
    });
    expect(fileRecord!.suggestedFolderId).toBe("folder-1");
  });

  test("non-admin upload without folderId sets suggestedFolderId to null", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const formData = new FormData();
    formData.set("file", new Blob([new Uint8Array(32)]), "misc.png");
    formData.set("relativePath", "misc.png");

    const request = userRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    const body = await response.json();
    expect(body.pendingUpload).toBe(true);

    const fileRecord = await db.query.files.findFirst({
      where: eq(files.name, "misc.png"),
    });
    expect(fileRecord!.suggestedFolderId).toBeNull();
  });

  test("non-admin cannot use archive analysis action", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const formData = new FormData();
    formData.set("_action", "analyze");
    formData.set("file", new Blob([new Uint8Array(64)]), "test.zip");

    const request = userRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error).toContain("Admin access required");
  });

  test("non-admin cannot use archive extraction action", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const formData = new FormData();
    formData.set("_action", "extract");
    formData.set("tempFile", "test_file.zip");
    formData.set("originalName", "test.zip");
    formData.set("folderName", "Test");
    formData.set("folderSlug", "test");

    const request = userRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    });

    const response = await callRoute(uploadAction, request);
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error).toContain("Admin access required");
  });
});
