import crypto from "node:crypto";
import { fdb, getById, where, first, insert, update, upsert, nowIso, FieldValue } from "./db";

export type QType = "mc" | "multi" | "tf" | "short" | "essay" | "file";
export const QTYPE_LABEL: Record<QType, string> = {
  mc: "Multiple choice",
  multi: "Multiple answers",
  tf: "True / False",
  short: "Short answer (auto-graded)",
  essay: "Essay (manually graded)",
  file: "File upload (manually graded)",
};
export const AUTO_TYPES: QType[] = ["mc", "multi", "tf", "short"];

export type Option = { id: string; text: string };
export type Question = {
  id: string;
  course_id: string;
  bank_id: string | null;
  type: QType;
  prompt: string;
  options: Option[];
  answer: any;
  points: number;
  feedback: string;
  created_at?: string;
};

export type Exam = {
  id: string;
  course_id: string;
  title: string;
  instructions: string;
  kind: "quiz" | "exam" | "assignment";
  time_limit_min: number | null;
  available_from: string | null;
  due_at: string | null;
  lock_at: string | null;
  allow_late: number;
  max_attempts: number;
  shuffle_questions: number;
  shuffle_options: number;
  feedback_mode: "immediate" | "after_due" | "never";
  show_correct: number;
  focus_policy: "off" | "log" | "submit";
  focus_warnings: number;
  require_fullscreen: number;
  block_copy: number;
  one_at_a_time: number;
  lock_backtrack: number;
  require_pledge: number;
  require_lockdown: number;
  seb_quit_hash: string;
  seb_extra_keys: string;
  published: number;
  assign_all: number;
  created_at?: string;
};

/** Defaults for a new assessment (what the SQL schema used to provide). */
export const EXAM_DEFAULTS: Omit<Exam, "id" | "course_id" | "title"> = {
  instructions: "",
  kind: "quiz",
  time_limit_min: null,
  available_from: null,
  due_at: null,
  lock_at: null,
  allow_late: 0,
  max_attempts: 1,
  shuffle_questions: 1,
  shuffle_options: 1,
  feedback_mode: "after_due",
  show_correct: 1,
  focus_policy: "submit",
  focus_warnings: 0,
  require_fullscreen: 1,
  block_copy: 1,
  one_at_a_time: 0,
  lock_backtrack: 0,
  require_pledge: 1,
  require_lockdown: 0,
  seb_quit_hash: "",
  seb_extra_keys: "",
  published: 0,
  assign_all: 1,
};

export type LayoutEntry = { qid: string; opts: string[] };

export type Attempt = {
  id: string;
  exam_id: string;
  course_id: string;
  user_id: string;
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
  submit_reason: string | null;
  status: "in_progress" | "submitted" | "graded";
  score: number | null;
  max_score: number | null;
  late: number;
  layout_json: string;
  client: string;
  focus_losses: number;
  overall_feedback: string;
};

export type Response = {
  id: string;
  attempt_id: string;
  question_id: string;
  answer_json: string | null;
  file_path: string | null;
  file_name: string | null;
  file_purged?: number;
  auto_correct: number | null;
  points_awarded: number | null;
  needs_grading: number;
  feedback: string;
};

export const respId = (attemptId: string, qid: string) => `${attemptId}_${qid}`;

export function rowToQuestion(r: any): Question {
  return { ...r, options: r.options || [], answer: r.answer || {} };
}

export async function getQuestion(id: string): Promise<Question | undefined> {
  const r = await getById("questions", id);
  return r ? rowToQuestion(r) : undefined;
}

/** Loads several questions in one round trip. */
export async function getQuestions(ids: string[]): Promise<Map<string, Question>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, Question>();
  if (!uniq.length) return out;
  const snaps = await fdb().getAll(...uniq.map((id) => fdb().collection("questions").doc(id)));
  for (const s of snaps) if (s.exists) out.set(s.id, rowToQuestion({ id: s.id, ...s.data() }));
  return out;
}

export async function getExam(id: string): Promise<Exam | undefined> {
  return getById<Exam>("exams", id);
}

export async function getAttempt(id: string): Promise<Attempt | undefined> {
  return getById<Attempt>("attempts", id);
}

export async function examItems(examId: string) {
  const items = await where<{ id: string; position: number; question_id: string | null; bank_id: string | null; draw_count: number | null }>(
    "exam_items",
    ["exam_id", "==", examId]
  );
  return items.sort((a, b) => a.position - b.position);
}

/** Fisher–Yates shuffle using a cryptographic RNG (unbiased). */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function normalizeText(s: string): string {
  return (s || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
}

/** Returns {correct, points} for auto-gradable types; null for manually graded types. */
export function autoGrade(q: Question, answer: any): { correct: boolean; points: number } | null {
  if (!AUTO_TYPES.includes(q.type)) return null;
  if (q.type === "mc" || q.type === "tf") {
    const ok = answer?.choice != null && answer.choice === q.answer?.correct;
    return { correct: ok, points: ok ? q.points : 0 };
  }
  if (q.type === "multi") {
    const key: string[] = q.answer?.correct || [];
    const chosen: string[] = answer?.choices || [];
    if (!key.length) return { correct: false, points: 0 };
    // Partial credit: (right selections − wrong selections) / number of keyed answers, floored at 0.
    const right = chosen.filter((c) => key.includes(c)).length;
    const wrong = chosen.filter((c) => !key.includes(c)).length;
    const frac = Math.max(0, (right - wrong) / key.length);
    return { correct: frac === 1, points: Math.round(frac * q.points * 100) / 100 };
  }
  const accepted: string[] = (q.answer?.accepted || []).map(normalizeText);
  const ok = accepted.includes(normalizeText(answer?.text || ""));
  return { correct: ok, points: ok ? q.points : 0 };
}

export async function isAssigned(exam: Exam, userId: string): Promise<boolean> {
  const enr = await getById("enrollments", `${exam.course_id}_${userId}`);
  if (!enr || enr.role !== "student") return false;
  if (exam.assign_all) return true;
  return !!(await getById("exam_assignees", `${exam.id}_${userId}`));
}

export async function examQuestionCount(examId: string): Promise<number> {
  const rows = await examItems(examId);
  return rows.reduce((n, r) => n + (r.question_id ? 1 : r.draw_count || 0), 0);
}

/** Builds the per-attempt question layout: fixed items + random draws from banks, then shuffles. */
export async function buildLayout(exam: Exam): Promise<LayoutEntry[]> {
  const items = await examItems(exam.id);
  const chosen: string[] = [];
  for (const it of items) {
    if (it.question_id) {
      if (!chosen.includes(it.question_id)) chosen.push(it.question_id);
    } else if (it.bank_id) {
      const pool = (await where<{ id: string }>("questions", ["bank_id", "==", it.bank_id])).map((r) => r.id).filter((id) => !chosen.includes(id));
      chosen.push(...shuffle(pool).slice(0, it.draw_count || 1));
    }
  }
  const qs = await getQuestions(chosen);
  const present = chosen.filter((id) => qs.has(id));
  const ordered = exam.shuffle_questions ? shuffle(present) : present;
  return ordered.map((qid) => {
    const q = qs.get(qid)!;
    const ids = q.options.map((o) => o.id);
    const opts = exam.shuffle_options && (q.type === "mc" || q.type === "multi") ? shuffle(ids) : ids;
    return { qid, opts };
  });
}

export async function attemptsFor(examId: string, userId: string): Promise<Attempt[]> {
  const rows = await where<Attempt>("attempts", ["exam_id", "==", examId], ["user_id", "==", userId]);
  return rows.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

export type Availability = { ok: boolean; reason?: string; late?: boolean };

export async function canStart(exam: Exam, userId: string): Promise<Availability> {
  const now = new Date();
  if (!exam.published) return { ok: false, reason: "This assessment is not published yet." };
  if (!(await isAssigned(exam, userId))) return { ok: false, reason: "This assessment is not assigned to you." };
  if (exam.available_from && new Date(exam.available_from) > now) return { ok: false, reason: "Not open yet." };
  if (exam.lock_at && new Date(exam.lock_at) < now) return { ok: false, reason: "This assessment is closed." };
  const late = !!exam.due_at && new Date(exam.due_at) < now;
  if (late && !exam.allow_late) return { ok: false, reason: "The due date has passed." };
  const atts = await attemptsFor(exam.id, userId);
  if (atts.some((a) => a.status === "in_progress")) return { ok: true, late };
  if (exam.max_attempts > 0 && atts.length >= exam.max_attempts) return { ok: false, reason: "You have used all your attempts." };
  if ((await examQuestionCount(exam.id)) === 0) return { ok: false, reason: "This assessment has no questions yet." };
  return { ok: true, late };
}

export async function startAttempt(exam: Exam, userId: string, client = "browser"): Promise<string> {
  const existing = await first<Attempt>("attempts", ["exam_id", "==", exam.id], ["user_id", "==", userId], ["status", "==", "in_progress"]);
  if (existing) return existing.id;
  const start = new Date();
  let deadline: Date | null = exam.time_limit_min ? new Date(start.getTime() + exam.time_limit_min * 60000) : null;
  if (exam.lock_at) {
    const lock = new Date(exam.lock_at);
    if (!deadline || lock < deadline) deadline = lock;
  }
  const layout = await buildLayout(exam);
  const qs = await getQuestions(layout.map((l) => l.qid));
  const max = layout.reduce((s, l) => s + (qs.get(l.qid)?.points || 0), 0);
  const id = await insert("attempts", {
    exam_id: exam.id,
    course_id: exam.course_id,
    user_id: userId,
    started_at: start.toISOString(),
    deadline_at: deadline ? deadline.toISOString() : null,
    submitted_at: null,
    submit_reason: null,
    status: "in_progress",
    score: null,
    max_score: max,
    late: exam.due_at && new Date(exam.due_at) < start ? 1 : 0,
    layout_json: JSON.stringify(layout),
    client,
    focus_losses: 0,
    flag_count: 0,
    overall_feedback: "",
  });
  await logEvent(id, "start", "");
  return id;
}

/** Routine events that are not shown as integrity flags. */
export const QUIET_EVENTS = ["start", "submit", "resume", "pledge"];

export async function logEvent(attemptId: string, type: string, detail: string) {
  await insert("attempt_events", { attempt_id: attemptId, type, detail: detail.slice(0, 500), at: nowIso() });
  // Keep a running flag count on the attempt so the submissions list needn't read every event.
  if (!QUIET_EVENTS.includes(type)) await fdb().collection("attempts").doc(attemptId).update({ flag_count: FieldValue.increment(1) });
}

export async function attemptEvents(attemptId: string) {
  const rows = await where("attempt_events", ["attempt_id", "==", attemptId]);
  return rows.sort((a: any, b: any) => a.at.localeCompare(b.at));
}

/** Grace period for network latency after the deadline, in ms. */
export const DEADLINE_GRACE_MS = 30_000;

export function pastDeadline(attempt: { deadline_at: string | null }, graceMs = 0): boolean {
  return !!attempt.deadline_at && Date.now() > new Date(attempt.deadline_at).getTime() + graceMs;
}

export async function responsesFor(attemptId: string): Promise<Response[]> {
  return where<Response>("responses", ["attempt_id", "==", attemptId]);
}

export async function saveAnswer(attemptId: string, qid: string, answer: any) {
  await upsert("responses", respId(attemptId, qid), {
    attempt_id: attemptId,
    question_id: qid,
    answer_json: JSON.stringify(answer),
  });
}

export async function recomputeScore(attemptId: string) {
  const a = await getAttempt(attemptId);
  if (!a || a.status === "in_progress") return;
  const resp = await responsesFor(attemptId);
  const pending = resp.some((r) => r.needs_grading && r.points_awarded == null);
  const score = resp.reduce((s, r) => s + (r.points_awarded || 0), 0);
  await update("attempts", attemptId, { score, status: pending ? "submitted" : "graded" });
}

/**
 * Finalizes an attempt: auto-grades objective items, flags the rest for manual grading.
 * A transaction makes it safe if the timer, a focus loss and the student's Submit arrive at the same time.
 */
export async function submitAttempt(attemptId: string, reason: "student" | "time" | "focus" | "teacher") {
  const ref = fdb().collection("attempts").doc(attemptId);
  const done = await fdb().runTransaction(async (t) => {
    const snap = await t.get(ref);
    const a = snap.data() as Attempt | undefined;
    if (!a || a.status !== "in_progress") return false;
    const layout: LayoutEntry[] = JSON.parse(a.layout_json);
    const respRefs = layout.map((l) => fdb().collection("responses").doc(respId(attemptId, l.qid)));
    const respSnaps = respRefs.length ? await t.getAll(...respRefs) : [];
    const qs = await getQuestions(layout.map((l) => l.qid));
    const exam = await getExam(a.exam_id);
    const now = new Date();
    layout.forEach(({ qid }, i) => {
      const q = qs.get(qid);
      if (!q) return;
      const r = respSnaps[i]?.exists ? (respSnaps[i].data() as Response) : null;
      const answer = r?.answer_json ? JSON.parse(r.answer_json) : null;
      const g = autoGrade(q, answer);
      const unanswered = !r || (!r.answer_json && !r.file_path);
      let auto_correct: number | null = null;
      let points_awarded: number | null = null;
      let needs_grading = 0;
      if (g) {
        auto_correct = g.correct ? 1 : 0;
        points_awarded = g.points;
      } else if (unanswered) {
        points_awarded = 0; // nothing submitted: no manual grading needed
      } else {
        needs_grading = 1;
      }
      t.set(respRefs[i], { attempt_id: attemptId, question_id: qid, auto_correct, points_awarded, needs_grading, feedback: r?.feedback || "" }, { merge: true });
    });
    const late = exam?.due_at && new Date(exam.due_at) < now ? 1 : a.late;
    t.update(ref, { status: "submitted", submitted_at: now.toISOString(), submit_reason: reason, late });
    return true;
  });
  if (done) {
    await logEvent(attemptId, "submit", reason);
    await recomputeScore(attemptId);
  }
}

/** Auto-submits expired attempts among those given. Called lazily on page loads (no background job needed). */
export async function sweepExpired(attempts: Pick<Attempt, "id" | "status" | "deadline_at">[]) {
  for (const a of attempts) {
    if (a.status === "in_progress" && pastDeadline(a, DEADLINE_GRACE_MS)) await submitAttempt(a.id, "time");
  }
}

export async function sweepForExam(examId: string) {
  await sweepExpired(await where<Attempt>("attempts", ["exam_id", "==", examId], ["status", "==", "in_progress"]));
}
export async function sweepForUser(userId: string) {
  await sweepExpired(await where<Attempt>("attempts", ["user_id", "==", userId], ["status", "==", "in_progress"]));
}

/** Whether a student may see scores/feedback for a submitted attempt right now. */
export function feedbackVisible(exam: Exam): boolean {
  if (exam.feedback_mode === "immediate") return true;
  if (exam.feedback_mode === "never") return false;
  const cutoff = exam.lock_at || exam.due_at;
  return !cutoff || new Date(cutoff) < new Date();
}

/** Highest-scoring graded attempt (kept score policy). */
export function pickKept(atts: Attempt[]): Attempt | undefined {
  return atts
    .filter((a) => a.status !== "in_progress")
    .sort((a, b) => Number(b.status === "graded") - Number(a.status === "graded") || (b.score ?? -1) - (a.score ?? -1) || b.started_at.localeCompare(a.started_at))[0];
}

export async function keptAttempt(examId: string, userId: string) {
  return pickKept(await attemptsFor(examId, userId));
}

export async function incrementFocusLoss(attemptId: string) {
  await update("attempts", attemptId, { focus_losses: FieldValue.increment(1) });
}

export function pct(score: number | null, max: number | null): string {
  if (score == null || !max) return "—";
  return `${Math.round((score / max) * 1000) / 10}%`;
}

export function newOptionId(): string {
  return crypto.randomBytes(4).toString("hex");
}
