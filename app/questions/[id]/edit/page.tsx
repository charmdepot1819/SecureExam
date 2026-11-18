import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { getQuestion } from "@/lib/exam";
import QuestionEditor from "@/components/QuestionEditor";

export default async function EditQuestion({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> }) {
  const { id } = await params;
  const { back } = await searchParams;
  const q = getQuestion(Number(id));
  if (!q) notFound();
  await requireTeacher(q.course_id);
  const banks = all("SELECT id, title FROM banks WHERE course_id = ? ORDER BY title", q.course_id);
  const safeBack = back && back.startsWith("/") && !back.startsWith("//") ? back : `/courses/${q.course_id}/bank`;
  return (
    <main className="wrap">
      <h1>Edit question</h1>
      <p className="muted">Changes apply everywhere this question is used. Already-submitted attempts keep their recorded scores.</p>
      <QuestionEditor courseId={q.course_id} banks={banks} initial={q} back={safeBack} />
    </main>
  );
}
