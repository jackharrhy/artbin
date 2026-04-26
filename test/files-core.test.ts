import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { folders } from "~/db/schema";
import { setDbForTesting } from "~/db";
import {
  deleteFileRecord,
  insertFileRecord,
  recalculateFolderCounts,
} from "~/lib/files.server";
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

describe("file record count sync", () => {
  test("inserting and deleting file records keeps parent folder file_count in sync", async () => {
    const db = setupDatabase();

    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    await insertFileRecord({
      id: "file-1",
      path: "textures/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 123,
      kind: "texture",
      folderId: "folder-1",
    });

    const afterInsert = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(afterInsert?.fileCount).toBe(1);

    await deleteFileRecord("file-1");

    const afterDelete = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(afterDelete?.fileCount).toBe(0);
  });

  test("recalculating folder counts repairs drift", async () => {
    const db = setupDatabase();

    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
      fileCount: 99,
    });

    await insertFileRecord({
      id: "file-1",
      path: "textures/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 123,
      kind: "texture",
      folderId: "folder-1",
    });

    await recalculateFolderCounts(["folder-1"]);

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(folder?.fileCount).toBe(1);
  });
});
