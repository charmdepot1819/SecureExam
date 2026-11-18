/**
 * Firebase Admin access (server only). All reads and writes go through the server with the Admin SDK;
 * the Firestore security rules deny direct access from browsers (see firestore.rules).
 *
 * Collections (documents keep the same snake_case fields the app used with SQL):
 *   users/{uid}                     name, email, is_educator, created_at
 *   courses/{id}                    title, code, description, owner_id, created_at
 *   enrollments/{courseId_userId}   course_id, user_id, role ('teacher' | 'student')
 *   banks/{id}                      course_id, title
 *   questions/{id}                  course_id, bank_id, type, prompt, options, answer, points, feedback, created_at
 *   exams/{id}                      course_id, title, settings…, published, assign_all
 *   exam_items/{id}                 exam_id, position, question_id | bank_id + draw_count
 *   exam_assignees/{examId_userId}  exam_id, user_id
 *   attempts/{id}                   exam_id, user_id, started_at, deadline_at, status, score, layout_json, …
 *   responses/{attemptId_qid}       attempt_id, question_id, answer_json, file_path, file_name, points_awarded, …
 *   attempt_events/{id}             attempt_id, type, detail, at
 *   files/{id}                      upload metadata; files/{id}/chunks/{n} hold the bytes (≤ 900 KB each)
 *   lockdown_passes/{examId_userId} Safe Exam Browser verification bound to a login session
 */
import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore, type WhereFilterOp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

/**
 * Admin credentials come from FIREBASE_SERVICE_ACCOUNT: the service-account JSON downloaded from
 * Firebase console → Project settings → Service accounts (paste the JSON, or base64 of it).
 * Without it (local emulators), only the project id is needed.
 */
function config() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (raw) {
    const json = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    return { credential: cert(json), projectId: json.project_id };
  }
  return { projectId: process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID };
}

declare global {
  // eslint-disable-next-line no-var
  var __fbApp: App | undefined;
  // eslint-disable-next-line no-var
  var __fs: Firestore | undefined;
}

export function app(): App {
  if (globalThis.__fbApp) return globalThis.__fbApp;
  globalThis.__fbApp = getApps()[0] ?? initializeApp(config());
  return globalThis.__fbApp;
}

export function fdb(): Firestore {
  if (!globalThis.__fs) {
    globalThis.__fs = getFirestore(app());
    globalThis.__fs.settings({ ignoreUndefinedProperties: true });
  }
  return globalThis.__fs;
}

export const adminAuth = () => getAuth(app());
export { FieldValue };

export type Cond = [string, WhereFilterOp, any];

function withId<T>(d: FirebaseFirestore.DocumentSnapshot): T {
  return { id: d.id, ...(d.data() as any) } as T;
}

export async function getById<T = any>(collection: string, id: string | null | undefined): Promise<T | undefined> {
  if (!id) return undefined;
  const d = await fdb().collection(collection).doc(String(id)).get();
  return d.exists ? withId<T>(d) : undefined;
}

/** Equality/array-contains queries only, so no composite indexes are needed. Sort in code. */
export async function where<T = any>(collection: string, ...conds: Cond[]): Promise<T[]> {
  let q: FirebaseFirestore.Query = fdb().collection(collection);
  for (const [f, op, v] of conds) q = q.where(f, op, v);
  const snap = await q.get();
  return snap.docs.map((d) => withId<T>(d));
}

export async function first<T = any>(collection: string, ...conds: Cond[]): Promise<T | undefined> {
  let q: FirebaseFirestore.Query = fdb().collection(collection);
  for (const [f, op, v] of conds) q = q.where(f, op, v);
  const snap = await q.limit(1).get();
  return snap.empty ? undefined : withId<T>(snap.docs[0]);
}

/** Fetches documents by id in batches (one read each), instead of scanning the whole collection. */
export async function getMany<T = any>(collection: string, ids: (string | null | undefined)[]): Promise<Map<string, T>> {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  const out = new Map<string, T>();
  for (let i = 0; i < uniq.length; i += 300) {
    const refs = uniq.slice(i, i + 300).map((id) => fdb().collection(collection).doc(id));
    const snaps = await fdb().getAll(...refs);
    for (const d of snaps) if (d.exists) out.set(d.id, withId<T>(d));
  }
  return out;
}

export async function allDocs<T = any>(collection: string, limit = 1000): Promise<T[]> {
  const snap = await fdb().collection(collection).limit(limit).get();
  return snap.docs.map((d) => withId<T>(d));
}

export async function insert(collection: string, data: Record<string, any>, id?: string): Promise<string> {
  const ref = id ? fdb().collection(collection).doc(id) : fdb().collection(collection).doc();
  await ref.set(data);
  return ref.id;
}

export async function upsert(collection: string, id: string, data: Record<string, any>) {
  await fdb().collection(collection).doc(id).set(data, { merge: true });
}

export async function update(collection: string, id: string, data: Record<string, any>) {
  await fdb().collection(collection).doc(id).update(data);
}

export async function remove(collection: string, id: string) {
  await fdb().collection(collection).doc(id).delete();
}

/** Deletes every document matching the conditions (batched). */
export async function removeWhere(collection: string, ...conds: Cond[]) {
  const rows = await where(collection, ...conds);
  for (let i = 0; i < rows.length; i += 400) {
    const b = fdb().batch();
    for (const r of rows.slice(i, i + 400)) b.delete(fdb().collection(collection).doc(r.id));
    await b.commit();
  }
}

export const nowIso = () => new Date().toISOString();
