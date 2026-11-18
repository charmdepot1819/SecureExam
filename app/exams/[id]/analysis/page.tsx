import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { getExam, QTYPE_LABEL } from "@/lib/exam";
import { itemAnalysis } from "@/lib/analysis";

function dLabel(r: number | null) {
  if (r == null) return <span className="muted">n/a</span>;
  // Guideline bands from Ebel & Frisbie (1991), Essentials of Educational Measurement.
  const v = r.toFixed(2);
  if (r >= 0.4) return <span className="badge ok">{v} very good</span>;
  if (r >= 0.3) return <span className="badge ok">{v} good</span>;
  if (r >= 0.2) return <span className="badge warn">{v} marginal</span>;
  return <span className="badge danger">{v} review item</span>;
}

export default async function Analysis({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exam = getExam(Number(id));
  if (!exam) notFound();
  await requireTeacher(exam.course_id);
  const { n, mean, items } = itemAnalysis(exam.id);
  return (
    <main className="wrap">
      <div className="muted" style={{ fontSize: "0.85rem" }}><Link href={`/exams/${exam.id}/submissions`}>{exam.title}: submissions</Link></div>
      <h1>Item analysis</h1>
      <div className="card">
        <p>Based on each student's first fully graded attempt: <strong>{n}</strong> students{mean != null ? <>, mean score <strong>{Math.round(mean * 1000) / 10}%</strong></> : null}.</p>
        <p className="hint">
          <strong>Difficulty (p)</strong> is the share of points students earned on the item; very high or very low values tell you little about who has learned the material.
          <strong> Discrimination</strong> is the correlation between the item and the rest of the test (corrected point-biserial). Low or negative values often mean an ambiguous
          question or a wrong answer key. Treat results from small classes (fewer than about 30 students) with caution.
          Bands follow Ebel &amp; Frisbie, <em>Essentials of Educational Measurement</em> (1991).
        </p>
      </div>
      {n === 0 && <p className="muted">No graded attempts yet.</p>}
      {items.map((s) => (
        <div key={s.q.id} className="card">
          <div className="qhead"><span>{QTYPE_LABEL[s.q.type]}</span><span>{s.n} responses</span></div>
          <div className="prompt" style={{ fontSize: "1rem" }}>{s.q.prompt}</div>
          <div className="row">
            <span>Difficulty p = <strong>{s.difficulty != null ? s.difficulty.toFixed(2) : "n/a"}</strong>
              {s.difficulty != null && s.difficulty > 0.9 && <> <span className="badge">very easy</span></>}
              {s.difficulty != null && s.difficulty < 0.3 && <> <span className="badge warn">very hard</span></>}
            </span>
            <span>Discrimination: {dLabel(s.discrimination)}</span>
            <Link className="btn small" href={`/questions/${s.q.id}/edit?back=${encodeURIComponent(`/exams/${exam.id}/analysis`)}`}>Edit</Link>
          </div>
          {s.q.options.length > 0 && (
            <table style={{ marginTop: "0.5rem" }}>
              <tbody>
                {s.q.options.map((o) => {
                  const key = s.q.type === "multi" ? (s.q.answer?.correct || []).includes(o.id) : s.q.answer?.correct === o.id;
                  const c = s.choiceCounts[o.id] || 0;
                  return (
                    <tr key={o.id}>
                      <td>{o.text}{key ? " ✓" : ""}</td>
                      <td className="num" style={{ width: 120 }}>{c} ({s.n ? Math.round((c / s.n) * 100) : 0}%)</td>
                      <td className="muted" style={{ width: 200 }}>{!key && c === 0 && s.n >= 10 ? "No one chose this distractor" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </main>
  );
}
