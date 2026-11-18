import { all } from "./db";
import { getExam, keptAttempt, type Exam } from "./exam";

export type Cell = { score: number | null; max: number | null; status: string | null; late: boolean; attemptId: number | null };

export function gradebook(courseId: number, onlyUserId?: number) {
  const exams = all<{ id: number }>("SELECT id FROM exams WHERE course_id = ? AND published = 1 ORDER BY COALESCE(due_at, '9999'), id", courseId).map((r) => getExam(r.id)!) as Exam[];
  const students = all<{ id: number; name: string; email: string }>(
    `SELECT u.id, u.name, u.email FROM enrollments e JOIN users u ON u.id = e.user_id
     WHERE e.course_id = ? AND e.role = 'student' ${onlyUserId ? "AND u.id = ?" : ""} ORDER BY u.name`,
    ...(onlyUserId ? [courseId, onlyUserId] : [courseId])
  );
  const rows = students.map((s) => {
    const cells: Cell[] = exams.map((x) => {
      const a = keptAttempt(x.id, s.id);
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
