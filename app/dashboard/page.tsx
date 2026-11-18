import Link from "next/link";
import { requireUser, educatorMode } from "@/lib/auth";
import { all } from "@/lib/db";
import When from "@/components/When";
import { attemptsFor, canStart, getExam, isAssigned, sweepExpired } from "@/lib/exam";

export default async function Dashboard() {
  const user = await requireUser();
  sweepExpired();
  const edu = await educatorMode(user);

  if (edu) {
    const courses = all(
      `SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.role = 'student') AS students,
        (SELECT COUNT(*) FROM attempts a JOIN exams x ON x.id = a.exam_id WHERE x.course_id = c.id AND a.status = 'submitted') AS to_grade
       FROM courses c JOIN enrollments en ON en.course_id = c.id AND en.user_id = ? AND en.role = 'teacher' ORDER BY c.id DESC`,
      user.id
    );
    return (
      <main className="wrap">
        <div className="spread">
          <h1>Teaching</h1>
          <Link href="/courses/new" className="btn primary">New course</Link>
        </div>
        {courses.length === 0 && <div className="card">No courses yet. Create one, tag your students, then build a quiz.</div>}
        <div className="grid two">
          {courses.map((c: any) => (
            <Link key={c.id} href={`/courses/${c.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="spread"><strong>{c.title}</strong><span className="muted">{c.code}</span></div>
              <p className="muted">{c.students} student{c.students === 1 ? "" : "s"}</p>
              {c.to_grade > 0 && <span className="badge warn">{c.to_grade} to grade</span>}
            </Link>
          ))}
        </div>
      </main>
    );
  }

  const courses = all(
    `SELECT c.* FROM courses c JOIN enrollments e ON e.course_id = c.id AND e.user_id = ? AND e.role = 'student' ORDER BY c.title`,
    user.id
  );
  const exams = all(
    `SELECT x.id FROM exams x JOIN enrollments e ON e.course_id = x.course_id AND e.user_id = ? AND e.role = 'student'
     WHERE x.published = 1 ORDER BY COALESCE(x.due_at, '9999') ASC`,
    user.id
  )
    .map((r: any) => getExam(r.id)!)
    .filter((x) => isAssigned(x, user.id));
  const todo = exams.map((x) => {
    const atts = attemptsFor(x.id, user.id);
    const av = canStart(x, user.id);
    return { x, atts, av, course: courses.find((c: any) => c.id === x.course_id) };
  });

  return (
    <main className="wrap">
      <h1>My work</h1>
      {courses.length === 0 && (
        <div className="card">You aren't in any course yet. Ask your teacher to tag your account ({user.email}) as a student.</div>
      )}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>To do</h2>
        {todo.length === 0 && <p className="muted">Nothing assigned right now.</p>}
        <ul className="list">
          {todo.map(({ x, atts, av, course }) => {
            const done = atts.some((a: any) => a.status !== "in_progress");
            const inProg = atts.some((a: any) => a.status === "in_progress");
            return (
              <li key={x.id}>
                <div className="spread">
                  <div>
                    <Link href={`/exams/${x.id}`}><strong>{x.title}</strong></Link>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                      {course?.title} · {x.kind} · Due <When iso={x.due_at} empty="—" />
                    </div>
                  </div>
                  {inProg ? <span className="badge warn">In progress</span>
                    : done ? <span className="badge ok">Submitted</span>
                    : av.ok ? <span className="badge accent">Open</span>
                    : <span className="badge">{av.reason === "Not open yet." ? "Not open yet" : "Closed"}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <h2>Courses</h2>
      <div className="grid two">
        {courses.map((c: any) => (
          <Link key={c.id} href={`/courses/${c.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <strong>{c.title}</strong> <span className="muted">{c.code}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
