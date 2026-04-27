import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { nanoid } from "nanoid";
import bcrypt from "bcrypt";
import * as schema from "../src/db/schema";

const sqlite = new Database("artbin.db");
const db = drizzle(sqlite, { schema });

async function createAdmin() {
  const email = process.argv[2];
  const username = process.argv[3];
  const password = process.argv[4];

  if (!email || !username || !password) {
    console.error("Usage: npx tsx scripts/create-admin.ts <email> <username> <password>");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const [user] = await db
      .insert(schema.users)
      .values({
        id: nanoid(),
        email,
        username,
        passwordHash,
        isAdmin: true,
      })
      .returning();

    console.log(`Admin user created successfully!`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Is Admin: ${user.isAdmin}`);

    // Create an initial invite code for this admin
    const inviteCode = nanoid(8).toUpperCase();
    await db.insert(schema.inviteCodes).values({
      id: nanoid(),
      code: inviteCode,
      createdBy: user.id,
    });

    console.log(`\nFirst invite code: ${inviteCode}`);
  } catch (error: any) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      console.error("Error: Email or username already exists");
    } else {
      console.error("Error creating admin:", error.message);
    }
    process.exit(1);
  }

  sqlite.close();
}

createAdmin();
