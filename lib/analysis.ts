import { where } from "./db";
import { getQuestions, responsesFor, type Attempt, type LayoutEntry, type Question } from "./exam";

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export type ItemStat = {
  q: Question;
  n: number;
  difficulty: number | null; // mean proportion of points earned (classical p-value)
  discrimination: number | null; // corrected item–total point-biserial correlation
  choiceCounts: Record<string, number>;
};

/**
 * Classical test theory item analysis over each student's FIRST graded attempt.
 * Difficulty p = mean item score / max. Discrimination = correlation of item score with the rest-of-test score
 * (total minus this item), which avoids inflating r with the item's own contribution.
 */
export async function itemAnalysis(examId: string) {
  const graded = await where<Attempt>("attempts", ["exam_id", "==", examId], ["status", "==", "graded"]);
  // First graded attempt per student.
  const firstByUser = new Map<string, Attempt>();
  for (const a of graded.sort((x, y) => x.started_at.localeCompare(y.started_at))) if (!firstByUser.has(a.user_id)) firstByUser.set(a.user_id, a);
  const attempts = [...firstByUser.values()];
  const perItem = new Map<string, { item: number[]; rest: number[]; choices: Record<string, number> }>();
  const totals: number[] = [];
  const layouts = attempts.map((a) => JSON.parse(a.layout_json) as LayoutEntry[]);
  const qs = await getQuestions(layouts.flat().map((l) => l.qid));
  for (const [k, a] of attempts.entries()) {
    const resp = await responsesFor(a.id);
    const total = resp.reduce((s, r) => s + (r.points_awarded || 0), 0);
    totals.push(a.max_score ? total / a.max_score : 0);
    for (const { qid } of layouts[k]) {
      const q = qs.get(qid);
      if (!q || !q.points) continue;
      const r = resp.find((x) => x.question_id === qid);
      const pts = r?.points_awarded || 0;
      const e = perItem.get(qid) || { item: [], rest: [], choices: {} };
      e.item.push(pts / q.points);
      e.rest.push(total - pts);
      const ans = r?.answer_json ? JSON.parse(r.answer_json) : null;
      for (const c of ans?.choices || (ans?.choice ? [ans.choice] : [])) e.choices[c] = (e.choices[c] || 0) + 1;
      perItem.set(qid, e);
    }
  }
  const items: ItemStat[] = [...perItem.entries()].map(([qid, e]) => ({
    q: qs.get(qid)!,
    n: e.item.length,
    difficulty: e.item.length ? e.item.reduce((a, b) => a + b, 0) / e.item.length : null,
    discrimination: pearson(e.item, e.rest),
    choiceCounts: e.choices,
  }));
  const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  return { n: attempts.length, mean, items };
}
