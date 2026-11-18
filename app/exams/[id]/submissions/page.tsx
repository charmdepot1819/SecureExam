import Link from "next/link";
import { notFound } from "next/navigation";
import { getMany, getById, where } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { QUIET_EVENTS, getExam, isAssigned, pct, sweepForExam, type Attempt } from "@/lib/exam";
import When from "@/components/When";
import { filesWhere, formatBytes } from "@/lib/files";
import { purgeExamFiles } from "@/app/actions";


export default async function Submissions({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ purged?: string }> }) {
  const { id } = await params;
  const { purged } = await searchParams;
  const exam = await getExam(id);
  if (!exam) notFound();
  await requireTeacher(exam.course_id);
  await sweepForExam(exam.id);
  const course = (await getById("courses", exam.course_id))!;
  const studentIds = (await where("enrollments", ["course_id", "==", exam.course_id], ["role", "==", "student"])).map((e: any) => e.user_id);
  const userMap = await getMany<any>("users", studentIds);
  const students: any[] = [];
  for (const sid of studentIds) if (userMap.has(sid) && (await isAssigned(exam, sid))) students.push(userMap.get(sid));
  students.sort((a, b) => a.name.localeCompare(b.name));
  const attempts = (await where<Attempt>("attempts", ["exam_id", "==", exam.id])).sort((a, b) => a.started_at.localeCompare(b.started_at));
  // Integrity flags are counted on the attempt as they happen (lib/exam.ts logEvent), so this page
  // doesn't read every event document. Older attempts without the counter fall back to reading events.
  const flags = new Map<string, number>();
  await Promise.all(attempts.map(async (a: any) => {
    if (typeof a.flag_count === "number") return flags.set(a.id, a.flag_count);
    const ev = await where("attempt_events", ["attempt_id", "==", a.id]);
    flags.set(a.id, ev.filter((e: any) => !QUIET_EVENTS.includes(e.type)).length);
  }));
  const toGrade = attempts.filter((a) => a.status === "submitted");
  const graded = new Set(attempts.filter((a) => a.status === "graded").map((a) => a.id));
  const files = await filesWhere(["exam_id", "==", exam.id]);
  const purgeable = files.filter((f) => graded.has(f.attempt_id));
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
            {students.map((s) => {
              const mine = attempts.filter((a) => a.user_id === s.id);
              if (!mine.length) return <tr key={s.id}><td>{s.name}</td><td colSpan={6} className="muted">Not started</td></tr>;
              return mine.map((a, i) => {
                const f = flags.get(a.id) || 0;
                return (
                  <tr key={a.id}>
                    <td>{i === 0 ? s.name : ""}</td>
                    <td>#{i + 1}{a.client === "seb" ? <> <span className="badge accent">SEB</span></> : null}</td>
                    <td><When iso={a.submitted_at} empty="—" />{a.late ? <> <span className="badge warn">late</span></> : null}</td>
                    <td>
                      {a.status === "in_progress" ? <span className="badge accent">In progress</span> : a.status === "submitted" ? <span className="badge warn">Needs grading</span> : <span className="badge ok">Graded</span>}
                      {a.submit_reason === "focus" && <> <span className="badge danger">auto-submitted: left exam</span></>}
                      {a.submit_reason === "time" && <> <span className="badge">time ran out</span></>}
                    </td>
                    <td>{f > 0 ? <span className="badge danger">{f} event{f === 1 ? "" : "s"}</span> : <span className="muted">none</span>}</td>
                    <td className="num">{a.score != null ? `${a.score}/${a.max_score} (${pct(a.score, a.max_score)})` : "—"}</td>
                    <td><Link href={`/attempts/${a.id}/grade`}>{a.status === "submitted" ? "Grade" : "Open"}</Link></td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      {purged != null && <div className="notice">Deleted {purged} file{purged === "1" ? "" : "s"}. Grades and feedback were kept.</div>}
      {files.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Uploaded files</h2>
          <p className="muted">
            {files.length} file{files.length === 1 ? "" : "s"}, {formatBytes(files.reduce((s, f) => s + (f.size || 0), 0))}. Download what you need to keep,
            then free space by deleting files from graded submissions. Scores and feedback stay in the gradebook.
          </p>
          <form action={purgeExamFiles} className="row">
            <input type="hidden" name="exam_id" value={exam.id} />
            <button className="danger" disabled={!purgeable.length}>Delete {purgeable.length} file{purgeable.length === 1 ? "" : "s"} from graded submissions</button>
          </form>
        </div>
      )}
    </main>
  );
}
