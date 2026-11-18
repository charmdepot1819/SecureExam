import Link from "next/link";
import { notFound } from "next/navigation";
import { getById, where } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { createBank, deleteQuestion } from "../../../actions";
import CourseTabs from "@/components/CourseTabs";
import QuestionEditor from "@/components/QuestionEditor";
import QuestionPreview from "@/components/QuestionPreview";
import { rowToQuestion } from "@/lib/exam";

export default async function Bank({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; bank?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const course = await getById("courses", id);
  if (!course) notFound();
  await requireTeacher(course.id);
  const banks = (await where("banks", ["course_id", "==", course.id])).map((b: any) => ({ id: b.id, title: b.title })).sort((a, b) => a.title.localeCompare(b.title));
  const questions = (await where("questions", ["course_id", "==", course.id])).map(rowToQuestion).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const groups = [...banks.map((b) => ({ ...b, qs: questions.filter((q) => q.bank_id === b.id) })), { id: "", title: "Not in a bank", qs: questions.filter((q) => !q.bank_id) }];
  const back = `/courses/${course.id}/bank`;
  return (
    <main className="wrap">
      <CourseTabs course={course} active="bank" teacher />
      <p className="muted">
        Keep questions in banks, then let each assessment draw a random set from a bank. Every student gets a different
        mix, which makes sharing answers less useful and lets you reuse items across terms.
      </p>
      {sp.new ? (
        <QuestionEditor courseId={course.id} banks={banks} back={back} initial={sp.bank ? { bank_id: sp.bank } : undefined} />
      ) : (
        <div className="row">
          <Link className="btn primary" href={`${back}?new=1`}>New question</Link>
          <form action={createBank} className="row">
            <input type="hidden" name="course_id" value={course.id} />
            <input name="title" type="text" placeholder="New bank name (e.g. Week 3: Cells)" required style={{ width: 260 }} />
            <button>Add bank</button>
          </form>
        </div>
      )}
      {groups.filter((g) => g.id || g.qs.length).map((g) => (
        <details key={g.id || "none"} className="card" open={g.qs.length > 0 && g.qs.length < 15}>
          <summary>{g.title} <span className="muted" style={{ marginLeft: "0.5rem", fontWeight: 400 }}>({g.qs.length})</span></summary>
          {g.id ? <Link className="btn small" href={`${back}?new=1&bank=${g.id}`}>+ Question in this bank</Link> : null}
          <ul className="list">
            {g.qs.map((q) => (
              <li key={q.id}>
                <QuestionPreview q={q} />
                <div className="row" style={{ marginTop: "0.4rem" }}>
                  <Link className="btn small" href={`/questions/${q.id}/edit?back=${encodeURIComponent(back)}`}>Edit</Link>
                  <form action={deleteQuestion}>
                    <input type="hidden" name="course_id" value={course.id} />
                    <input type="hidden" name="question_id" value={q.id} />
                    <button className="small danger">Delete</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </main>
  );
}
