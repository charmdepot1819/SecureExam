import Link from "next/link";
import { notFound } from "next/navigation";
import { getById } from "@/lib/db";
import { ensureCourseAccess } from "../../../actions";
import CourseTabs from "@/components/CourseTabs";
import { gradebook } from "@/lib/gradebook";
import { feedbackVisible, pct } from "@/lib/exam";

export default async function Gradebook({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await getById("courses", id);
  if (!course) notFound();
  const { u, role } = await ensureCourseAccess(course.id);
  const teacher = role === "teacher";
  const { exams, rows } = await gradebook(course.id, teacher ? undefined : u.id);
  return (
    <main className="wrap" style={{ maxWidth: 1200 }}>
      <CourseTabs course={course} active="gradebook" teacher={teacher} />
      {teacher && (
        <div className="row" style={{ marginBottom: "0.5rem" }}>
          <a className="btn small" href={`/courses/${course.id}/gradebook/csv`}>Download CSV</a>
          <span className="muted">Highest attempt counts. Total = points earned ÷ points possible on graded work.</span>
        </div>
      )}
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Student</th>
              {exams.map((x) => (
                <th key={x.id} className="num">{teacher ? <Link href={`/exams/${x.id}/submissions`}>{x.title}</Link> : x.title}</th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={exams.length + 2} className="muted">No students yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.student.id}>
                <td className="sticky-col">{r.student.name}</td>
                {r.cells.map((c, i) => {
                  const visible = teacher || feedbackVisible(exams[i]);
                  const body = c.status == null ? <span className="muted">—</span>
                    : c.status === "in_progress" ? <span className="badge accent">in progress</span>
                    : !visible ? <span className="badge ok">submitted</span>
                    : c.status === "submitted" ? <span className="badge warn">to grade</span>
                    : <>{c.score}/{c.max}</>;
                  return (
                    <td key={i} className="num">
                      {teacher && c.attemptId ? <Link href={`/attempts/${c.attemptId}/grade`}>{body}</Link> : !teacher && c.attemptId && visible ? <Link href={`/attempts/${c.attemptId}/review`}>{body}</Link> : body}
                      {c.late && <div><span className="badge warn">late</span></div>}
                    </td>
                  );
                })}
                <td className="num"><strong>{teacher || exams.every((x) => feedbackVisible(x)) ? pct(r.earned, r.possible) : "—"}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
