/**
 * Uploaded files stored in Firestore, split into chunks.
 * Why: Cloud Storage for Firebase needs the paid Blaze plan, and Vercel Hobby limits each request to 4.5 MB.
 * The browser sends a file in pieces of up to CHUNK_BYTES; each piece becomes one Firestore document
 * (documents are limited to 1 MiB). Everything counts toward Firestore's 1 GiB free storage.
 */
import crypto from "node:crypto";
import { AggregateField } from "firebase-admin/firestore";
import { fdb, getById, nowIso, where } from "./db";

export const CHUNK_BYTES = 900 * 1024;
/** Hard ceiling a teacher can set per question. */
export const MAX_FILE_MB = 10;
/**
 * Default per-question cap. Sized for one class of ~100 students on Firestore's free 1 GiB:
 * 100 students × 2 MB = 200 MB per file assignment at most, so about five full assignments
 * fit before files must be purged (grades are kept; see purgeFiles).
 */
export const DEFAULT_FILE_MB = 2;

export type FileMeta = {
  id: string;
  owner_id: string;
  attempt_id: string;
  question_id: string;
  course_id: string;
  exam_id: string;
  name: string;
  size: number;
  chunks: number;
  received: number;
  complete: boolean;
  created_at: string;
};

export async function beginFile(meta: Omit<FileMeta, "id" | "received" | "complete" | "created_at">): Promise<string> {
  const id = crypto.randomBytes(12).toString("hex");
  await fdb().collection("files").doc(id).set({ ...meta, received: 0, complete: false, created_at: nowIso() });
  return id;
}

export async function putChunk(fileId: string, index: number, data: Buffer) {
  if (data.length > CHUNK_BYTES) throw new Error("Chunk too large");
  const ref = fdb().collection("files").doc(fileId);
  await ref.collection("chunks").doc(String(index).padStart(5, "0")).set({ i: index, data });
  const done = await fdb().runTransaction(async (t) => {
    const m = (await t.get(ref)).data() as FileMeta;
    const received = (m.received || 0) + 1;
    const complete = received >= m.chunks;
    t.update(ref, { received, complete });
    return complete;
  });
  return done;
}

export async function getFileMeta(fileId: string) {
  return getById<FileMeta>("files", fileId);
}

export async function readFile(fileId: string): Promise<Buffer> {
  const snap = await fdb().collection("files").doc(fileId).collection("chunks").orderBy("i").get();
  return Buffer.concat(snap.docs.map((d) => Buffer.from(d.data().data)));
}

export async function deleteFile(fileId: string | null | undefined) {
  if (!fileId) return;
  const ref = fdb().collection("files").doc(fileId);
  const chunks = await ref.collection("chunks").get();
  const b = fdb().batch();
  chunks.docs.forEach((d) => b.delete(d.ref));
  b.delete(ref);
  await b.commit();
}

/** Bytes stored in uploads (Firestore aggregate query: one read per 1,000 index entries). */
export async function storedBytes(courseId?: string): Promise<number> {
  let q: FirebaseFirestore.Query = fdb().collection("files");
  if (courseId) q = q.where("course_id", "==", courseId);
  const snap = await q.aggregate({ bytes: AggregateField.sum("size") }).get();
  return Number(snap.data().bytes || 0);
}

/**
 * Deletes uploaded files but keeps every grade and comment: the response is marked file_purged
 * so the student and teacher see "File deleted after grading" instead of a download link.
 */
export async function purgeFiles(files: FileMeta[]): Promise<{ count: number; bytes: number }> {
  let bytes = 0;
  for (const f of files) {
    await deleteFile(f.id);
    bytes += f.size || 0;
    const rid = `${f.attempt_id}_${f.question_id}`;
    const r = await fdb().collection("responses").doc(rid).get();
    if (r.exists && r.data()!.file_path === f.id) await r.ref.update({ file_path: null, file_purged: 1 });
  }
  return { count: files.length, bytes };
}

export const filesWhere = (...conds: Parameters<typeof where>[1][]) => where<FileMeta>("files", ...conds);

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
