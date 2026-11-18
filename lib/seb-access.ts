import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies, headers } from "next/headers";
import { DATA_DIR } from "./db";
import type { Exam } from "./exam";
import { buildSebConfig, configKey, urlKeyHash, SEB_HEADERS } from "./seb";

/** Server secret used to sign SEB pass cookies. Taken from APP_SECRET or generated once into the data folder. */
function secret(): string {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const f = path.join(DATA_DIR, ".secret");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(f, "utf8").trim();
}

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
const passCookie = (examId: number) => `eo_ld_${examId}`;

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Issues a signed, short-lived cookie proving this user's session was verified inside a lockdown client for this exam. */
export async function grantLockdownPass(examId: number, userId: number, client: LockdownClient) {
  const exp = Date.now() + PASS_HOURS * 3600e3;
  const payload = `${userId}.${examId}.${exp}.${client}`;
  const jar = await cookies();
  jar.set(passCookie(examId), `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: "lax", path: "/", expires: new Date(exp) });
}

async function readPass(examId: number, userId: number): Promise<LockdownClient | null> {
  const jar = await cookies();
  const v = jar.get(passCookie(examId))?.value;
  if (!v) return null;
  const [u, e, exp, client, sig] = v.split(".");
  const expected = sign(`${u}.${e}.${exp}.${client}`);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(u) !== userId || Number(e) !== examId || Number(exp) < Date.now()) return null;
  return client === "seb" ? client : null;
}

export async function hasLockdownPass(examId: number, userId: number): Promise<boolean> {
  return !!(await readPass(examId, userId));
}

export async function lockdownClient(examId: number, userId: number): Promise<string> {
  return (await readPass(examId, userId)) || "browser";
}
