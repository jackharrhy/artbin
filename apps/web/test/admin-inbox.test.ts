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
    slugToPath: (slug: string) => `/mock-uploads/${slug}`,
    moveFile: vi.fn(async () => {}),
    deleteFolder: vi.fn(async () => {}),
    recalculateFolderCounts: vi.fn(async () => {}),
  };
});

// The userContext symbol for the mock context
const mockUserContextKey = Symbol("userContext");

// Mock the auth context -- the action reads user from context.get(userContext)
vi.mock("~/lib/auth-context.server", () => {
  return {
    userContext: mockUserContextKey,
    authMiddleware: vi.fn(),
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

async function seedAdmin(db: ReturnType<typeof setupDatabase>) {
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

async function seedInboxWithFiles(db: ReturnType<typeof setupDatabase>, fileCount: number) {
  // Create uploader first (FK constraint)
  await db.insert(users).values({
    id: "uploader-1",
    username: "seizurewarning",
    fourmId: "fourm-uploader-1",
    isAdmin: false,
  });

  // Create inbox root
  await db.insert(folders).values({ id: "inbox", name: "Inbox", slug: "_inbox" });

  // Create a session folder
  await db.insert(folders).values({
    id: "session-1",
    name: "session-1",
    slug: "_inbox/session-1",
    parentId: "inbox",
    ownerId: "uploader-1",
  });

  // Create destination folder
  await db.insert(folders).values({
    id: "dest-folder",
    name: "Textures",
    slug: "textures",
    fileCount: 0,
  });

  // Create pending files
  for (let i = 0; i < fileCount; i++) {
    await db.insert(files).values({
      id: `file-${i}`,
      path: `_inbox/session-1/file${i}.png`,
      name: `file${i}.png`,
      mimeType: "image/png",
      size: 1024,
      kind: "texture",
      folderId: "session-1",
      uploaderId: "uploader-1",
      status: "pending",
    });
  }
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
  return {
    get: (key: any) => store.get(key),
    set: (key: any, value: any) => store.set(key, value),
  };
}

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

describe("/admin/inbox action", () => {
  let action: Function;

  beforeAll(async () => {
    const mod = await import("~/routes/admin.inbox");
    action = mod.action;
  });

  async function callAction(formData: FormData) {
    const request = new Request("http://localhost/admin/inbox", {
      method: "POST",
      body: formData,
    });
    // The action reads formData from request, so we need to reconstruct
    // since Request consumes the body. Build a fresh request with the fields.
    try {
      return await action({ request, params: {}, context: makeAdminContext() });
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
  }

  test("approve single session moves files to destination", async () => {
    const db = setupDatabase();
    await seedAdmin(db);
    await seedInboxWithFiles(db, 3);

    const result = await callAction(
      makeFormData({
        _action: "approve",
        sessionFolderId: "session-1",
        destinationFolderId: "dest-folder",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("approve");
    expect(result.count).toBe(3);

    // Files should be approved
    const pending = await db.query.files.findMany({ where: eq(files.status, "pending") });
    expect(pending).toHaveLength(0);

    const approved = await db.query.files.findMany({ where: eq(files.status, "approved") });
    expect(approved).toHaveLength(3);
  });

  test("reject single session marks files rejected", async () => {
    const db = setupDatabase();
    await seedAdmin(db);
    await seedInboxWithFiles(db, 2);

    const result = await callAction(
      makeFormData({
        _action: "reject",
        sessionFolderId: "session-1",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("reject");
    expect(result.count).toBe(2);

    const rejected = await db.query.files.findMany({ where: eq(files.status, "rejected") });
    expect(rejected).toHaveLength(2);
  });

  test("approve-all works without sessionFolderId", async () => {
    const db = setupDatabase();
    await seedAdmin(db);
    await seedInboxWithFiles(db, 5);

    const result = await callAction(
      makeFormData({
        _action: "approve-all",
        destinationFolderId: "dest-folder",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("approve-all");
    expect(result.count).toBe(5);
    expect(result.sessionCount).toBe(1);

    const pending = await db.query.files.findMany({ where: eq(files.status, "pending") });
    expect(pending).toHaveLength(0);
  });

  test("reject-all works without sessionFolderId", async () => {
    const db = setupDatabase();
    await seedAdmin(db);
    await seedInboxWithFiles(db, 4);

    const result = await callAction(
      makeFormData({
        _action: "reject-all",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("reject-all");
    expect(result.count).toBe(4);
  });

  test("approve-all requires destination folder", async () => {
    const db = setupDatabase();
    await seedAdmin(db);
    await seedInboxWithFiles(db, 1);

    const result = await callAction(
      makeFormData({
        _action: "approve-all",
      }),
    );

    expect(result.error).toBe("Please select a destination folder");
  });

  test("approve-all filters by uploader", async () => {
    const db = setupDatabase();
    await seedAdmin(db);
    await seedInboxWithFiles(db, 3);

    // Create a second uploader with their own session
    await db.insert(users).values({
      id: "uploader-2",
      username: "other-user",
      fourmId: "fourm-uploader-2",
      isAdmin: false,
    });
    await db.insert(folders).values({
      id: "session-2",
      name: "session-2",
      slug: "_inbox/session-2",
      parentId: "inbox",
      ownerId: "uploader-2",
    });
    await db.insert(files).values({
      id: "file-other",
      path: "_inbox/session-2/other.png",
      name: "other.png",
      mimeType: "image/png",
      size: 512,
      kind: "texture",
      folderId: "session-2",
      uploaderId: "uploader-2",
      status: "pending",
    });

    // Approve only uploader-1's files
    const result = await callAction(
      makeFormData({
        _action: "approve-all",
        destinationFolderId: "dest-folder",
        filterUploaderId: "uploader-1",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(3); // only uploader-1's files
    expect(result.sessionCount).toBe(1);

    // uploader-2's file should still be pending
    const stillPending = await db.query.files.findMany({ where: eq(files.status, "pending") });
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0].name).toBe("other.png");
  });

  test("approve without sessionFolderId returns error", async () => {
    const db = setupDatabase();
    await seedAdmin(db);

    const result = await callAction(
      makeFormData({
        _action: "approve",
        destinationFolderId: "dest-folder",
      }),
    );

    expect(result.error).toBe("Missing session folder ID");
  });

  test("approve without destination folder returns error", async () => {
    const db = setupDatabase();
    await seedAdmin(db);
    await seedInboxWithFiles(db, 1);

    const result = await callAction(
      makeFormData({
        _action: "approve",
        sessionFolderId: "session-1",
      }),
    );

    expect(result.error).toBe("Please select a destination folder");
  });
});
