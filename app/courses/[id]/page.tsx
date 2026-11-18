import Link from "next/link";
import { notFound } from "next/navigation";
import { fdb, getById, where } from "@/lib/db";
import { storedBytes } from "@/lib/files";
import StorageMeter from "@/components/StorageMeter";
import { ensureCourseAccess, createExam, purgeCourseFiles } from "../../actions";
import CourseTabs from "@/components/CourseTabs";
import When from "@/components/When";
import { attemptsFor, examQuestionCount, isAssigned, pickKept, pct, feedbackVisible, sweepForUser, type Attempt, type Exam } from "@/lib/exam";

/** Count aggregation: billed as one read per 1,000 matches instead of one read per attempt. */
async function countAttempts(examId: string, status: string) {
  const snap = await fdb().collection("attempts").where("exam_id", "==", examId).where("status", "==", status).count().get();
  return snap.data().count;
}

export default async function CoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ purged?: string; purge?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const course = await getById("courses", id);
  if (!course) notFound();
  const { u, role } = await ensureCourseAccess(course.id);
  const teacher = role === "teacher";
  const exams = (await where<Exam>("exams", ["course_id", "==", course.id])).sort(
    (a, b) => (a.due_at || "9999").localeCompare(b.due_at || "9999") || (a.created_at || "").localeCompare(b.created_at || "")
  );

  if (teacher) {
    const rows = await Promise.all(exams.map(async (x) => {
      const [g, done, qn] = await Promise.all([countAttempts(x.id, "submitted"), countAttempts(x.id, "graded"), examQuestionCount(x.id)]);
      return { x, n: g + done, g, qn };
    }));
    const [courseBytes, totalBytes] = await Promise.all([storedBytes(course.id), storedBytes()]);
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
          {rows.map(({ x, n, g, qn }) => (
            <li key={x.id}>
              <div className="spread">
                <div>
                  <Link href={`/exams/${x.id}/edit`}><strong>{x.title}</strong></Link>{" "}
                  {x.published ? <span className="badge ok">Published</span> : <span className="badge">Draft</span>}{" "}
                  {x.require_lockdown ? <span className="badge accent">Safe Exam Browser</span> : null}
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    {x.kind} · {qn} questions · Due <When iso={x.due_at} empty="—" />
                    {x.time_limit_min ? ` · ${x.time_limit_min} min` : ""}
                  </div>
                </div>
                <Link className="btn small" href={`/exams/${x.id}/submissions`}>
                  Submissions ({n}){g ? ` · ${g} to grade` : ""}
                </Link>
              </div>
            </li>
          ))}
        </ul>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Storage</h2>
          <StorageMeter bytes={totalBytes} label={`Uploads in this course: ${(courseBytes / 1048576).toFixed(1)} MB. All courses on this site:`} />
          {sp.purged != null && <div className="notice">Deleted {sp.purged} file{sp.purged === "1" ? "" : "s"}. Grades and feedback were kept.</div>}
          {sp.purge === "confirm" && <div className="notice warn">Type DELETE in the box to confirm.</div>}
          <details>
            <summary>End of term: delete all uploaded files in this course</summary>
            <p className="muted">Download any files you must keep first. Scores, feedback and answers to other question types stay. This cannot be undone.</p>
            <form action={purgeCourseFiles} className="row">
              <input type="hidden" name="course_id" value={course.id} />
              <input name="confirm" type="text" placeholder="Type DELETE" style={{ width: "10rem" }} autoComplete="off" />
              <button className="danger">Delete all course files</button>
            </form>
          </details>
        </div>
      </main>
    );
  }

  await sweepForUser(u.id);
  const mine: { x: Exam; atts: Attempt[] }[] = [];
  for (const x of exams) if (x.published && (await isAssigned(x, u.id))) mine.push({ x, atts: await attemptsFor(x.id, u.id) });
  return (
    <main className="wrap">
      <CourseTabs course={course} active="" teacher={false} />
      {course.description && <p>{course.description}</p>}
      <ul className="list card">
        {mine.length === 0 && <li className="muted">Nothing assigned yet.</li>}
        {mine.map(({ x, atts }) => {
          const kept = pickKept(atts);
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
