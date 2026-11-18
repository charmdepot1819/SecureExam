import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { get, run } from "./db";

export type User = {
  id: number;
  name: string;
  email: string;
  is_educator: number;
};

const SESSION_COOKIE = "eo_session";
const MODE_COOKIE = "eo_mode";
const SESSION_DAYS = 14;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export async function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userId, expires.toISOString());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    expires,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE token = ?", token);
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = get<User & { expires_at: string }>(
    `SELECT u.id, u.name, u.email, u.is_educator, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    token
  );
  if (!row || new Date(row.expires_at) < new Date()) return null;
  return { id: row.id, name: row.name, email: row.email, is_educator: row.is_educator };
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Educator mode is on when the user is an educator and has not switched to student view. */
export async function educatorMode(user: User | null): Promise<boolean> {
  if (!user?.is_educator) return false;
  const jar = await cookies();
  return jar.get(MODE_COOKIE)?.value !== "student";
}

export async function setMode(mode: "educator" | "student") {
  const jar = await cookies();
  jar.set(MODE_COOKIE, mode, { path: "/", sameSite: "lax" });
}

export async function requireEducator(): Promise<User> {
  const u = await requireUser();
  if (!u.is_educator) redirect("/dashboard");
  return u;
}

export function courseRole(courseId: number, userId: number): "teacher" | "student" | null {
  const r = get<{ role: "teacher" | "student" }>(
    "SELECT role FROM enrollments WHERE course_id = ? AND user_id = ?",
    courseId,
    userId
  );
  return r?.role ?? null;
}

export async function requireTeacher(courseId: number): Promise<User> {
  const u = await requireUser();
  if (courseRole(courseId, u.id) !== "teacher") redirect("/dashboard");
  return u;
}
