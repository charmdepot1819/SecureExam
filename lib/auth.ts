import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth, getById, fdb, nowIso, update } from "./db";

export type User = {
  id: string;
  name: string;
  email: string;
  is_educator: number;
  view_mode?: "educator" | "student";
};

/** Firebase Hosting forwards only a cookie named "__session" to backends, so the app keeps all state in that one cookie. */
export const SESSION_COOKIE = "__session";
export const SESSION_DAYS = 14;

/**
 * Exchanges a fresh Firebase ID token (from the browser sign-in) for an HTTP-only session cookie,
 * and creates the user's profile on first sign-in. The very first profile becomes an educator.
 */
export async function createSessionFromIdToken(idToken: string, name?: string) {
  const decoded = await adminAuth().verifyIdToken(idToken, true);
  if (Date.now() / 1000 - decoded.auth_time > 5 * 60) throw new Error("Please sign in again.");
  const ref = fdb().collection("users").doc(decoded.uid);
  await fdb().runTransaction(async (t) => {
    const me = await t.get(ref);
    if (me.exists) return;
    const meta = fdb().collection("meta").doc("app");
    const m = await t.get(meta);
    const first = !m.exists || !m.data()?.has_users;
    t.set(meta, { has_users: true }, { merge: true });
    t.set(ref, {
      name: (name || decoded.name || decoded.email?.split("@")[0] || "User").slice(0, 120),
      email: (decoded.email || "").toLowerCase(),
      is_educator: first ? 1 : 0,
      created_at: nowIso(),
    });
  });
  const expiresIn = SESSION_DAYS * 864e5;
  const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    maxAge: expiresIn / 1000,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  const c = jar.get(SESSION_COOKIE)?.value;
  if (c) {
    try {
      const d = await adminAuth().verifySessionCookie(c);
      await adminAuth().revokeRefreshTokens(d.sub);
    } catch {}
  }
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const c = jar.get(SESSION_COOKIE)?.value;
  if (!c) return null;
  try {
    const d = await adminAuth().verifySessionCookie(c, true); // also rejects revoked sessions
    const u = await getById<User>("users", d.uid);
    return u ? { id: u.id, name: u.name, email: u.email, is_educator: u.is_educator, view_mode: u.view_mode } : null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Educator mode is on when the user is an educator and has not switched to student view. */
export async function educatorMode(user: User | null): Promise<boolean> {
  if (!user?.is_educator) return false;
  return user.view_mode !== "student";
}

/** Stored on the profile rather than in a second cookie (see SESSION_COOKIE). */
export async function setMode(userId: string, mode: "educator" | "student") {
  await update("users", userId, { view_mode: mode });
}

export async function requireEducator(): Promise<User> {
  const u = await requireUser();
  if (!u.is_educator) redirect("/dashboard");
  return u;
}

export async function courseRole(courseId: string, userId: string): Promise<"teacher" | "student" | null> {
  const r = await getById<{ role: "teacher" | "student" }>("enrollments", `${courseId}_${userId}`);
  return r?.role ?? null;
}

export async function requireTeacher(courseId: string): Promise<User> {
  const u = await requireUser();
  if ((await courseRole(courseId, u.id)) !== "teacher") redirect("/dashboard");
  return u;
}
