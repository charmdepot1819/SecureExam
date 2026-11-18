import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { get } from "@/lib/db";
import { requireUser, courseRole } from "@/lib/auth";
import { feedbackVisible, getExam, pct } from "@/lib/exam";
import AttemptView from "@/components/AttemptView";
import When from "@/components/When";

export default async function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  const a = get("SELECT * FROM attempts WHERE id = ?", Number(id));
  if (!a) notFound();
  const exam = getExam(a.exam_id)!;
  if (a.user_id !== u.id) {
    if (courseRole(exam.course_id, u.id) === "teacher") redirect(`/attempts/${a.id}/grade`);
    notFound();
  }
  if (a.status === "in_progress") redirect(`/attempts/${a.id}`);
  const visible = feedbackVisible(exam);
  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <div className="muted" style={{ fontSize: "0.85rem" }}><Link href={`/exams/${exam.id}`}>{exam.title}</Link></div>
      <h1>Your submission</h1>
      <div className="card">
        <p>Submitted <When iso={a.submitted_at} />{a.late ? <> <span className="badge warn">late</span></> : null}</p>
        {a.submit_reason === "focus" && <p className="error">This attempt was submitted automatically because you left the exam page.</p>}
        {a.submit_reason === "time" && <p className="muted">Submitted automatically when time ran out.</p>}
        {visible ? (
          a.status === "graded" ? <p style={{ fontSize: "1.3rem", fontWeight: 700 }}>{a.score} / {a.max_score} ({pct(a.score, a.max_score)})</p>
            : <p>Some answers are waiting for your teacher to grade them.</p>
        ) : (
          <p className="muted">Your answers were received. Scores and feedback will be shown {exam.feedback_mode === "after_due" ? "after the due date" : "by your teacher"}.</p>
        )}
        {visible && a.overall_feedback && <div className="notice warn" style={{ whiteSpace: "pre-wrap" }}><strong>Teacher comment:</strong> {a.overall_feedback}</div>}
      </div>
      {visible && <AttemptView attempt={a} showScores showKey={!!exam.show_correct} />}
      {a.client === "seb" && <a className="btn" href="/seb/quit">Quit Safe Exam Browser</a>}
    </main>
  );
}
