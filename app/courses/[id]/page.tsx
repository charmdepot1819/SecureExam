import Link from "next/link";
import { notFound } from "next/navigation";
import { get, all } from "@/lib/db";
import { ensureCourseAccess, createExam } from "../../actions";
import CourseTabs from "@/components/CourseTabs";
import When from "@/components/When";
import { attemptsFor, examQuestionCount, getExam, isAssigned, keptAttempt, pct, feedbackVisible, sweepExpired } from "@/lib/exam";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = get("SELECT * FROM courses WHERE id = ?", Number(id));
  if (!course) notFound();
  const { u, role } = await ensureCourseAccess(course.id);
  sweepExpired();
  const teacher = role === "teacher";
  const exams = all("SELECT id FROM exams WHERE course_id = ? ORDER BY COALESCE(due_at, '9999'), id", course.id).map((r: any) => getExam(r.id)!);

  if (teacher) {
    return (
      <main className="wrap">
        <CourseTabs course={course} active="" teacher />
        <form action={createExam} className="card row">
          <input type="hidden" name="course_id" value={course.id} />
          <input name="title" type="text" placeholder="New assessment title" required style={{ flex: "1 1 220px" }} />
          <select name="kind" style={{ width: "auto" }}>
            <option value="quiz">Quiz</option>
            <option value="exam">Exam</option>
            <option value="assignment">Assignment (file upload)</option>
          </select>
          <button className="primary">Create</button>
        </form>
        {exams.length === 0 && <p className="muted">No assessments yet.</p>}
        <ul className="list card">
          {exams.map((x) => {
            const sub = get("SELECT COUNT(*) AS n, SUM(status = 'submitted') AS g FROM attempts WHERE exam_id = ? AND status != 'in_progress'", x.id);
            return (
              <li key={x.id}>
                <div className="spread">
                  <div>
                    <Link href={`/exams/${x.id}/edit`}><strong>{x.title}</strong></Link>{" "}
                    {x.published ? <span className="badge ok">Published</span> : <span className="badge">Draft</span>}{" "}
                    {x.require_lockdown ? <span className="badge accent">Safe Exam Browser</span> : null}
                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                      {x.kind} · {examQuestionCount(x.id)} questions · Due <When iso={x.due_at} empty="—" />
                      {x.time_limit_min ? ` · ${x.time_limit_min} min` : ""}
                    </div>
                  </div>
                  <div className="row">
                    <Link className="btn small" href={`/exams/${x.id}/submissions`}>
                      Submissions ({sub?.n || 0}){sub?.g ? ` · ${sub.g} to grade` : ""}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    );
  }

  const mine = exams.filter((x) => x.published && isAssigned(x, u.id));
  return (
    <main className="wrap">
      <CourseTabs course={course} active="" teacher={false} />
      {course.description && <p>{course.description}</p>}
      <ul className="list card">
        {mine.length === 0 && <li className="muted">Nothing assigned yet.</li>}
        {mine.map((x) => {
          const atts = attemptsFor(x.id, u.id);
          const kept = keptAttempt(x.id, u.id);
          return (
            <li key={x.id}>
              <div className="spread">
                <div>
                  <Link href={`/exams/${x.id}`}><strong>{x.title}</strong></Link>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>{x.kind} · Due <When iso={x.due_at} empty="—" /></div>
                </div>
                <span>
                  {kept && feedbackVisible(x) && kept.status === "graded" ? `${kept.score}/${kept.max_score} (${pct(kept.score, kept.max_score)})`
                    : atts.length ? <span className="badge ok">Submitted</span> : <span className="badge accent">To do</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
