import { afterEach, describe, expect, test } from "vitest";
import { files, folders, sessions, users } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import { action as luckyAction } from "~/routes/api.lucky";
import { getLuckyContext } from "~/components/LuckyButton";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

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

async function seedSession(db: ReturnType<typeof setupDatabase>) {
  await db.insert(users).values({
    id: "user-1",
    username: "user",
    fourmId: "fourm-user-1",
  });
  await db.insert(sessions).values({
    id: "session-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function luckyRequest(fields: Record<string, string> = {}, authenticated = true) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);

  return new Request("http://localhost/api/lucky", {
    method: "POST",
    headers: authenticated ? { Cookie: "artbin_session=session-1" } : undefined,
    body: formData,
  });
}

async function callLucky(request: Request) {
  return luckyAction({ request, params: {}, context: {} } as any);
}

describe("Lucky API", () => {
  test("chooses an approved asset and ignores pending uploads", async () => {
    const db = setupDatabase();
    await seedSession(db);
    await db.insert(folders).values({ id: "folder-1", name: "Folder", slug: "folder" });
    await db.insert(files).values([
      {
        id: "approved",
        path: "folder/approved.png",
        name: "approved.png",
        mimeType: "image/png",
        size: 10,
        kind: "texture",
        folderId: "folder-1",
        status: "approved",
      },
      {
        id: "pending",
        path: "folder/pending.png",
        name: "pending.png",
        mimeType: "image/png",
        size: 10,
        kind: "texture",
        folderId: "folder-1",
        status: "pending",
      },
    ]);

    const response = await callLucky(luckyRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: "folder/approved.png" });
  });

  test("keeps folder-scoped requests inside the folder tree", async () => {
    const db = setupDatabase();
    await seedSession(db);
    await db.insert(folders).values([
      { id: "parent", name: "Parent", slug: "parent" },
      { id: "child", name: "Child", slug: "parent/child", parentId: "parent" },
      { id: "outside", name: "Outside", slug: "outside" },
    ]);
    await db.insert(files).values([
      {
        id: "inside",
        path: "parent/child/inside.bsp",
        name: "inside.bsp",
        mimeType: "application/octet-stream",
        size: 10,
        kind: "map",
        folderId: "child",
      },
      {
        id: "outside-file",
        path: "outside/outside.png",
        name: "outside.png",
        mimeType: "image/png",
        size: 10,
        kind: "texture",
        folderId: "outside",
      },
    ]);

    const response = await callLucky(luckyRequest({ folderId: "parent" }));

    expect(await response.json()).toEqual({ path: "parent/child/inside.bsp" });
  });

  test("avoids returning the current asset when another one is available", async () => {
    const db = setupDatabase();
    await seedSession(db);
    await db.insert(folders).values({ id: "folder-1", name: "Folder", slug: "folder" });
    await db.insert(files).values([
      {
        id: "current",
        path: "folder/current.png",
        name: "current.png",
        mimeType: "image/png",
        size: 10,
        kind: "texture",
        folderId: "folder-1",
      },
      {
        id: "next",
        path: "folder/next.wav",
        name: "next.wav",
        mimeType: "audio/wav",
        size: 10,
        kind: "audio",
        folderId: "folder-1",
      },
    ]);

    const response = await callLucky(
      luckyRequest({ folderId: "folder-1", excludePath: "folder/current.png" }),
    );

    expect(await response.json()).toEqual({ path: "folder/next.wav" });
  });

  test("falls back to the current asset when it is the only match", async () => {
    const db = setupDatabase();
    await seedSession(db);
    await db.insert(folders).values({ id: "folder-1", name: "Folder", slug: "folder" });
    await db.insert(files).values({
      id: "only",
      path: "folder/only.png",
      name: "only.png",
      mimeType: "image/png",
      size: 10,
      kind: "texture",
      folderId: "folder-1",
    });

    const response = await callLucky(
      luckyRequest({ folderId: "folder-1", excludePath: "folder/only.png" }),
    );

    expect(await response.json()).toEqual({ path: "folder/only.png" });
  });

  test("requires authentication outside development mode", async () => {
    setupDatabase();

    const response = await callLucky(luckyRequest({}, false));

    expect(response.status).toBe(401);
  });
});

describe("Lucky history state", () => {
  test("accepts an internal source location", () => {
    expect(
      getLuckyContext({
        lucky: {
          sourceHref: "/folder/maps?view=all",
          sourceLabel: "Maps",
          folderId: "maps",
        },
      }),
    ).toEqual({
      sourceHref: "/folder/maps?view=all",
      sourceLabel: "Maps",
      folderId: "maps",
    });
  });

  test("rejects missing or external source locations", () => {
    expect(getLuckyContext(null)).toBeNull();
    expect(
      getLuckyContext({ lucky: { sourceHref: "https://example.com", sourceLabel: "Elsewhere" } }),
    ).toBeNull();
  });
});
