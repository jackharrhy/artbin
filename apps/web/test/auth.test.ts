import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { inviteCodes, sessions, users } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import {
  createUser,
  getSession,
  login,
  parseSessionCookie,
  verifyPassword,
} from "~/lib/auth.server";
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

async function seedInviter(db: ReturnType<typeof setupDatabase>) {
  await db.insert(users).values({
    id: "inviter-1",
    email: "inviter@example.com",
    username: "inviter",
    passwordHash: "hash",
    isAdmin: true,
  });
}

async function seedInvite(
  db: ReturnType<typeof setupDatabase>,
  overrides: Partial<typeof inviteCodes.$inferInsert> = {},
) {
  await db.insert(inviteCodes).values({
    id: "invite-1",
    code: "INVITE",
    createdBy: "inviter-1",
    maxUses: 1,
    useCount: 0,
    isActive: true,
    ...overrides,
  });
}

describe("createUser", () => {
  test("creates a user with a hashed password and increments invite usage", async () => {
    const db = setupDatabase();
    await seedInviter(db);
    await seedInvite(db);

    const result = await createUser("new@example.com", "newuser", "password123", "INVITE");

    expect(result.isOk()).toBe(true);
    const user = result.unwrap();
    expect(user.email).toBe("new@example.com");
    expect(user.invitedBy).toBe("inviter-1");
    expect(user.passwordHash).not.toBe("password123");
    expect(await verifyPassword("password123", user.passwordHash)).toBe(true);

    const invite = await db.query.inviteCodes.findFirst({ where: eq(inviteCodes.code, "INVITE") });
    expect(invite?.useCount).toBe(1);
  });

  test("rejects exhausted invite codes", async () => {
    const db = setupDatabase();
    await seedInviter(db);
    await seedInvite(db, { useCount: 1 });

    const result = await createUser("new@example.com", "newuser", "password123", "INVITE");

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected exhausted invite to fail");
    expect(result.error.message).toBe("Invite code has reached its usage limit");
  });

  test("rejects duplicate email and username", async () => {
    const db = setupDatabase();
    await seedInviter(db);
    await seedInvite(db, { maxUses: 10 });

    const first = await createUser("new@example.com", "newuser", "password123", "INVITE");
    expect(first.isOk()).toBe(true);

    const duplicateEmail = await createUser("new@example.com", "other", "password123", "INVITE");
    expect(duplicateEmail.isErr()).toBe(true);
    if (!duplicateEmail.isErr()) throw new Error("Expected duplicate email to fail");
    expect(duplicateEmail.error.message).toBe("Email already registered");

    const duplicateUsername = await createUser(
      "other@example.com",
      "newuser",
      "password123",
      "INVITE",
    );
    expect(duplicateUsername.isErr()).toBe(true);
    if (!duplicateUsername.isErr()) throw new Error("Expected duplicate username to fail");
    expect(duplicateUsername.error.message).toBe("Username already taken");
  });
});

describe("login and sessions", () => {
  test("creates a session for valid credentials", async () => {
    const db = setupDatabase();
    await seedInviter(db);
    await seedInvite(db);
    await createUser("new@example.com", "newuser", "password123", "INVITE");

    const result = await login("new@example.com", "password123");

    expect(result.isOk()).toBe(true);
    const session = result.unwrap();
    expect(session.userId).toBeTruthy();

    const persisted = await db.query.sessions.findFirst({ where: eq(sessions.id, session.id) });
    expect(persisted?.id).toBe(session.id);
  });

  test("rejects invalid credentials", async () => {
    setupDatabase();

    const result = await login("missing@example.com", "password123");

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected invalid login to fail");
    expect(result.error.message).toBe("Invalid email or password");
  });

  test("deletes expired sessions when they are read", async () => {
    const db = setupDatabase();
    await db.insert(users).values({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      passwordHash: "hash",
    });
    await db.insert(sessions).values({
      id: "expired-session",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1000),
    });

    const session = await getSession("expired-session");

    expect(session).toBeNull();
    const persisted = await db.query.sessions.findFirst({
      where: eq(sessions.id, "expired-session"),
    });
    expect(persisted).toBeUndefined();
  });

  test("parses the artbin session cookie", () => {
    expect(parseSessionCookie("theme=dark; artbin_session=abc123; other=value")).toBe("abc123");
  });
});
