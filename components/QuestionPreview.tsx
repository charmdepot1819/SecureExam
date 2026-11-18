import { QTYPE_LABEL, type Question } from "@/lib/exam";

/** Compact read-only view of a question with its answer key, for teachers. */
export default function QuestionPreview({ q }: { q: Question }) {
  const key = (id: string) => (q.type === "multi" ? (q.answer?.correct || []).includes(id) : q.answer?.correct === id);
  return (
    <div>
      <div className="qhead"><span>{QTYPE_LABEL[q.type]}</span><span>{q.points} pt{q.points === 1 ? "" : "s"}</span></div>
      <div className="prompt" style={{ fontSize: "1rem", marginBottom: "0.4rem" }}>{q.prompt}</div>
      {(q.type === "mc" || q.type === "multi" || q.type === "tf") && (
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {q.options.map((o) => (
            <li key={o.id} style={{ fontWeight: key(o.id) ? 700 : 400, color: key(o.id) ? "var(--ok)" : undefined }}>
              {o.text}{key(o.id) ? " ✓" : ""}
            </li>
          ))}
        </ul>
      )}
      {q.type === "short" && <p className="muted">Accepted: {(q.answer?.accepted || []).join(" · ")}</p>}
      {q.type === "file" && <p className="muted">Upload: {q.answer?.accept || "any type"}, up to {q.answer?.maxMb || 20} MB</p>}
    </div>
  );
}
