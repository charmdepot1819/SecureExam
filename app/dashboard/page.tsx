import Link from "next/link";
import { requireUser, educatorMode } from "@/lib/auth";
import { fdb, getById, where } from "@/lib/db";
import { storedBytes } from "@/lib/files";
import StorageMeter from "@/components/StorageMeter";
import When from "@/components/When";
import { attemptsFor, canStart, isAssigned, sweepForUser, type Exam } from "@/lib/exam";

export default async function Dashboard() {
  const user = await requireUser();
  await sweepForUser(user.id);
  const edu = await educatorMode(user);
  const enr = await where("enrollments", ["user_id", "==", user.id]);

  if (edu) {
    const courseIds = enr.filter((e: any) => e.role === "teacher").map((e: any) => e.course_id);
    const courses = (await Promise.all(courseIds.map(async (id: string) => {
      const c = await getById("courses", id);
      if (!c) return null;
      // Count aggregations cost one read per 1,000 matches, not one per document.
      const [students, toGrade] = await Promise.all([
        fdb().collection("enrollments").where("course_id", "==", id).where("role", "==", "student").count().get(),
        fdb().collection("attempts").where("course_id", "==", id).where("status", "==", "submitted").count().get(),
      ]).then((r) => r.map((x) => x.data().count));
      return { ...c, students, to_grade: toGrade };
    }))).filter(Boolean).sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""));
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
        {courses.length > 0 && <div className="card"><StorageMeter bytes={await storedBytes()} /></div>}
      </main>
    );
  }

  const courseIds = enr.filter((e: any) => e.role === "student").map((e: any) => e.course_id);
  const courses = (await Promise.all(courseIds.map((id: string) => getById("courses", id)))).filter(Boolean).sort((a: any, b: any) => a.title.localeCompare(b.title));
  const exams: Exam[] = [];
  for (const c of courses) {
    for (const x of await where<Exam>("exams", ["course_id", "==", c.id], ["published", "==", 1])) if (await isAssigned(x, user.id)) exams.push(x);
  }
  exams.sort((a, b) => (a.due_at || "9999").localeCompare(b.due_at || "9999"));
  const todo = await Promise.all(exams.map(async (x) => ({ x, atts: await attemptsFor(x.id, user.id), av: await canStart(x, user.id), course: courses.find((c: any) => c.id === x.course_id) })));

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
            const done = atts.some((a) => a.status !== "in_progress");
            const inProg = atts.some((a) => a.status === "in_progress");
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
