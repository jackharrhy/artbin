import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { folders } from "~/db/schema";
import { setDbForTesting } from "~/db";
import {
  deleteFileRecord,
  generatePreview,
  getImageDimensions,
  insertFileRecord,
  processImage,
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

    const insert = await insertFileRecord({
      id: "file-1",
      path: "textures/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 123,
      kind: "texture",
      folderId: "folder-1",
    });
    expect(insert.isOk()).toBe(true);

    const afterInsert = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(afterInsert?.fileCount).toBe(1);

    const deleted = await deleteFileRecord("file-1");
    expect(deleted.isOk()).toBe(true);

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

    const insert = await insertFileRecord({
      id: "file-1",
      path: "textures/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 123,
      kind: "texture",
      folderId: "folder-1",
    });
    expect(insert.isOk()).toBe(true);

    await recalculateFolderCounts(["folder-1"]);

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(folder?.fileCount).toBe(1);
  });

  test("returns an error when inserting a duplicate file record fails", async () => {
    const db = setupDatabase();

    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    const record = {
      id: "file-1",
      path: "textures/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 123,
      kind: "texture" as const,
      folderId: "folder-1",
    };

    expect((await insertFileRecord(record)).isOk()).toBe(true);

    const duplicate = await insertFileRecord(record);

    expect(duplicate.isErr()).toBe(true);
  });
});

describe("image processing Result APIs", () => {
  test("returns an error when image dimensions cannot be read", async () => {
    const result = await getImageDimensions("/definitely/not/here.png");

    expect(result.isErr()).toBe(true);
  });

  test("returns an error when preview generation fails", async () => {
    const result = await generatePreview("/definitely/not/here.tga");

    expect(result.isErr()).toBe(true);
  });

  test("returns an error when processing a legacy image cannot generate a preview", async () => {
    const result = await processImage("missing.tga");

    expect(result.isErr()).toBe(true);
  });
});
