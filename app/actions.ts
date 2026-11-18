"use server";

import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fdb, getById, insert, remove, removeWhere, update, upsert, where, first, nowIso } from "@/lib/db";
import {
  createSessionFromIdToken,
  destroySession,
  requireUser,
  requireEducator,
  requireTeacher,
  setMode,
  courseRole,
} from "@/lib/auth";
import {
  EXAM_DEFAULTS,
  canStart,
  examItems,
  getAttempt,
  getExam,
  getQuestion,
  logEvent,
  newOptionId,
  pastDeadline,
  DEADLINE_GRACE_MS,
  recomputeScore,
  respId,
  saveAnswer,
  startAttempt,
  submitAttempt,
  getQuestions,
  type Attempt,
  type LayoutEntry,
  type QType,
} from "@/lib/exam";
import { hasLockdownPass, lockdownClient } from "@/lib/seb-access";
import { hashQuitPassword } from "@/lib/seb";
import { beginFile, putChunk, getFileMeta, deleteFile, purgeFiles, filesWhere, CHUNK_BYTES, MAX_FILE_MB, DEFAULT_FILE_MB } from "@/lib/files";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === "" ? null : Number(v);
};
const bool = (f: FormData, k: string) => (f.get(k) ? 1 : 0);
/** datetime-local value + client timezone offset (minutes) → ISO string */
const dt = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!v) return null;
  const off = Number(str(f, "tz_offset") || 0);
  const d = new Date(v + "Z");
  return new Date(d.getTime() + off * 60000).toISOString();
};

// ---------- Auth ----------

/** Called by the sign-in/up form after Firebase Authentication succeeds in the browser. */
export async function establishSession(idToken: string, name?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await createSessionFromIdToken(idToken, name);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || "Sign-in failed") };
  }
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function toggleMode(f: FormData) {
  const u = await requireEducator();
  await setMode(u.id, str(f, "mode") === "student" ? "student" : "educator");
  redirect("/dashboard");
}

export async function setEducator(f: FormData) {
  const me = await requireEducator();
  const uid = str(f, "user_id");
  if (uid === me.id) return;
  await update("users", uid, { is_educator: bool(f, "value") });
  revalidatePath("/admin/users");
}

// ---------- Courses & people ----------

export async function createCourse(f: FormData) {
  const u = await requireEducator();
  const title = str(f, "title");
  if (!title) return;
  const id = await insert("courses", { title, code: str(f, "code"), description: str(f, "description"), owner_id: u.id, created_at: nowIso() });
  await insert("enrollments", { course_id: id, user_id: u.id, role: "teacher" }, `${id}_${u.id}`);
  await insert("banks", { course_id: id, title: "General" });
  redirect(`/courses/${id}`);
}

/** Tags users as students (or co-teachers) in a course. Accepts checkbox ids and/or a list of emails. */
export async function tagUsers(f: FormData) {
  const courseId = str(f, "course_id");
  await requireTeacher(courseId);
  const role = str(f, "role") === "teacher" ? "teacher" : "student";
  const ids = f.getAll("user_id").map(String);
  const emails = str(f, "emails").split(/[\s,;]+/).filter(Boolean);
  for (const e of emails) {
    const u = await first("users", ["email", "==", e.toLowerCase()]);
    if (u) ids.push(u.id);
  }
  for (const id of new Set(ids)) {
    if (await getById("users", id)) await upsert("enrollments", `${courseId}_${id}`, { course_id: courseId, user_id: id, role });
  }
  revalidatePath(`/courses/${courseId}/people`);
}

export async function untagUser(f: FormData) {
  const courseId = str(f, "course_id");
  const me = await requireTeacher(courseId);
  const uid = str(f, "user_id");
  if (uid === me.id) return;
  await remove("enrollments", `${courseId}_${uid}`);
  revalidatePath(`/courses/${courseId}/people`);
}

// ---------- Question banks & questions ----------

export async function createBank(f: FormData) {
  const courseId = str(f, "course_id");
  await requireTeacher(courseId);
  const title = str(f, "title");
  if (title) await insert("banks", { course_id: courseId, title });
  revalidatePath(`/courses/${courseId}/bank`);
}

/**
 * Saves a question from the QuestionEditor client component, which posts a JSON payload.
 * If exam_id is given, the new question is also appended to that exam.
 */
export async function saveQuestion(f: FormData) {
  const courseId = str(f, "course_id");
  await requireTeacher(courseId);
  const data = JSON.parse(String(f.get("payload")));
  const type = data.type as QType;
  if (!["mc", "multi", "tf", "short", "essay", "file"].includes(type)) throw new Error("Bad type");
  let options: { id: string; text: string }[] = [];
  let answer: any = {};
  if (type === "mc" || type === "multi") {
    const withKey = (data.options || [])
      .filter((o: any) => String(o.text || "").trim())
      .map((o: any) => ({ id: o.id || newOptionId(), text: String(o.text).trim(), correct: !!o.correct }));
    const correct = withKey.filter((o: any) => o.correct).map((o: any) => o.id);
    answer = type === "mc" ? { correct: correct[0] ?? null } : { correct };
    options = withKey.map(({ id, text }: any) => ({ id, text }));
  } else if (type === "tf") {
    options = [
      { id: "true", text: "True" },
      { id: "false", text: "False" },
    ];
    answer = { correct: data.tf === "false" ? "false" : "true" };
  } else if (type === "short") {
    answer = { accepted: String(data.accepted || "").split("\n").map((s: string) => s.trim()).filter(Boolean) };
  } else if (type === "file") {
    answer = { accept: String(data.accept || "").trim(), maxMb: Math.max(1, Math.min(MAX_FILE_MB, Number(data.maxMb) || DEFAULT_FILE_MB)) };
  }
  const bankId = data.bank_id ? String(data.bank_id) : null;
  if (bankId) {
    const b = await getById("banks", bankId);
    if (!b || b.course_id !== courseId) throw new Error("Bad bank");
  }
  const doc = {
    course_id: courseId,
    bank_id: bankId,
    type,
    prompt: String(data.prompt || ""),
    options,
    answer,
    points: Math.max(0, Number(data.points) || 1),
    feedback: String(data.feedback || ""),
  };
  const qid = data.id ? String(data.id) : "";
  if (qid) {
    const q = await getQuestion(qid);
    if (!q || q.course_id !== courseId) throw new Error("Not found");
    await update("questions", qid, doc);
  } else {
    const newId = await insert("questions", { ...doc, created_at: nowIso() });
    const examId = str(f, "exam_id");
    if (examId) {
      const exam = await getExam(examId);
      if (exam?.course_id === courseId) await addItem(examId, { question_id: newId });
    }
  }
  const back = str(f, "back");
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : `/courses/${courseId}/bank`);
}

export async function deleteQuestion(f: FormData) {
  const courseId = str(f, "course_id");
  await requireTeacher(courseId);
  const qid = str(f, "question_id");
  const q = await getQuestion(qid);
  if (!q || q.course_id !== courseId) return;
  await remove("questions", qid);
  await removeWhere("exam_items", ["question_id", "==", qid]);
  revalidatePath(`/courses/${courseId}/bank`);
}

// ---------- Exams ----------

async function teacherExam(f: FormData) {
  const exam = await getExam(str(f, "exam_id"));
  if (!exam) redirect("/dashboard");
  const u = await requireTeacher(exam.course_id);
  return { exam, u };
}

export async function createExam(f: FormData) {
  const courseId = str(f, "course_id");
  await requireTeacher(courseId);
  const kind = (["quiz", "exam", "assignment"].includes(str(f, "kind")) ? str(f, "kind") : "quiz") as any;
  const a = kind === "assignment";
  const id = await insert("exams", {
    ...EXAM_DEFAULTS,
    course_id: courseId,
    title: str(f, "title") || "Untitled",
    kind,
    focus_policy: a ? "off" : "submit",
    require_fullscreen: a ? 0 : 1,
    block_copy: a ? 0 : 1,
    created_at: nowIso(),
  });
  redirect(`/exams/${id}/edit`);
}

export async function updateExamSettings(f: FormData) {
  const { exam } = await teacherExam(f);
  const fp = str(f, "focus_policy");
  const fm = str(f, "feedback_mode");
  const quitPw = String(f.get("seb_quit_password") || "");
  await update("exams", exam.id, {
    title: str(f, "title") || "Untitled",
    instructions: str(f, "instructions"),
    kind: ["quiz", "exam", "assignment"].includes(str(f, "kind")) ? str(f, "kind") : "quiz",
    time_limit_min: num(f, "time_limit_min") || null,
    available_from: dt(f, "available_from"),
    due_at: dt(f, "due_at"),
    lock_at: dt(f, "lock_at"),
    allow_late: bool(f, "allow_late"),
    max_attempts: Math.max(0, num(f, "max_attempts") ?? 1),
    shuffle_questions: bool(f, "shuffle_questions"),
    shuffle_options: bool(f, "shuffle_options"),
    feedback_mode: ["immediate", "after_due", "never"].includes(fm) ? fm : "after_due",
    show_correct: bool(f, "show_correct"),
    focus_policy: ["off", "log", "submit"].includes(fp) ? fp : "submit",
    focus_warnings: Math.max(0, num(f, "focus_warnings") ?? 0),
    require_fullscreen: bool(f, "require_fullscreen"),
    block_copy: bool(f, "block_copy"),
    one_at_a_time: bool(f, "one_at_a_time"),
    lock_backtrack: bool(f, "lock_backtrack"),
    require_pledge: bool(f, "require_pledge"),
    require_lockdown: bool(f, "require_lockdown"),
    seb_extra_keys: str(f, "seb_extra_keys"),
    seb_quit_hash: f.get("seb_quit_clear") ? "" : quitPw ? hashQuitPassword(quitPw) : exam.seb_quit_hash,
  });
  revalidatePath(`/exams/${exam.id}/edit`);
  redirect(`/exams/${exam.id}/edit?saved=1`);
}

export async function setPublished(f: FormData) {
  const { exam } = await teacherExam(f);
  await update("exams", exam.id, { published: bool(f, "value") });
  revalidatePath(`/exams/${exam.id}/edit`);
}

export async function deleteExam(f: FormData) {
  const { exam } = await teacherExam(f);
  const atts = await where<Attempt>("attempts", ["exam_id", "==", exam.id]);
  for (const a of atts) {
    const resp = await where("responses", ["attempt_id", "==", a.id]);
    for (const r of resp) if (r.file_path) await deleteFile(r.file_path);
    await removeWhere("responses", ["attempt_id", "==", a.id]);
    await removeWhere("attempt_events", ["attempt_id", "==", a.id]);
    await remove("attempts", a.id);
  }
  for (const f of await filesWhere(["exam_id", "==", exam.id])) await deleteFile(f.id); // incl. unfinished uploads
  await removeWhere("exam_items", ["exam_id", "==", exam.id]);
  await removeWhere("exam_assignees", ["exam_id", "==", exam.id]);
  await remove("exams", exam.id);
  redirect(`/courses/${exam.course_id}`);
}

async function addItem(examId: string, item: { question_id?: string; bank_id?: string; draw_count?: number }) {
  const items = await examItems(examId);
  const pos = (items.length ? Math.max(...items.map((i) => i.position)) : 0) + 1;
  await insert("exam_items", {
    exam_id: examId,
    position: pos,
    question_id: item.question_id ?? null,
    bank_id: item.bank_id ?? null,
    draw_count: item.draw_count ?? null,
  });
}

export async function addExistingQuestions(f: FormData) {
  const { exam } = await teacherExam(f);
  const items = await examItems(exam.id);
  const qs = await getQuestions(f.getAll("question_id").map(String));
  for (const q of qs.values()) {
    if (q.course_id !== exam.course_id) continue;
    if (!items.some((i) => i.question_id === q.id)) await addItem(exam.id, { question_id: q.id });
  }
  revalidatePath(`/exams/${exam.id}/edit`);
}

export async function addRandomDraw(f: FormData) {
  const { exam } = await teacherExam(f);
  const bank = await getById("banks", str(f, "bank_id"));
  if (!bank || bank.course_id !== exam.course_id) return;
  await addItem(exam.id, { bank_id: bank.id, draw_count: Math.max(1, num(f, "draw_count") || 1) });
  revalidatePath(`/exams/${exam.id}/edit`);
}

export async function removeItem(f: FormData) {
  const { exam } = await teacherExam(f);
  const it = await getById("exam_items", str(f, "item_id"));
  if (it?.exam_id === exam.id) await remove("exam_items", it.id);
  revalidatePath(`/exams/${exam.id}/edit`);
}

export async function moveItem(f: FormData) {
  const { exam } = await teacherExam(f);
  const items = await examItems(exam.id);
  const idx = items.findIndex((i) => i.id === str(f, "item_id"));
  const to = idx + (str(f, "dir") === "up" ? -1 : 1);
  if (idx < 0 || to < 0 || to >= items.length) return;
  [items[idx], items[to]] = [items[to], items[idx]];
  const b = fdb().batch();
  items.forEach((it, i) => b.update(fdb().collection("exam_items").doc(it.id), { position: i + 1 }));
  await b.commit();
  revalidatePath(`/exams/${exam.id}/edit`);
}

export async function setAssignees(f: FormData) {
  const { exam } = await teacherExam(f);
  const assignAll = str(f, "assign_all") === "1" ? 1 : 0;
  await update("exams", exam.id, { assign_all: assignAll });
  await removeWhere("exam_assignees", ["exam_id", "==", exam.id]);
  if (!assignAll) {
    for (const u of f.getAll("user_id").map(String)) await insert("exam_assignees", { exam_id: exam.id, user_id: u }, `${exam.id}_${u}`);
  }
  revalidatePath(`/exams/${exam.id}/edit`);
}

// ---------- Taking an exam ----------

export async function beginAttempt(f: FormData) {
  const u = await requireUser();
  const exam = await getExam(str(f, "exam_id"));
  if (!exam) redirect("/dashboard");
  const av = await canStart(exam, u.id);
  if (!av.ok) redirect(`/exams/${exam.id}`);
  if (exam.require_lockdown && !(await hasLockdownPass(exam.id, u.id))) redirect(`/exams/${exam.id}?seb=required`);
  if (exam.require_pledge && !f.get("pledge")) redirect(`/exams/${exam.id}?pledge=required`);
  const id = await startAttempt(exam, u.id, await lockdownClient(exam.id, u.id));
  if (exam.require_pledge) await logEvent(id, "pledge", "Student affirmed the academic integrity statement");
  redirect(`/attempts/${id}`);
}

async function ownAttempt(attemptId: string) {
  const u = await requireUser();
  const a = await getAttempt(attemptId);
  if (!a || a.user_id !== u.id) throw new Error("Not your attempt");
  const exam = (await getExam(a.exam_id))!;
  if (exam.require_lockdown && !(await hasLockdownPass(exam.id, u.id))) throw new Error("Lockdown browser session required");
  return { u, a, exam };
}

/** Autosave of a single answer. Rejected after the deadline (plus a grace period for latency). */
export async function saveResponse(attemptId: string, qid: string, answer: any): Promise<{ ok: boolean; error?: string }> {
  const { a } = await ownAttempt(attemptId);
  if (a.status !== "in_progress") return { ok: false, error: "This attempt is already submitted." };
  if (pastDeadline(a, DEADLINE_GRACE_MS)) {
    await submitAttempt(a.id, "time");
    return { ok: false, error: "Time is up. Your attempt was submitted." };
  }
  const layout: LayoutEntry[] = JSON.parse(a.layout_json);
  if (!layout.some((l) => l.qid === qid)) return { ok: false, error: "Question not in this attempt." };
  await saveAnswer(a.id, qid, answer);
  return { ok: true };
}

/**
 * Uploads: the browser calls startUpload, then sends the file in ≤ 900 KB pieces with uploadChunk.
 * Files are stored in Firestore (see lib/files.ts) so the app stays on the free Spark plan, and each request
 * stays far under Vercel Hobby's 4.5 MB body limit.
 */
export async function startUpload(attemptId: string, qid: string, name: string, size: number): Promise<{ ok: boolean; error?: string; fileId?: string; chunkBytes?: number }> {
  const { a, exam } = await ownAttempt(attemptId);
  if (a.status !== "in_progress") return { ok: false, error: "This attempt is already submitted." };
  if (pastDeadline(a, DEADLINE_GRACE_MS)) return { ok: false, error: "Time is up." };
  const layout: LayoutEntry[] = JSON.parse(a.layout_json);
  if (!layout.some((l) => l.qid === qid)) return { ok: false, error: "Question not in this attempt." };
  const q = (await getQuestion(qid))!;
  if (q.type !== "file") return { ok: false, error: "This question doesn't take files." };
  if (!size) return { ok: false, error: "Choose a file first." };
  const maxMb = Math.min(MAX_FILE_MB, Number(q.answer?.maxMb) || DEFAULT_FILE_MB);
  if (size > maxMb * 1024 * 1024) return { ok: false, error: `File is larger than ${maxMb} MB. Try a PDF or a smaller photo.` };
  const accept = String(q.answer?.accept || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ext = path.extname(name).toLowerCase();
  if (accept.length && !accept.includes(ext)) return { ok: false, error: `Allowed file types: ${accept.join(", ")}` };
  const fileId = await beginFile({ owner_id: a.user_id, attempt_id: a.id, question_id: qid, course_id: exam.course_id, exam_id: exam.id, name: name.slice(0, 200), size, chunks: Math.ceil(size / CHUNK_BYTES) });
  return { ok: true, fileId, chunkBytes: CHUNK_BYTES };
}

export async function uploadChunk(f: FormData): Promise<{ ok: boolean; error?: string; done?: boolean; name?: string }> {
  const u = await requireUser();
  const meta = await getFileMeta(str(f, "file_id"));
  if (!meta || meta.owner_id !== u.id || meta.complete) return { ok: false, error: "Upload not found." };
  const { a } = await ownAttempt(meta.attempt_id);
  if (a.status !== "in_progress") return { ok: false, error: "This attempt is already submitted." };
  const index = Number(str(f, "index"));
  const blob = f.get("chunk") as File | null;
  if (!blob || !Number.isInteger(index) || index < 0 || index >= meta.chunks) return { ok: false, error: "Bad upload piece." };
  const done = await putChunk(meta.id, index, Buffer.from(await blob.arrayBuffer()));
  if (done) {
    const rid = respId(a.id, meta.question_id);
    const prev = await getById("responses", rid);
    await upsert("responses", rid, { attempt_id: a.id, question_id: meta.question_id, file_path: meta.id, file_name: meta.name });
    if (prev?.file_path && prev.file_path !== meta.id) await deleteFile(prev.file_path);
  }
  return { ok: true, done, name: meta.name };
}

const COUNTING = ["tab_hidden", "window_blur", "fullscreen_exit"];
const ALLOWED_EVENTS = ["tab_hidden", "window_blur", "fullscreen_exit", "copy_blocked", "paste_blocked", "context_menu", "devtools", "key_blocked", "print_blocked", "resume", "file_picker", "page_reload", "multi_tab"];

/**
 * Integrity events reported by the exam page (tab hidden, window blur, fullscreen exit, copy/paste attempt, devtools).
 * The server decides whether the focus-loss policy forces submission; the count is kept server-side.
 */
export async function reportIntegrityEvent(attemptId: string, type: string, detail: string): Promise<{ submitted: boolean; remaining: number }> {
  const { a, exam } = await ownAttempt(attemptId);
  if (a.status !== "in_progress") return { submitted: true, remaining: 0 };
  const t = ALLOWED_EVENTS.includes(type) ? type : "other";
  await logEvent(a.id, t, detail);
  if (!COUNTING.includes(t) || exam.focus_policy === "off") return { submitted: false, remaining: -1 };
  const ref = fdb().collection("attempts").doc(a.id);
  const losses = await fdb().runTransaction(async (tr) => {
    const n = ((await tr.get(ref)).data()?.focus_losses || 0) + 1;
    tr.update(ref, { focus_losses: n });
    return n;
  });
  if (exam.focus_policy === "submit" && losses > exam.focus_warnings) {
    await submitAttempt(a.id, "focus");
    return { submitted: true, remaining: 0 };
  }
  return { submitted: false, remaining: exam.focus_policy === "submit" ? exam.focus_warnings - losses + 1 : -1 };
}

export async function finishAttempt(attemptId: string, reason: "student" | "time") {
  const { a } = await ownAttempt(attemptId);
  if (a.status === "in_progress") await submitAttempt(a.id, reason);
  return { ok: true };
}

// ---------- Grading ----------

export async function gradeAttempt(f: FormData) {
  const attemptId = str(f, "attempt_id");
  const a = await getAttempt(attemptId);
  if (!a) redirect("/dashboard");
  await requireTeacher(a.course_id);
  if (a.status === "in_progress") await submitAttempt(a.id, "teacher");
  const layout: LayoutEntry[] = JSON.parse(a.layout_json);
  const qs = await getQuestions(layout.map((l) => l.qid));
  const b = fdb().batch();
  for (const { qid } of layout) {
    const q = qs.get(qid);
    if (!q) continue;
    const raw = str(f, `points_${qid}`);
    const pts = raw === "" ? null : Math.min(q.points, Math.max(0, Number(raw)));
    b.set(
      fdb().collection("responses").doc(respId(a.id, qid)),
      { attempt_id: a.id, question_id: qid, points_awarded: pts, feedback: str(f, `feedback_${qid}`) },
      { merge: true }
    );
  }
  b.update(fdb().collection("attempts").doc(a.id), { overall_feedback: str(f, "overall_feedback") });
  await b.commit();
  await recomputeScore(a.id);
  const next = str(f, "next");
  redirect(next.startsWith("/attempts/") ? next : `/attempts/${a.id}/grade?saved=1`);
}

/** Lets a teacher re-open an attempt that was force-submitted (e.g. a false-positive focus loss). */
export async function reopenAttempt(f: FormData) {
  const a = await getAttempt(str(f, "attempt_id"));
  if (!a) redirect("/dashboard");
  const me = await requireTeacher(a.course_id);
  const exam = (await getExam(a.exam_id))!;
  const extra = Math.max(1, num(f, "extra_minutes") || 10);
  const deadline = exam.time_limit_min || exam.lock_at ? new Date(Date.now() + extra * 60000).toISOString() : null;
  await update("attempts", a.id, { status: "in_progress", submitted_at: null, submit_reason: null, score: null, deadline_at: deadline, focus_losses: 0 });
  await logEvent(a.id, "reopened", `Reopened by ${me.name}${deadline ? ` with ${extra} more minutes` : ""}`);
  redirect(`/attempts/${a.id}/grade`);
}

/** Deletes uploaded files from this exam's graded attempts. Grades and feedback stay. */
export async function purgeExamFiles(f: FormData) {
  const { exam } = await teacherExam(f);
  const graded = new Set((await where("attempts", ["exam_id", "==", exam.id], ["status", "==", "graded"])).map((a: any) => a.id));
  const files = (await filesWhere(["exam_id", "==", exam.id])).filter((x) => graded.has(x.attempt_id));
  const r = await purgeFiles(files);
  revalidatePath(`/exams/${exam.id}/submissions`);
  redirect(`/exams/${exam.id}/submissions?purged=${r.count}`);
}

/** End of term: deletes every uploaded file in the course. Grades and feedback stay. */
export async function purgeCourseFiles(f: FormData) {
  const courseId = str(f, "course_id");
  await requireTeacher(courseId);
  if (str(f, "confirm").trim().toUpperCase() !== "DELETE") redirect(`/courses/${courseId}?purge=confirm`);
  const r = await purgeFiles(await filesWhere(["course_id", "==", courseId]));
  revalidatePath(`/courses/${courseId}`);
  redirect(`/courses/${courseId}?purged=${r.count}`);
}

export async function ensureCourseAccess(courseId: string) {
  const u = await requireUser();
  const role = await courseRole(courseId, u.id);
  if (!role) redirect("/dashboard");
  return { u, role };
}
