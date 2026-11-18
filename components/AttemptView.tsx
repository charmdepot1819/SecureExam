import { all } from "@/lib/db";
import { getQuestion, type LayoutEntry } from "@/lib/exam";

/** Renders an attempt's questions and the student's answers. Teachers get grading inputs. */
export default function AttemptView({ attempt, showScores, showKey, grading }: { attempt: any; showScores: boolean; showKey: boolean; grading?: boolean }) {
  const layout: LayoutEntry[] = JSON.parse(attempt.layout_json);
  const resp = all("SELECT * FROM responses WHERE attempt_id = ?", attempt.id);
  return (
    <>
      {layout.map((l, i) => {
        const q = getQuestion(l.qid);
        if (!q) return null;
        const r = resp.find((x: any) => x.question_id === q.id);
        const a = r?.answer_json ? JSON.parse(r.answer_json) : null;
        const byId = new Map(q.options.map((o) => [o.id, o]));
        const opts = l.opts.map((id) => byId.get(id)!).filter(Boolean);
        const keyed = (id: string) => (q.type === "multi" ? (q.answer?.correct || []).includes(id) : q.answer?.correct === id);
        const picked = (id: string) => (q.type === "multi" ? (a?.choices || []).includes(id) : a?.choice === id);
        const pending = r?.needs_grading && r.points_awarded == null;
        return (
          <section key={q.id} className="qcard">
            <div className="qhead">
              <span>Question {i + 1}</span>
              <span>
                {showScores ? (pending ? <span className="badge warn">needs grading</span> : `${r?.points_awarded ?? 0} / ${q.points} pts`) : `${q.points} pts`}
                {showScores && r?.auto_correct != null && !pending && (
                  <> {r.auto_correct ? <span className="badge ok">correct</span> : (r.points_awarded || 0) > 0 ? <span className="badge warn">partly correct</span> : <span className="badge danger">incorrect</span>}</>
                )}
              </span>
            </div>
            <div className="prompt">{q.prompt}</div>
            {opts.length > 0 && opts.map((o) => (
              <div key={o.id} className={`choice ${showKey && keyed(o.id) ? "right" : picked(o.id) && showKey ? "wrong" : picked(o.id) ? "sel" : ""}`}>
                <span style={{ width: 20 }}>{picked(o.id) ? (q.type === "multi" ? "☑" : "◉") : q.type === "multi" ? "☐" : "○"}</span>
                <span>{o.text}{showKey && keyed(o.id) ? " ✓" : ""}</span>
              </div>
            ))}
            {(q.type === "short" || q.type === "essay") && (
              <div className="card" style={{ whiteSpace: "pre-wrap", margin: 0, background: "var(--bg)" }}>{a?.text || <span className="muted">No answer</span>}</div>
            )}
            {q.type === "short" && showKey && <p className="muted">Accepted answers: {(q.answer?.accepted || []).join(" · ")}</p>}
            {q.type === "file" && (
              <p>{r?.file_path ? <a href={`/api/files/${r.id}`}>Download {r.file_name}</a> : <span className="muted">No file uploaded</span>}</p>
            )}
            {q.type === "essay" && a?.text && <p className="muted" style={{ fontSize: "0.8rem" }}>{a.text.trim().split(/\s+/).length} words</p>}
            {showKey && q.feedback && <div className="notice" style={{ whiteSpace: "pre-wrap" }}><strong>Explanation:</strong> {q.feedback}</div>}
            {showScores && r?.feedback && !grading && <div className="notice warn" style={{ whiteSpace: "pre-wrap" }}><strong>Teacher feedback:</strong> {r.feedback}</div>}
            {grading && (
              <div className="grid two" style={{ marginTop: "0.5rem" }}>
                <div>
                  <label htmlFor={`p${q.id}`}>Points (max {q.points}){r?.auto_correct != null && <span className="hint">Auto-graded; change to override</span>}</label>
                  <input id={`p${q.id}`} name={`points_${q.id}`} type="number" min={0} max={q.points} step={0.25} defaultValue={r?.points_awarded ?? ""} />
                </div>
                <div>
                  <label htmlFor={`f${q.id}`}>Feedback for the student</label>
                  <textarea id={`f${q.id}`} name={`feedback_${q.id}`} defaultValue={r?.feedback || ""} style={{ minHeight: "3rem" }} />
                </div>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
