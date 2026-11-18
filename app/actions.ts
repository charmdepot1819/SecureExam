"use server";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all, get, run, tx, UPLOAD_DIR } from "@/lib/db";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
  requireUser,
  requireEducator,
  requireTeacher,
  setMode,
  courseRole,
} from "@/lib/auth";
import {
  canStart,
  getExam,
  getQuestion,
  logEvent,
  newOptionId,
  pastDeadline,
  DEADLINE_GRACE_MS,
  recomputeScore,
  saveAnswer,
  startAttempt,
  submitAttempt,
  type LayoutEntry,
  type QType,
} from "@/lib/exam";
import { hasLockdownPass, lockdownClient } from "@/lib/seb-access";
import { hashQuitPassword } from "@/lib/seb";

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

export async function register(_: any, f: FormData) {
  const name = str(f, "name");
  const email = str(f, "email").toLowerCase();
  const password = String(f.get("password") || "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter your name and a valid email." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (get("SELECT 1 FROM users WHERE email = ?", email)) return { error: "An account with that email already exists." };
  // The very first account becomes an educator so a fresh install can be set up.
  const first = !get("SELECT 1 FROM users LIMIT 1");
  const { id } = run(
    "INSERT INTO users (name, email, password_hash, is_educator) VALUES (?, ?, ?, ?)",
    name,
    email,
    hashPassword(password),
    first ? 1 : 0
  );
  await createSession(id);
  redirect(safeNext(str(f, "next")));
}

export async function login(_: any, f: FormData) {
  const email = str(f, "email").toLowerCase();
  const password = String(f.get("password") || "");
  const u = get("SELECT * FROM users WHERE email = ?", email);
  if (!u || !verifyPassword(password, u.password_hash)) return { error: "Email or password is incorrect." };
  await createSession(u.id);
  redirect(safeNext(str(f, "next")));
}

function safeNext(n: string) {
  return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function toggleMode(f: FormData) {
  await requireEducator();
  await setMode(str(f, "mode") === "student" ? "student" : "educator");
  redirect("/dashboard");
}

export async function setEducator(f: FormData) {
  const me = await requireEducator();
  const uid = Number(str(f, "user_id"));
  if (uid === me.id) return;
  run("UPDATE users SET is_educator = ? WHERE id = ?", bool(f, "value"), uid);
  revalidatePath("/admin/users");
}

// ---------- Courses & people ----------

export async function createCourse(f: FormData) {
  const u = await requireEducator();
  const title = str(f, "title");
  if (!title) return;
  const id = tx(() => {
    const { id } = run("INSERT INTO courses (title, code, description, owner_id) VALUES (?, ?, ?, ?)", title, str(f, "code"), str(f, "description"), u.id);
    run("INSERT INTO enrollments (course_id, user_id, role) VALUES (?, ?, 'teacher')", id, u.id);
    run("INSERT INTO banks (course_id, title) VALUES (?, 'General')", id);
    return id;
  });
  redirect(`/courses/${id}`);
}

/** Tags users as students (or co-teachers) in a course. Accepts checkbox ids and/or a list of emails. */
export async function tagUsers(f: FormData) {
  const courseId = Number(str(f, "course_id"));
  await requireTeacher(courseId);
  const role = str(f, "role") === "teacher" ? "teacher" : "student";
  const ids = f.getAll("user_id").map(Number);
  const emails = str(f, "emails").split(/[\s,;]+/).filter(Boolean);
  for (const e of emails) {
    const u = get("SELECT id FROM users WHERE email = ?", e.toLowerCase());
    if (u) ids.push(u.id);
  }
  for (const id of ids) {
    run(
      `INSERT INTO enrollments (course_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(course_id, user_id) DO UPDATE SET role = excluded.role`,
      courseId,
      id,
      role
    );
  }
  revalidatePath(`/courses/${courseId}/people`);
}

export async function untagUser(f: FormData) {
  const courseId = Number(str(f, "course_id"));
  const me = await requireTeacher(courseId);
  const uid = Number(str(f, "user_id"));
  if (uid === me.id) return;
  run("DELETE FROM enrollments WHERE course_id = ? AND user_id = ?", courseId, uid);
  revalidatePath(`/courses/${courseId}/people`);
}

// ---------- Question banks & questions ----------

export async function createBank(f: FormData) {
  const courseId = Number(str(f, "course_id"));
  await requireTeacher(courseId);
  const title = str(f, "title");
  if (title) run("INSERT INTO banks (course_id, title) VALUES (?, ?)", courseId, title);
  revalidatePath(`/courses/${courseId}/bank`);
}

/**
 * Saves a question from the QuestionEditor client component, which posts a JSON payload.
 * If exam_id is given, the new question is also appended to that exam.
 */
export async function saveQuestion(f: FormData) {
  const courseId = Number(str(f, "course_id"));
  await requireTeacher(courseId);
  const data = JSON.parse(String(f.get("payload")));
  const type = data.type as QType;
  if (!["mc", "multi", "tf", "short", "essay", "file"].includes(type)) throw new Error("Bad type");
  let options: { id: string; text: string }[] = [];
  let answer: any = {};
  if (type === "mc" || type === "multi") {
    options = (data.options || [])
      .filter((o: any) => String(o.text || "").trim())
      .map((o: any) => ({ id: o.id || newOptionId(), text: String(o.text).trim(), correct: !!o.correct }));
    const correct = options.filter((o: any) => o.correct).map((o) => o.id);
    answer = type === "mc" ? { correct: correct[0] ?? null } : { correct };
    options = options.map(({ id, text }) => ({ id, text }));
  } else if (type === "tf") {
    options = [
      { id: "true", text: "True" },
      { id: "false", text: "False" },
    ];
    answer = { correct: data.tf === "false" ? "false" : "true" };
  } else if (type === "short") {
    answer = { accepted: String(data.accepted || "").split("\n").map((s: string) => s.trim()).filter(Boolean) };
  } else if (type === "file") {
    answer = { accept: String(data.accept || "").trim(), maxMb: Number(data.maxMb) || 20 };
  }
  const bankId = data.bank_id ? Number(data.bank_id) : null;
  const points = Math.max(0, Number(data.points) || 1);
  let qid = Number(data.id) || 0;
  if (qid) {
    const q = getQuestion(qid);
    if (!q || q.course_id !== courseId) throw new Error("Not found");
    run(
      "UPDATE questions SET type=?, prompt=?, options_json=?, answer_json=?, points=?, feedback=?, bank_id=? WHERE id=?",
      type,
      String(data.prompt || ""),
      JSON.stringify(options),
      JSON.stringify(answer),
      points,
      String(data.feedback || ""),
      bankId,
      qid
    );
  } else {
    qid = run(
      "INSERT INTO questions (course_id, bank_id, type, prompt, options_json, answer_json, points, feedback) VALUES (?,?,?,?,?,?,?,?)",
      courseId,
      bankId,
      type,
      String(data.prompt || ""),
      JSON.stringify(options),
      JSON.stringify(answer),
      points,
      String(data.feedback || "")
    ).id;
    const examId = Number(str(f, "exam_id"));
    if (examId) addItem(examId, { question_id: qid });
  }
  const back = str(f, "back");
  redirect(back || `/courses/${courseId}/bank`);
}

export async function deleteQuestion(f: FormData) {
  const courseId = Number(str(f, "course_id"));
  await requireTeacher(courseId);
  run("DELETE FROM questions WHERE id = ? AND course_id = ?", Number(str(f, "question_id")), courseId);
  revalidatePath(`/courses/${courseId}/bank`);
}

// ---------- Exams ----------

export async function createExam(f: FormData) {
  const courseId = Number(str(f, "course_id"));
  await requireTeacher(courseId);
  const kind = ["quiz", "exam", "assignment"].includes(str(f, "kind")) ? str(f, "kind") : "quiz";
  const { id } = run(
    "INSERT INTO exams (course_id, title, kind, focus_policy, require_fullscreen, block_copy) VALUES (?, ?, ?, ?, ?, ?)",
    courseId,
    str(f, "title") || "Untitled",
    kind,
    kind === "assignment" ? "off" : "submit",
    kind === "assignment" ? 0 : 1,
    kind === "assignment" ? 0 : 1
  );
  redirect(`/exams/${id}/edit`);
}

export async function updateExamSettings(f: FormData) {
  const examId = Number(str(f, "exam_id"));
  const exam = getExam(examId)!;
  await requireTeacher(exam.course_id);
  const fp = str(f, "focus_policy");
  const fm = str(f, "feedback_mode");
  const quitPw = String(f.get("seb_quit_password") || "");
  run(
    `UPDATE exams SET title=?, instructions=?, kind=?, time_limit_min=?, available_from=?, due_at=?, lock_at=?, allow_late=?,
      max_attempts=?, shuffle_questions=?, shuffle_options=?, feedback_mode=?, show_correct=?, focus_policy=?, focus_warnings=?,
      require_fullscreen=?, block_copy=?, one_at_a_time=?, lock_backtrack=?, require_pledge=?, require_lockdown=?, seb_extra_keys=?,
      seb_quit_hash=?
     WHERE id=?`,
    str(f, "title") || "Untitled",
    str(f, "instructions"),
    ["quiz", "exam", "assignment"].includes(str(f, "kind")) ? str(f, "kind") : "quiz",
    num(f, "time_limit_min") || null,
    dt(f, "available_from"),
    dt(f, "due_at"),
    dt(f, "lock_at"),
    bool(f, "allow_late"),
    Math.max(0, num(f, "max_attempts") ?? 1),
    bool(f, "shuffle_questions"),
    bool(f, "shuffle_options"),
    ["immediate", "after_due", "never"].includes(fm) ? fm : "after_due",
    bool(f, "show_correct"),
    ["off", "log", "submit"].includes(fp) ? fp : "submit",
    Math.max(0, num(f, "focus_warnings") ?? 0),
    bool(f, "require_fullscreen"),
    bool(f, "block_copy"),
    bool(f, "one_at_a_time"),
    bool(f, "lock_backtrack"),
    bool(f, "require_pledge"),
    bool(f, "require_lockdown"),
    str(f, "seb_extra_keys"),
    f.get("seb_quit_clear") ? "" : quitPw ? hashQuitPassword(quitPw) : exam.seb_quit_hash,
    examId
  );
  revalidatePath(`/exams/${examId}/edit`);
  redirect(`/exams/${examId}/edit?saved=1`);
}

export async function setPublished(f: FormData) {
  const examId = Number(str(f, "exam_id"));
  const exam = getExam(examId)!;
  await requireTeacher(exam.course_id);
  run("UPDATE exams SET published = ? WHERE id = ?", bool(f, "value"), examId);
  revalidatePath(`/exams/${examId}/edit`);
}

export async function deleteExam(f: FormData) {
  const examId = Number(str(f, "exam_id"));
  const exam = getExam(examId)!;
  await requireTeacher(exam.course_id);
  run("DELETE FROM exams WHERE id = ?", examId);
  redirect(`/courses/${exam.course_id}`);
}

function addItem(examId: number, item: { question_id?: number; bank_id?: number; draw_count?: number }) {
  const pos = (get<{ m: number }>("SELECT COALESCE(MAX(position), 0) AS m FROM exam_items WHERE exam_id = ?", examId)?.m || 0) + 1;
  run(
    "INSERT INTO exam_items (exam_id, position, question_id, bank_id, draw_count) VALUES (?, ?, ?, ?, ?)",
    examId,
    pos,
    item.question_id ?? null,
    item.bank_id ?? null,
    item.draw_count ?? null
  );
}

export async function addExistingQuestions(f: FormData) {
  const examId = Number(str(f, "exam_id"));
  const exam = getExam(examId)!;
  await requireTeacher(exam.course_id);
  for (const q of f.getAll("question_id").map(Number)) {
    const already = get("SELECT 1 FROM exam_items WHERE exam_id = ? AND question_id = ?", examId, q);
    if (!already) addItem(examId, { question_id: q });
  }
  revalidatePath(`/exams/${examId}/edit`);
}

export async function addRandomDraw(f: FormData) {
  const examId = Number(str(f, "exam_id"));
  const exam = getExam(examId)!;
  await requireTeacher(exam.course_id);
  const bankId = Number(str(f, "bank_id"));
  const n = Math.max(1, num(f, "draw_count") || 1);
  addItem(examId, { bank_id: bankId, draw_count: n });
  revalidatePath(`/exams/${examId}/edit`);
}

export async function removeItem(f: FormData) {
  const examId = Number(str(f, "exam_id"));
  const exam = getExam(examId)!;
  await requireTeacher(exam.course_id);
  run("DELETE FROM exam_items WHERE id = ? AND exam_id = ?", Number(str(f, "item_id")), examId);
  revalidatePath(`/exams/${examId}/edit`);
}

export async function moveItem(f: FormData) {
  const examId = Number(str(f, "exam_id"));
  const exam = getExam(examId)!;
  await requireTeacher(exam.course_id);
  const items = all<{ id: number }>("SELECT id FROM exam_items WHERE exam_id = ? ORDER BY position", examId);
  const idx = items.findIndex((i) => i.id === Number(str(f, "item_id")));
  const to = idx + (str(f, "dir") === "up" ? -1 : 1);
  if (idx < 0 || to < 0 || to >= items.length) return;
  [items[idx], items[to]] = [items[to], items[idx]];
  tx(() => items.forEach((it, i) => run("UPDATE exam_items SET position = ? WHERE id = ?", i + 1, it.id)));
  revalidatePath(`/exams/${examId}/edit`);
}

export async function setAssignees(f: FormData) {
  const examId = Number(str(f, "exam_id"));
  const exam = getExam(examId)!;
  await requireTeacher(exam.course_id);
  const assignAll = str(f, "assign_all") === "1" ? 1 : 0;
  tx(() => {
    run("UPDATE exams SET assign_all = ? WHERE id = ?", assignAll, examId);
    run("DELETE FROM exam_assignees WHERE exam_id = ?", examId);
    if (!assignAll) for (const u of f.getAll("user_id").map(Number)) run("INSERT INTO exam_assignees (exam_id, user_id) VALUES (?, ?)", examId, u);
  });
  revalidatePath(`/exams/${examId}/edit`);
}

// ---------- Taking an exam ----------

export async function beginAttempt(f: FormData) {
  const u = await requireUser();
  const exam = getExam(Number(str(f, "exam_id")));
  if (!exam) redirect("/dashboard");
  const av = canStart(exam, u.id);
  if (!av.ok) redirect(`/exams/${exam.id}`);
  if (exam.require_lockdown && !(await hasLockdownPass(exam.id, u.id))) redirect(`/exams/${exam.id}?seb=required`);
  if (exam.require_pledge && !f.get("pledge")) redirect(`/exams/${exam.id}?pledge=required`);
  const id = startAttempt(exam, u.id);
  const client = await lockdownClient(exam.id, u.id);
  run("UPDATE attempts SET client = ? WHERE id = ?", client, id);
  if (exam.require_pledge) logEvent(id, "pledge", "Student affirmed the academic integrity statement");
  redirect(`/attempts/${id}`);
}

async function ownAttempt(attemptId: number) {
  const u = await requireUser();
  const a = get("SELECT * FROM attempts WHERE id = ?", attemptId);
  if (!a || a.user_id !== u.id) throw new Error("Not your attempt");
  const exam = getExam(a.exam_id)!;
  if (exam.require_lockdown && !(await hasLockdownPass(exam.id, u.id))) throw new Error("Lockdown browser session required");
  return { u, a, exam };
}

/** Autosave of a single answer. Rejected after the deadline (plus a grace period for latency). */
export async function saveResponse(attemptId: number, qid: number, answer: any): Promise<{ ok: boolean; error?: string }> {
  const { a } = await ownAttempt(attemptId);
  if (a.status !== "in_progress") return { ok: false, error: "This attempt is already submitted." };
  if (pastDeadline(a, DEADLINE_GRACE_MS)) {
    submitAttempt(a.id, "time");
    return { ok: false, error: "Time is up. Your attempt was submitted." };
  }
  const layout: LayoutEntry[] = JSON.parse(a.layout_json);
  if (!layout.some((l) => l.qid === qid)) return { ok: false, error: "Question not in this attempt." };
  saveAnswer(a.id, qid, answer);
  return { ok: true };
}

export async function uploadResponseFile(f: FormData): Promise<{ ok: boolean; error?: string; name?: string }> {
  const attemptId = Number(str(f, "attempt_id"));
  const qid = Number(str(f, "question_id"));
  const { a } = await ownAttempt(attemptId);
  if (a.status !== "in_progress") return { ok: false, error: "This attempt is already submitted." };
  if (pastDeadline(a, DEADLINE_GRACE_MS)) return { ok: false, error: "Time is up." };
  const layout: LayoutEntry[] = JSON.parse(a.layout_json);
  if (!layout.some((l) => l.qid === qid)) return { ok: false, error: "Question not in this attempt." };
  const q = getQuestion(qid)!;
  const file = f.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "Choose a file first." };
  const maxMb = Number(q.answer?.maxMb) || 20;
  if (file.size > maxMb * 1024 * 1024) return { ok: false, error: `File is larger than ${maxMb} MB.` };
  const accept = String(q.answer?.accept || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ext = path.extname(file.name).toLowerCase();
  if (accept.length && !accept.includes(ext)) return { ok: false, error: `Allowed file types: ${accept.join(", ")}` };
  const stored = `${a.id}-${qid}-${crypto.randomBytes(6).toString("hex")}${ext.replace(/[^.a-z0-9]/g, "")}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));
  const prev = get("SELECT file_path FROM responses WHERE attempt_id = ? AND question_id = ?", a.id, qid);
  run(
    `INSERT INTO responses (attempt_id, question_id, file_path, file_name) VALUES (?, ?, ?, ?)
     ON CONFLICT(attempt_id, question_id) DO UPDATE SET file_path = excluded.file_path, file_name = excluded.file_name`,
    a.id,
    qid,
    stored,
    file.name.slice(0, 200)
  );
  if (prev?.file_path) fs.rm(path.join(UPLOAD_DIR, prev.file_path), () => {});
  return { ok: true, name: file.name };
}

/**
 * Integrity events reported by the exam page (tab hidden, window blur, fullscreen exit, copy/paste attempt, devtools).
 * Server decides whether the focus-loss policy forces submission.
 */
export async function reportIntegrityEvent(attemptId: number, type: string, detail: string): Promise<{ submitted: boolean; remaining: number }> {
  const { a, exam } = await ownAttempt(attemptId);
  if (a.status !== "in_progress") return { submitted: true, remaining: 0 };
  const allowed = ["tab_hidden", "window_blur", "fullscreen_exit", "copy_blocked", "paste_blocked", "context_menu", "devtools", "key_blocked", "print_blocked", "resume", "file_picker", "page_reload", "multi_tab"];
  const t = allowed.includes(type) ? type : "other";
  logEvent(a.id, t, detail);
  const counts = ["tab_hidden", "window_blur", "fullscreen_exit"].includes(t);
  if (!counts || exam.focus_policy === "off") return { submitted: false, remaining: -1 };
  run("UPDATE attempts SET focus_losses = focus_losses + 1 WHERE id = ?", a.id);
  const losses = (a.focus_losses || 0) + 1;
  if (exam.focus_policy === "submit" && losses > exam.focus_warnings) {
    submitAttempt(a.id, "focus");
    return { submitted: true, remaining: 0 };
  }
  return { submitted: false, remaining: exam.focus_policy === "submit" ? exam.focus_warnings - losses + 1 : -1 };
}

export async function finishAttempt(attemptId: number, reason: "student" | "time") {
  const { a } = await ownAttempt(attemptId);
  if (a.status === "in_progress") submitAttempt(a.id, reason);
  return { ok: true };
}

// ---------- Grading ----------

export async function gradeAttempt(f: FormData) {
  const attemptId = Number(str(f, "attempt_id"));
  const a = get("SELECT * FROM attempts WHERE id = ?", attemptId);
  const exam = getExam(a.exam_id)!;
  await requireTeacher(exam.course_id);
  if (a.status === "in_progress") submitAttempt(a.id, "teacher");
  const layout: LayoutEntry[] = JSON.parse(a.layout_json);
  tx(() => {
    for (const { qid } of layout) {
      const q = getQuestion(qid);
      if (!q) continue;
      const raw = str(f, `points_${qid}`);
      const fb = str(f, `feedback_${qid}`);
      const pts = raw === "" ? null : Math.min(q.points, Math.max(0, Number(raw)));
      run(
        `INSERT INTO responses (attempt_id, question_id, points_awarded, feedback) VALUES (?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET points_awarded = excluded.points_awarded, feedback = excluded.feedback`,
        a.id,
        qid,
        pts,
        fb
      );
    }
    run("UPDATE attempts SET overall_feedback = ? WHERE id = ?", str(f, "overall_feedback"), a.id);
  });
  recomputeScore(a.id);
  const next = str(f, "next");
  redirect(next || `/attempts/${a.id}/grade?saved=1`);
}

/** Lets a teacher re-open an attempt that was force-submitted (e.g. a false-positive focus loss). */
export async function reopenAttempt(f: FormData) {
  const attemptId = Number(str(f, "attempt_id"));
  const a = get("SELECT * FROM attempts WHERE id = ?", attemptId);
  const exam = getExam(a.exam_id)!;
  const me = await requireTeacher(exam.course_id);
  const extra = Math.max(1, num(f, "extra_minutes") || 10);
  const deadline = exam.time_limit_min || exam.lock_at ? new Date(Date.now() + extra * 60000).toISOString() : null;
  run(
    "UPDATE attempts SET status = 'in_progress', submitted_at = NULL, submit_reason = NULL, score = NULL, deadline_at = ?, focus_losses = 0 WHERE id = ?",
    deadline,
    a.id
  );
  logEvent(a.id, "reopened", `Reopened by ${me.name}${deadline ? ` with ${extra} more minutes` : ""}`);
  redirect(`/attempts/${a.id}/grade`);
}

export async function ensureCourseAccess(courseId: number) {
  const u = await requireUser();
  const role = courseRole(courseId, u.id);
  if (!role) redirect("/dashboard");
  return { u, role };
}
