import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { get } from "@/lib/db";
import { requireUser, courseRole } from "@/lib/auth";
import { attemptsFor, canStart, examQuestionCount, feedbackVisible, getExam, pct, sweepExpired } from "@/lib/exam";
import { beginAttempt } from "../../actions";
import { baseUrl, hasLockdownPass } from "@/lib/seb-access";
import When from "@/components/When";

export default async function ExamLanding({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ seb?: string; pledge?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const exam = getExam(Number(id));
  if (!exam) notFound();
  const u = await requireUser();
  const role = courseRole(exam.course_id, u.id);
  if (!role) redirect("/dashboard");
  sweepExpired();
  const course = get("SELECT * FROM courses WHERE id = ?", exam.course_id);
  const atts = attemptsFor(exam.id, u.id);
  const inProgress = atts.find((a: any) => a.status === "in_progress");
  const av = canStart(exam, u.id);
  const sebOk = !exam.require_lockdown || (await hasLockdownPass(exam.id, u.id));
  const base = await baseUrl();
  const sebLink = `${base.replace(/^http/, "seb")}/exams/${exam.id}/config.seb`;
  const showScores = feedbackVisible(exam);
  const rules: string[] = [];
  if (exam.time_limit_min) rules.push(`You have ${exam.time_limit_min} minutes once you start. The timer keeps running if you close the page.`);
  if (exam.focus_policy === "submit")
    rules.push(exam.focus_warnings
      ? `Stay on this page. Switching tabs or apps, or leaving fullscreen, gives a warning; after ${exam.focus_warnings} warning${exam.focus_warnings === 1 ? "" : "s"} your exam is submitted automatically.`
      : "Stay on this page. Switching to another tab or app, or leaving fullscreen, submits your exam immediately.");
  if (exam.focus_policy === "log") rules.push("Leaving this page (other tabs or apps) is recorded and your teacher can see it.");
  if (exam.require_fullscreen) rules.push("The exam opens in fullscreen where your device supports it.");
  if (exam.block_copy) rules.push("Copying, pasting and right-click are turned off.");
  if (exam.one_at_a_time) rules.push(exam.lock_backtrack ? "Questions appear one at a time and you can't go back." : "Questions appear one at a time.");
  if (exam.focus_policy !== "off" || exam.block_copy)
    rules.unshift("This exam is monitored. Leaving the page, copy/paste attempts and similar events are recorded with timestamps and reviewed by your teacher, and academic dishonesty penalties apply.");
  if (exam.focus_policy !== "off") rules.push("Turn on Do Not Disturb first, so a notification or call doesn't pull you out of the exam.");

  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <div className="muted" style={{ fontSize: "0.85rem" }}><Link href={`/courses/${course.id}`}>{course.title}</Link></div>
      <h1>{exam.title}</h1>
      {role === "teacher" && <div className="notice">You're viewing the student page. <Link href={`/exams/${exam.id}/edit`}>Edit assessment</Link></div>}
      <div className="card">
        <div className="grid two">
          <div><small>Due</small><div><When iso={exam.due_at} empty="No due date" /></div></div>
          <div><small>Questions</small><div>{examQuestionCount(exam.id)}</div></div>
          <div><small>Time limit</small><div>{exam.time_limit_min ? `${exam.time_limit_min} minutes` : "None"}</div></div>
          <div><small>Attempts</small><div>{atts.length} of {exam.max_attempts || "unlimited"}</div></div>
        </div>
        {exam.instructions && <p style={{ whiteSpace: "pre-wrap", marginTop: "0.75rem" }}>{exam.instructions}</p>}
      </div>

      {rules.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Before you start</h2>
          <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>{rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}

      {!!exam.require_lockdown && !sebOk && (
        <div className="notice warn">
          <strong>This exam must be taken in Safe Exam Browser.</strong>
          <ol style={{ paddingLeft: "1.2rem" }}>
            <li>Install Safe Exam Browser for <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer">Windows, macOS or iPad/iPhone</a>.</li>
            <li>Tap <a href={sebLink}>Open exam in Safe Exam Browser</a>, or download the <a href={`/exams/${exam.id}/config.seb`}>exam config file</a> and open it.</li>
            <li>Sign in inside Safe Exam Browser and start the exam there.</li>
          </ol>
          {sp.seb && <p className="error">Safe Exam Browser wasn't detected for this exam.</p>}
        </div>
      )}

      {role === "student" && (
        <div className="card">
          {inProgress ? (
            <Link className="btn primary" href={`/attempts/${inProgress.id}`}>Resume attempt</Link>
          ) : av.ok && sebOk ? (
            <form action={beginAttempt}>
              <input type="hidden" name="exam_id" value={exam.id} />
              {exam.require_pledge ? (
                <label className="inline" style={{ marginBottom: "0.75rem" }}>
                  <input type="checkbox" name="pledge" required />
                  <span>I will complete this {exam.kind} on my own, without help from other people, AI tools, search engines, notes or other materials unless my teacher allowed them.</span>
                </label>
              ) : null}
              {sp.pledge && <p className="error">Please tick the honesty statement to start.</p>}
              <button className="primary">{atts.length ? "Start new attempt" : `Start ${exam.kind}`}</button>
              {av.late && <p className="muted">The due date has passed. This submission will be marked late.</p>}
            </form>
          ) : (
            <p className="muted">{av.reason}</p>
          )}
        </div>
      )}

      {atts.length > 0 && (
        <div className="card table-wrap">
          <h2 style={{ marginTop: 0 }}>Your attempts</h2>
          <table>
            <thead><tr><th>#</th><th>Submitted</th><th>Status</th><th className="num">Score</th><th></th></tr></thead>
            <tbody>
              {atts.map((a: any, i: number) => (
                <tr key={a.id}>
                  <td>{i + 1}</td>
                  <td><When iso={a.submitted_at} empty="—" />{a.late ? <> <span className="badge warn">late</span></> : null}</td>
                  <td>{a.status === "in_progress" ? "In progress" : a.status === "graded" ? "Graded" : "Waiting for grading"}
                    {a.submit_reason === "focus" && <> <span className="badge danger">auto-submitted: left exam</span></>}
                    {a.submit_reason === "time" && <> <span className="badge warn">time ran out</span></>}</td>
                  <td className="num">{showScores && a.status === "graded" ? `${a.score}/${a.max_score} (${pct(a.score, a.max_score)})` : "—"}</td>
                  <td>{a.status !== "in_progress" && <Link href={`/attempts/${a.id}/review`}>Review</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!showScores && <p className="muted">Scores and feedback appear {exam.feedback_mode === "after_due" ? "after the due date" : "when your teacher releases them"}.</p>}
        </div>
      )}
    </main>
  );
}
