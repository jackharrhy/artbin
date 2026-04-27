import { db, users, sessions, inviteCodes } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Result } from "better-result";
import bcrypt from "bcrypt";

const SESSION_COOKIE = "artbin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createUser(
  email: string,
  username: string,
  password: string,
  inviteCode?: string,
) {
  // Check if invite code is valid (if provided)
  let invitedBy: string | null = null;
  if (inviteCode) {
    const invite = await db.query.inviteCodes.findFirst({
      where: eq(inviteCodes.code, inviteCode),
    });
    if (!invite) {
      return Result.err(new Error("Invalid invite code"));
    }
    if (!invite.isActive) {
      return Result.err(new Error("Invite code is no longer active"));
    }
    if (invite.maxUses !== null && (invite.useCount ?? 0) >= invite.maxUses) {
      return Result.err(new Error("Invite code has reached its usage limit"));
    }
    invitedBy = invite.createdBy;
  }

  // Check if email or username already exists
  const existingEmail = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existingEmail) {
    return Result.err(new Error("Email already registered"));
  }

  const existingUsername = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (existingUsername) {
    return Result.err(new Error("Username already taken"));
  }

  const id = nanoid();
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      id,
      email,
      username,
      passwordHash,
      invitedBy,
    })
    .returning();

  // Increment invite use count
  if (inviteCode) {
    const invite = await db.query.inviteCodes.findFirst({
      where: eq(inviteCodes.code, inviteCode),
    });
    if (invite) {
      await db
        .update(inviteCodes)
        .set({ useCount: (invite.useCount ?? 0) + 1 })
        .where(eq(inviteCodes.code, inviteCode));
    }
  }

  return Result.ok(user);
}

export async function login(email: string, password: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    return Result.err(new Error("Invalid email or password"));
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return Result.err(new Error("Invalid email or password"));
  }

  // Create session
  const sessionId = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

  const [session] = await db
    .insert(sessions)
    .values({
      id: sessionId,
      userId: user.id,
      expiresAt,
    })
    .returning();

  return Result.ok(session);
}

export async function logout(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function getSession(sessionId: string | undefined) {
  if (!sessionId) return null;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  return session;
}

export async function getUserFromSession(sessionId: string | undefined) {
  const session = await getSession(sessionId);
  if (!session) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  return user;
}

export async function createInviteCode(userId: string, maxUses?: number): Promise<string> {
  const code = nanoid(8).toUpperCase();
  await db.insert(inviteCodes).values({
    id: nanoid(),
    code,
    createdBy: userId,
    maxUses: maxUses ?? null,
    useCount: 0,
    isActive: true,
  });
  return code;
}

export async function deleteInviteCode(userId: string, codeId: string): Promise<boolean> {
  const invite = await db.query.inviteCodes.findFirst({
    where: eq(inviteCodes.id, codeId),
  });
  if (!invite || invite.createdBy !== userId) {
    return false;
  }
  await db.delete(inviteCodes).where(eq(inviteCodes.id, codeId));
  return true;
}

export async function toggleInviteCode(userId: string, codeId: string): Promise<boolean> {
  const invite = await db.query.inviteCodes.findFirst({
    where: eq(inviteCodes.id, codeId),
  });
  if (!invite || invite.createdBy !== userId) {
    return false;
  }
  await db
    .update(inviteCodes)
    .set({ isActive: !invite.isActive })
    .where(eq(inviteCodes.id, codeId));
  return true;
}

export async function getInviteByCode(code: string) {
  return db.query.inviteCodes.findFirst({
    where: eq(inviteCodes.code, code),
  });
}

export function getSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function getClearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function parseSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1];
}
