import { db } from "./db.ts";

export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

export function createSession(userId: string): string {
  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days session

  db.query(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    userId,
    token,
    expiresAt.toISOString()
  );

  return token;
}

export function getUserIdFromSession(token: string | null): string | null {
  if (!token) return null;
  const session = db.query(`SELECT user_id, expires_at FROM sessions WHERE token = ?`).get(token) as { user_id: string; expires_at: string } | null;
  
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    // Delete expired session
    db.query(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }
  return session.user_id;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((res, item) => {
    const data = item.trim().split('=');
    return { ...res, [data[0]]: data[1] };
  }, {});
}
