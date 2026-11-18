import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { getExam, isAssigned, pct, sweepExpired } from "@/lib/exam";
import When from "@/components/When";

export default async function Submissions({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exam = getExam(Number(id));
  if (!exam) notFound();
  await requireTeacher(exam.course_id);
  sweepExpired();
  const course = get("SELECT * FROM courses WHERE id = ?", exam.course_id);
  const students = all("SELECT u.id, u.name, u.email FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = ? AND e.role = 'student' ORDER BY u.name", exam.course_id)
    .filter((s: any) => isAssigned(exam, s.id));
  const attempts = all(
    `SELECT a.*, (SELECT COUNT(*) FROM attempt_events ev WHERE ev.attempt_id = a.id AND ev.type NOT IN ('start','submit','resume','pledge')) AS flags
     FROM attempts a WHERE a.exam_id = ? ORDER BY a.id`,
    exam.id
  );
  const toGrade = attempts.filter((a: any) => a.status === "submitted");
  return (
    <main className="wrap">
      <div className="muted" style={{ fontSize: "0.85rem" }}><Link href={`/courses/${course.id}`}>{course.title}</Link></div>
      <div className="spread">
        <h1>{exam.title}: submissions</h1>
        <div className="row">
          {toGrade.length > 0 && <Link className="btn primary" href={`/attempts/${toGrade[0].id}/grade`}>Grade next ({toGrade.length})</Link>}
          <Link className="btn" href={`/exams/${exam.id}/analysis`}>Item analysis</Link>
          <Link className="btn" href={`/exams/${exam.id}/edit`}>Edit</Link>
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Student</th><th>Attempt</th><th>Submitted</th><th>Status</th><th>Integrity</th><th className="num">Score</th><th></th></tr></thead>
          <tbody>
            {students.map((s: any) => {
              const mine = attempts.filter((a: any) => a.user_id === s.id);
              if (!mine.length) return (
                <tr key={s.id}><td>{s.name}</td><td colSpan={6} className="muted">Not started</td></tr>
              );
              return mine.map((a: any, i: number) => (
                <tr key={a.id}>
                  <td>{i === 0 ? s.name : ""}</td>
                  <td>#{i + 1}{a.client === "seb" ? <> <span className="badge accent">SEB</span></> : null}</td>
                  <td><When iso={a.submitted_at} empty="—" />{a.late ? <> <span className="badge warn">late</span></> : null}</td>
                  <td>
                    {a.status === "in_progress" ? <span className="badge accent">In progress</span> : a.status === "submitted" ? <span className="badge warn">Needs grading</span> : <span className="badge ok">Graded</span>}
                    {a.submit_reason === "focus" && <> <span className="badge danger">auto-submitted: left exam</span></>}
                    {a.submit_reason === "time" && <> <span className="badge">time ran out</span></>}
                  </td>
                  <td>{a.flags > 0 ? <span className="badge danger">{a.flags} event{a.flags === 1 ? "" : "s"}</span> : <span className="muted">none</span>}</td>
                  <td className="num">{a.score != null ? `${a.score}/${a.max_score} (${pct(a.score, a.max_score)})` : "—"}</td>
                  <td><Link href={`/attempts/${a.id}/grade`}>{a.status === "submitted" ? "Grade" : "Open"}</Link></td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
