import { getMany, where } from "./db";
import { pickKept, type Attempt, type Exam } from "./exam";

export type Cell = { score: number | null; max: number | null; status: string | null; late: boolean; attemptId: string | null };

export async function gradebook(courseId: string, onlyUserId?: string) {
  const exams = (await where<Exam>("exams", ["course_id", "==", courseId], ["published", "==", 1])).sort(
    (a, b) => (a.due_at || "9999").localeCompare(b.due_at || "9999") || (a.created_at || "").localeCompare(b.created_at || "")
  );
  const enr = await where("enrollments", ["course_id", "==", courseId], ["role", "==", "student"]);
  const users = await getMany("users", enr.map((e: any) => e.user_id));
  const students = enr
    .map((e: any) => users.get(e.user_id))
    .filter((u: any) => u && (!onlyUserId || u.id === onlyUserId))
    .sort((a: any, b: any) => a.name.localeCompare(b.name)) as { id: string; name: string; email: string }[];
  const attempts = await where<Attempt>("attempts", ["course_id", "==", courseId]);
  const rows = students.map((s) => {
    const cells: Cell[] = exams.map((x) => {
      const a = pickKept(attempts.filter((t) => t.exam_id === x.id && t.user_id === s.id));
      return a
        ? { score: a.score, max: a.max_score, status: a.status, late: !!a.late, attemptId: a.id }
        : { score: null, max: null, status: null, late: false, attemptId: null };
    });
    const graded = cells.filter((c) => c.status === "graded");
    const earned = graded.reduce((t, c) => t + (c.score || 0), 0);
    const possible = graded.reduce((t, c) => t + (c.max || 0), 0);
    return { student: s, cells, earned, possible };
  });
  return { exams, rows };
}
