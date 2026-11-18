import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { getById, upsert } from "./db";
import { SESSION_COOKIE } from "./auth";
import type { Exam } from "./exam";
import { buildSebConfig, configKey, urlKeyHash, SEB_HEADERS } from "./seb";

/** Public base URL (scheme + host) of this app as the student's browser sees it. */
export async function baseUrl(): Promise<string> {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export function examSebConfig(exam: Exam, base: string) {
  const host = base.replace(/^https?:\/\//, "");
  return buildSebConfig({
    baseUrl: base,
    examId: exam.id,
    quitPasswordHash: exam.seb_quit_hash || undefined,
    allowedHosts: [host],
  });
}

/** Keys accepted for this exam: the computed Config Key plus any keys the teacher pasted (Config Keys or Browser Exam Keys). */
export function acceptedKeys(exam: Exam, base: string): string[] {
  const extra = (exam.seb_extra_keys || "")
    .split(/[\s,]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => /^[0-9a-f]{64}$/.test(k));
  return [configKey(examSebConfig(exam, base)), ...extra];
}

/** True if any provided hash equals SHA-256(url + key) for an accepted key. */
export function hashesMatch(exam: Exam, base: string, url: string, provided: (string | null | undefined)[]): boolean {
  const keys = acceptedKeys(exam, base);
  const got = provided.filter(Boolean).map((p) => p!.toLowerCase());
  if (!got.length) return false;
  return keys.some((k) => got.includes(urlKeyHash(url, k)));
}

/** Verifies SEB request headers (sent by SEB for Windows and the classic WebView on macOS/iOS). */
export async function verifySebHeaders(exam: Exam, pathWithQuery: string): Promise<boolean> {
  const h = await headers();
  const base = await baseUrl();
  return hashesMatch(exam, base, base + pathWithQuery, [h.get(SEB_HEADERS.configKey), h.get(SEB_HEADERS.browserExamKey)]);
}

export type LockdownClient = "seb";

const PASS_HOURS = 6;
const sessionHash = (c: string) => crypto.createHash("sha256").update(c).digest("hex");

/**
 * Records that this user's current login session was verified inside SEB for this exam.
 * Stored in Firestore (not a separate cookie) and bound to the session cookie, so a pass earned in SEB
 * can't be reused from another browser.
 */
export async function grantLockdownPass(examId: string, userId: string, client: LockdownClient) {
  const jar = await cookies();
  const c = jar.get(SESSION_COOKIE)?.value;
  if (!c) return;
  await upsert("lockdown_passes", `${examId}_${userId}`, {
    exam_id: examId,
    user_id: userId,
    client,
    session_hash: sessionHash(c),
    expires_at: new Date(Date.now() + PASS_HOURS * 3600e3).toISOString(),
  });
}

async function readPass(examId: string, userId: string): Promise<LockdownClient | null> {
  const jar = await cookies();
  const c = jar.get(SESSION_COOKIE)?.value;
  if (!c) return null;
  const p = await getById("lockdown_passes", `${examId}_${userId}`);
  if (!p || p.session_hash !== sessionHash(c) || new Date(p.expires_at) < new Date()) return null;
  return p.client === "seb" ? "seb" : null;
}

export async function hasLockdownPass(examId: string, userId: string): Promise<boolean> {
  return !!(await readPass(examId, userId));
}

export async function lockdownClient(examId: string, userId: string): Promise<string> {
  return (await readPass(examId, userId)) || "browser";
}
