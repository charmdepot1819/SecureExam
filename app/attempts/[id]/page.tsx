import { notFound, redirect } from "next/navigation";
import { get, all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getExam, getQuestion, pastDeadline, submitAttempt, DEADLINE_GRACE_MS, type LayoutEntry } from "@/lib/exam";
import { hasLockdownPass } from "@/lib/seb-access";
import ExamRunner from "@/components/ExamRunner";

export const dynamic = "force-dynamic";

export default async function TakeAttempt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  const a = get("SELECT * FROM attempts WHERE id = ?", Number(id));
  if (!a || a.user_id !== u.id) notFound();
  const exam = getExam(a.exam_id)!;
  if (a.status === "in_progress" && pastDeadline(a, DEADLINE_GRACE_MS)) submitAttempt(a.id, "time");
  const fresh = get("SELECT status FROM attempts WHERE id = ?", a.id);
  if (fresh.status !== "in_progress") redirect(`/attempts/${a.id}/review`);
  if (exam.require_lockdown && !(await hasLockdownPass(exam.id, u.id))) redirect(`/exams/${exam.id}?seb=required`);

  const layout: LayoutEntry[] = JSON.parse(a.layout_json);
  const saved = all("SELECT question_id, answer_json, file_name FROM responses WHERE attempt_id = ?", a.id);
  // Only what the student needs: never send answer keys or explanations to the browser during an attempt.
  const questions = layout.map((l) => {
    const q = getQuestion(l.qid)!;
    const byId = new Map(q.options.map((o) => [o.id, o]));
    const r = saved.find((s: any) => s.question_id === l.qid);
    return {
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      points: q.points,
      options: l.opts.map((oid) => byId.get(oid)).filter(Boolean),
      accept: q.type === "file" ? q.answer?.accept || "" : "",
      maxMb: q.type === "file" ? q.answer?.maxMb || 20 : 0,
      answer: r?.answer_json ? JSON.parse(r.answer_json) : null,
      fileName: r?.file_name || null,
    };
  });

  return (
    <ExamRunner
      attemptId={a.id}
      examId={exam.id}
      title={exam.title}
      studentLabel={`${u.name} · ${u.email}`}
      deadline={a.deadline_at}
      serverNow={Date.now()}
      questions={questions as any}
      settings={{
        focusPolicy: exam.focus_policy,
        focusWarnings: exam.focus_warnings,
        lossesSoFar: a.focus_losses || 0,
        requireFullscreen: !!exam.require_fullscreen,
        blockCopy: !!exam.block_copy,
        oneAtATime: !!exam.one_at_a_time,
        lockBacktrack: !!exam.lock_backtrack && !!exam.one_at_a_time,
        seb: a.client === "seb",
      }}
    />
  );
}
