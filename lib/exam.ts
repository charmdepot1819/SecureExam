import crypto from "node:crypto";
import { all, get, run, tx, nowIso } from "./db";

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
  id: number;
  course_id: number;
  bank_id: number | null;
  type: QType;
  prompt: string;
  options: Option[];
  answer: any;
  points: number;
  feedback: string;
};

export type Exam = {
  id: number;
  course_id: number;
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
};

export type LayoutEntry = { qid: number; opts: string[] };

export function rowToQuestion(r: any): Question {
  return {
    ...r,
    options: JSON.parse(r.options_json || "[]"),
    answer: JSON.parse(r.answer_json || "{}"),
  };
}

export function getQuestion(id: number): Question | undefined {
  const r = get("SELECT * FROM questions WHERE id = ?", id);
  return r ? rowToQuestion(r) : undefined;
}

export function getExam(id: number): Exam | undefined {
  return get<Exam>("SELECT * FROM exams WHERE id = ?", id);
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
  // short answer
  const accepted: string[] = (q.answer?.accepted || []).map(normalizeText);
  const ok = accepted.includes(normalizeText(answer?.text || ""));
  return { correct: ok, points: ok ? q.points : 0 };
}

export function isAssigned(exam: Exam, userId: number): boolean {
  const enr = get("SELECT role FROM enrollments WHERE course_id = ? AND user_id = ? AND role = 'student'", exam.course_id, userId);
  if (!enr) return false;
  if (exam.assign_all) return true;
  return !!get("SELECT 1 FROM exam_assignees WHERE exam_id = ? AND user_id = ?", exam.id, userId);
}

export function examQuestionCount(examId: number): number {
  const rows = all<{ question_id: number | null; draw_count: number | null }>(
    "SELECT question_id, draw_count FROM exam_items WHERE exam_id = ?",
    examId
  );
  return rows.reduce((n, r) => n + (r.question_id ? 1 : r.draw_count || 0), 0);
}

/** Builds the per-attempt question layout: fixed items + random draws from banks, then shuffles. */
export function buildLayout(exam: Exam): LayoutEntry[] {
  const items = all<{ question_id: number | null; bank_id: number | null; draw_count: number | null }>(
    "SELECT question_id, bank_id, draw_count FROM exam_items WHERE exam_id = ? ORDER BY position",
    exam.id
  );
  const chosen: number[] = [];
  for (const it of items) {
    if (it.question_id) {
      if (!chosen.includes(it.question_id)) chosen.push(it.question_id);
    } else if (it.bank_id) {
      const pool = all<{ id: number }>("SELECT id FROM questions WHERE bank_id = ?", it.bank_id)
        .map((r) => r.id)
        .filter((id) => !chosen.includes(id));
      chosen.push(...shuffle(pool).slice(0, it.draw_count || 1));
    }
  }
  const ordered = exam.shuffle_questions ? shuffle(chosen) : chosen;
  return ordered.map((qid) => {
    const q = getQuestion(qid)!;
    const ids = q.options.map((o) => o.id);
    const opts = exam.shuffle_options && (q.type === "mc" || q.type === "multi") ? shuffle(ids) : ids;
    return { qid, opts };
  });
}

export function attemptsFor(examId: number, userId: number) {
  return all("SELECT * FROM attempts WHERE exam_id = ? AND user_id = ? ORDER BY id", examId, userId);
}

export type Availability = { ok: boolean; reason?: string; late?: boolean };

export function canStart(exam: Exam, userId: number): Availability {
  const now = new Date();
  if (!exam.published) return { ok: false, reason: "This assessment is not published yet." };
  if (!isAssigned(exam, userId)) return { ok: false, reason: "This assessment is not assigned to you." };
  if (exam.available_from && new Date(exam.available_from) > now)
    return { ok: false, reason: "Not open yet." };
  if (exam.lock_at && new Date(exam.lock_at) < now) return { ok: false, reason: "This assessment is closed." };
  const late = !!exam.due_at && new Date(exam.due_at) < now;
  if (late && !exam.allow_late) return { ok: false, reason: "The due date has passed." };
  const atts = attemptsFor(exam.id, userId);
  if (atts.some((a: any) => a.status === "in_progress")) return { ok: true, late };
  if (exam.max_attempts > 0 && atts.length >= exam.max_attempts)
    return { ok: false, reason: "You have used all your attempts." };
  if (examQuestionCount(exam.id) === 0) return { ok: false, reason: "This assessment has no questions yet." };
  return { ok: true, late };
}

export function startAttempt(exam: Exam, userId: number): number {
  const existing = get<{ id: number }>(
    "SELECT id FROM attempts WHERE exam_id = ? AND user_id = ? AND status = 'in_progress'",
    exam.id,
    userId
  );
  if (existing) return existing.id;
  const start = new Date();
  let deadline: Date | null = exam.time_limit_min ? new Date(start.getTime() + exam.time_limit_min * 60000) : null;
  if (exam.lock_at) {
    const lock = new Date(exam.lock_at);
    if (!deadline || lock < deadline) deadline = lock;
  }
  const layout = buildLayout(exam);
  const max = layout.reduce((s, l) => s + (getQuestion(l.qid)?.points || 0), 0);
  const late = exam.due_at && new Date(exam.due_at) < start ? 1 : 0;
  const { id } = run(
    `INSERT INTO attempts (exam_id, user_id, started_at, deadline_at, layout_json, max_score, late)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    exam.id,
    userId,
    start.toISOString(),
    deadline ? deadline.toISOString() : null,
    JSON.stringify(layout),
    max,
    late
  );
  logEvent(id, "start", "");
  return id;
}

export function logEvent(attemptId: number, type: string, detail: string) {
  run("INSERT INTO attempt_events (attempt_id, type, detail, at) VALUES (?, ?, ?, ?)", attemptId, type, detail.slice(0, 500), nowIso());
}

/** Grace period for network latency after the deadline, in ms. */
export const DEADLINE_GRACE_MS = 30_000;

export function pastDeadline(attempt: any, graceMs = 0): boolean {
  return !!attempt.deadline_at && Date.now() > new Date(attempt.deadline_at).getTime() + graceMs;
}

export function saveAnswer(attemptId: number, qid: number, answer: any) {
  run(
    `INSERT INTO responses (attempt_id, question_id, answer_json) VALUES (?, ?, ?)
     ON CONFLICT(attempt_id, question_id) DO UPDATE SET answer_json = excluded.answer_json`,
    attemptId,
    qid,
    JSON.stringify(answer)
  );
}

export function recomputeScore(attemptId: number) {
  const a = get("SELECT * FROM attempts WHERE id = ?", attemptId);
  if (!a || a.status === "in_progress") return;
  const layout: LayoutEntry[] = JSON.parse(a.layout_json);
  const resp = all("SELECT * FROM responses WHERE attempt_id = ?", attemptId);
  const pending = resp.some((r: any) => r.needs_grading && r.points_awarded == null);
  const score = resp.reduce((s: number, r: any) => s + (r.points_awarded || 0), 0);
  void layout;
  run("UPDATE attempts SET score = ?, status = ? WHERE id = ?", score, pending ? "submitted" : "graded", attemptId);
}

/** Finalizes an attempt: auto-grades objective items, flags the rest for manual grading. */
export function submitAttempt(attemptId: number, reason: "student" | "time" | "focus" | "teacher") {
  tx(() => {
    const a = get("SELECT * FROM attempts WHERE id = ?", attemptId);
    if (!a || a.status !== "in_progress") return;
    const layout: LayoutEntry[] = JSON.parse(a.layout_json);
    for (const { qid } of layout) {
      const q = getQuestion(qid);
      if (!q) continue;
      const r = get("SELECT * FROM responses WHERE attempt_id = ? AND question_id = ?", attemptId, qid);
      const answer = r?.answer_json ? JSON.parse(r.answer_json) : null;
      const g = autoGrade(q, answer);
      const unanswered = !r || (!r.answer_json && !r.file_path);
      let autoCorrect: number | null = null;
      let points: number | null = null;
      let needs = 0;
      if (g) {
        autoCorrect = g.correct ? 1 : 0;
        points = g.points;
      } else if (unanswered) {
        points = 0; // nothing submitted: no manual grading needed
      } else {
        needs = 1;
      }
      run(
        `INSERT INTO responses (attempt_id, question_id, auto_correct, points_awarded, needs_grading) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET auto_correct = excluded.auto_correct,
           points_awarded = excluded.points_awarded, needs_grading = excluded.needs_grading`,
        attemptId,
        qid,
        autoCorrect,
        points,
        needs
      );
    }
    const now = new Date();
    const exam = getExam(a.exam_id)!;
    const late = exam.due_at && new Date(exam.due_at) < now ? 1 : a.late;
    run(
      "UPDATE attempts SET status = 'submitted', submitted_at = ?, submit_reason = ?, late = ? WHERE id = ?",
      now.toISOString(),
      reason,
      late,
      attemptId
    );
    logEvent(attemptId, "submit", reason);
  });
  recomputeScore(attemptId);
}

/** Auto-submits any attempt whose time has run out. Called lazily on page loads. */
export function sweepExpired() {
  const rows = all<{ id: number; deadline_at: string }>(
    "SELECT id, deadline_at FROM attempts WHERE status = 'in_progress' AND deadline_at IS NOT NULL"
  );
  for (const r of rows) {
    if (Date.now() > new Date(r.deadline_at).getTime() + DEADLINE_GRACE_MS) submitAttempt(r.id, "time");
  }
}

/** Whether a student may see scores/feedback for a submitted attempt right now. */
export function feedbackVisible(exam: Exam): boolean {
  if (exam.feedback_mode === "immediate") return true;
  if (exam.feedback_mode === "never") return false;
  const cutoff = exam.lock_at || exam.due_at;
  return !cutoff || new Date(cutoff) < new Date();
}

/** Highest-scoring graded attempt (kept score policy). */
export function keptAttempt(examId: number, userId: number) {
  return get(
    `SELECT * FROM attempts WHERE exam_id = ? AND user_id = ? AND status != 'in_progress'
     ORDER BY (status = 'graded') DESC, score DESC, id DESC LIMIT 1`,
    examId,
    userId
  );
}

export function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function pct(score: number | null, max: number | null): string {
  if (score == null || !max) return "—";
  return `${Math.round((score / max) * 1000) / 10}%`;
}

export function newOptionId(): string {
  return crypto.randomBytes(4).toString("hex");
}
