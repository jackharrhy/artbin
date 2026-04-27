import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function createDb(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}

export type AppDb = ReturnType<typeof createDb>;

const sqlite = new Database(process.env.ARTBIN_DB_PATH ?? "artbin.db");
export let db: AppDb = createDb(sqlite);

export function setDbForTesting(nextDb: AppDb): void {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    throw new Error("setDbForTesting can only be used in tests");
  }

  db = nextDb;
}

export * from "./schema";
