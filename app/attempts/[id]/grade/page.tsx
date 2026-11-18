import Link from "next/link";
import { notFound } from "next/navigation";
import { getById } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { attemptEvents, getAttempt, getExam, pct, type Attempt } from "@/lib/exam";
import { where } from "@/lib/db";
import { gradeAttempt, reopenAttempt } from "../../../actions";
import AttemptView from "@/components/AttemptView";
import When from "@/components/When";

const EVENT_LABEL: Record<string, string> = {
  start: "Started",
  pledge: "Agreed to honesty statement",
  submit: "Submitted",
  tab_hidden: "Left the page (switched tab/app or screen off)",
  window_blur: "Focus moved to another window/app",
  fullscreen_exit: "Exited fullscreen",
  resume: "Returned to the exam",
  copy_blocked: "Tried to copy (blocked)",
  paste_blocked: "Tried to paste (blocked)",
  context_menu: "Right-click / long-press menu (blocked)",
  key_blocked: "Blocked shortcut key",
  print_blocked: "Tried to print/screenshot key (blocked)",
  devtools: "Possible developer tools open",
  file_picker: "Left page while choosing a file (allowed)",
  multi_tab: "Exam open in two tabs",
  reopened: "Reopened by teacher",
  other: "Other",
};
const SERIOUS = ["tab_hidden", "window_blur", "fullscreen_exit", "devtools", "multi_tab", "paste_blocked"];

export default async function Grade({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const a = await getAttempt(id);
  if (!a) notFound();
  const exam = (await getExam(a.exam_id))!;
  await requireTeacher(exam.course_id);
  const student = (await getById("users", a.user_id)) || { name: "(deleted user)", email: "" };
  const events = await attemptEvents(a.id);
  const nextUngraded = (await where<Attempt>("attempts", ["exam_id", "==", exam.id], ["status", "==", "submitted"]))
    .filter((x) => x.id !== a.id)
    .sort((x, y) => (x.submitted_at || "").localeCompare(y.submitted_at || ""))[0];
  const start = new Date(a.started_at).getTime();
  const rel = (iso: string) => {
    const s = Math.round((new Date(iso).getTime() - start) / 1000);
    return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  return (
    <main className="wrap" style={{ maxWidth: 860 }}>
      <div className="muted" style={{ fontSize: "0.85rem" }}><Link href={`/exams/${exam.id}/submissions`}>{exam.title}: submissions</Link></div>
      <h1>{student.name}</h1>
      {sp.saved && <div className="notice">Grades saved.</div>}
      <div className="card">
        <div className="grid three">
          <div><small>Status</small><div>{a.status === "graded" ? "Graded" : a.status === "submitted" ? "Needs grading" : "In progress"}</div></div>
          <div><small>Score</small><div>{a.score != null ? `${a.score}/${a.max_score} (${pct(a.score, a.max_score)})` : "—"}</div></div>
          <div><small>Submitted</small><div><When iso={a.submitted_at} />{a.late ? <> <span className="badge warn">late</span></> : null}</div></div>
        </div>
        {a.submit_reason === "focus" && <p className="error">Auto-submitted because the student left the exam page.</p>}
      </div>

      <details className="card" open={events.some((e: any) => SERIOUS.includes(e.type))}>
        <summary>Integrity log ({events.length} events)</summary>
        <p className="hint">These are signals, not proof. A notification, a phone call or the screen turning off can also hide the page. Talk with the student before deciding anything.</p>
        <div className="table-wrap">
          <table>
            <tbody>
              {events.map((e: any) => (
                <tr key={e.id}>
                  <td className="num" style={{ width: 70 }}>{rel(e.at)}</td>
                  <td>{SERIOUS.includes(e.type) ? <span className="badge danger">{EVENT_LABEL[e.type] || e.type}</span> : EVENT_LABEL[e.type] || e.type}</td>
                  <td className="muted">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.status !== "in_progress" && (
          <form action={reopenAttempt} className="row" style={{ marginTop: "0.75rem" }}>
            <input type="hidden" name="attempt_id" value={a.id} />
            <span>Wrongly auto-submitted? Let the student continue with</span>
            <input name="extra_minutes" type="number" min={1} defaultValue={10} style={{ width: 80 }} />
            <span>more minutes.</span>
            <button className="small">Reopen attempt</button>
          </form>
        )}
      </details>

      <form action={gradeAttempt}>
        <input type="hidden" name="attempt_id" value={a.id} />
        <AttemptView attempt={a} showScores showKey grading />
        <div className="card">
          <label htmlFor="of">Overall comment</label>
          <textarea id="of" name="overall_feedback" defaultValue={a.overall_feedback} />
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button className="primary">Save grades</button>
            {nextUngraded && (
              <button className="primary" name="next" value={`/attempts/${nextUngraded.id}/grade`}>Save and grade next</button>
            )}
          </div>
        </div>
      </form>
    </main>
  );
}
