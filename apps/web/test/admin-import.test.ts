import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { jobs, folders, users } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

const mockUserContextKey = Symbol("userContext");

vi.mock("~/lib/auth-context.server", () => ({
  userContext: mockUserContextKey,
  authMiddleware: vi.fn(),
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
    fourmId: "fourm-admin-1",
    isAdmin: true,
    createdAt: new Date(),
  });
  return { get: (key: symbol) => store.get(key) };
}

describe("/admin/import remote sites", () => {
  let action: Function;

  beforeAll(async () => {
    action = (await import("~/routes/admin.import")).action;
  });

  test("queues unique supported URLs beneath the selected folder", async () => {
    const db = setupDatabase();
    await db.insert(users).values({
      id: "admin-1",
      username: "admin",
      fourmId: "fourm-admin-1",
      isAdmin: true,
    });
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });
    const formData = new FormData();
    formData.set("intent", "remote-site-import");
    formData.set(
      "sourceUrls",
      [
        "https://gamebanana.com/mods/140244",
        "https://www.gamebanana.com/mods/140244?duplicate=1",
        "https://scmapdb.com/map:decay",
        "https://downloads.example.com/mapper-pack.zip",
      ].join("\n"),
    );
    formData.set("targetFolderId", "maps");

    const result = await action({
      request: new Request("http://localhost/admin/import", { method: "POST", body: formData }),
      params: {},
      context: makeAdminContext(),
    });

    expect(result).toMatchObject({ success: true, action: "remote-site-import", count: 3 });
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(3);
    expect(queued.map((job) => JSON.parse(job.input))).toEqual([
      {
        sourceUrl: "https://gamebanana.com/mods/140244",
        targetFolderId: "maps",
        userId: "admin-1",
      },
      {
        sourceUrl: "https://scmapdb.wikidot.com/map:decay",
        targetFolderId: "maps",
        userId: "admin-1",
      },
      {
        sourceUrl: "https://downloads.example.com/mapper-pack.zip",
        targetFolderId: "maps",
        userId: "admin-1",
      },
    ]);
  });

  test("rejects unsupported URLs before creating a job", async () => {
    const db = setupDatabase();
    await db.insert(users).values({
      id: "admin-1",
      username: "admin",
      fourmId: "fourm-admin-1",
      isAdmin: true,
    });
    const formData = new FormData();
    formData.set("intent", "remote-site-import");
    formData.set("sourceUrls", "https://example.com/maps/nope");

    const result = await action({
      request: new Request("http://localhost/admin/import", { method: "POST", body: formData }),
      params: {},
      context: makeAdminContext(),
    });

    expect(result.error).toContain("Supported sources");
    expect(await db.select().from(jobs)).toHaveLength(0);
  });
});
