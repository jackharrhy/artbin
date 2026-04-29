import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function createDb(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}

export type AppDb = ReturnType<typeof createDb>;

const dbPath = process.env.ARTBIN_DB_PATH ?? "data/artbin.db";
mkdirSync(dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
export let db: AppDb = createDb(sqlite);

export function setDbForTesting(nextDb: AppDb): void {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    throw new Error("setDbForTesting can only be used in tests");
  }

  db = nextDb;
}
