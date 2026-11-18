"use client";
import { useState } from "react";
import { saveQuestion } from "@/app/actions";

type Opt = { id?: string; text: string; correct: boolean };
const TYPES: [string, string][] = [
  ["mc", "Multiple choice (one answer)"],
  ["multi", "Multiple answers (select all that apply)"],
  ["tf", "True / False"],
  ["short", "Short answer (auto-graded)"],
  ["essay", "Essay (graded by teacher)"],
  ["file", "File upload (graded by teacher)"],
];

export default function QuestionEditor(props: {
  courseId: number;
  banks: { id: number; title: string }[];
  initial?: any;
  examId?: number;
  back: string;
}) {
  const q = props.initial;
  const [type, setType] = useState<string>(q?.type || "mc");
  const [prompt, setPrompt] = useState<string>(q?.prompt || "");
  const [points, setPoints] = useState<number>(q?.points ?? 1);
  const [bankId, setBankId] = useState<string>(q?.bank_id ? String(q.bank_id) : props.banks[0] ? String(props.banks[0].id) : "");
  const [feedback, setFeedback] = useState<string>(q?.feedback || "");
  const [options, setOptions] = useState<Opt[]>(
    q?.options?.length && (q.type === "mc" || q.type === "multi")
      ? q.options.map((o: any) => ({
          id: o.id,
          text: o.text,
          correct: q.type === "mc" ? q.answer?.correct === o.id : (q.answer?.correct || []).includes(o.id),
        }))
      : [{ text: "", correct: true }, { text: "", correct: false }, { text: "", correct: false }, { text: "", correct: false }]
  );
  const [tf, setTf] = useState<string>(q?.type === "tf" ? q.answer?.correct || "true" : "true");
  const [accepted, setAccepted] = useState<string>(q?.type === "short" ? (q.answer?.accepted || []).join("\n") : "");
  const [accept, setAccept] = useState<string>(q?.type === "file" ? q.answer?.accept || "" : ".pdf,.docx,.jpg,.png");
  const [maxMb, setMaxMb] = useState<number>(q?.type === "file" ? q.answer?.maxMb || 20 : 20);
  const [err, setErr] = useState("");

  const payload = JSON.stringify({ id: q?.id, type, prompt, points, bank_id: bankId || null, feedback, options, tf, accepted, accept, maxMb });

  function validate(e: React.FormEvent) {
    setErr("");
    if (!prompt.trim()) return fail(e, "Write the question first.");
    if (type === "mc" || type === "multi") {
      const filled = options.filter((o) => o.text.trim());
      if (filled.length < 2) return fail(e, "Add at least two answer choices.");
      if (!filled.some((o) => o.correct)) return fail(e, "Mark the correct answer.");
    }
    if (type === "short" && !accepted.trim()) return fail(e, "Add at least one accepted answer.");
  }
  function fail(e: React.FormEvent, m: string) {
    e.preventDefault();
    setErr(m);
  }
  const setOpt = (i: number, patch: Partial<Opt>) =>
    setOptions((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : type === "mc" && patch.correct ? { ...o, correct: false } : o)));

  return (
    <form action={saveQuestion} onSubmit={validate} className="card">
      <input type="hidden" name="course_id" value={props.courseId} />
      <input type="hidden" name="exam_id" value={props.examId || ""} />
      <input type="hidden" name="back" value={props.back} />
      <input type="hidden" name="payload" value={payload} />

      <div className="grid two">
        <div>
          <label htmlFor="qtype">Question type</label>
          <select id="qtype" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="grid two">
          <div>
            <label htmlFor="pts">Points</label>
            <input id="pts" type="number" min={0} step={0.5} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="bank">Question bank</label>
            <select id="bank" value={bankId} onChange={(e) => setBankId(e.target.value)}>
              <option value="">None</option>
              {props.banks.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </div>
        </div>
      </div>

      <label htmlFor="prompt">Question</label>
      <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Write the question students will see" />

      {(type === "mc" || type === "multi") && (
        <>
          <label>Answer choices <span className="hint">{type === "mc" ? "Select the one correct answer." : "Tick every correct answer. Scoring gives partial credit: right picks minus wrong picks."}</span></label>
          {options.map((o, i) => (
            <div key={i} className="row" style={{ marginBottom: "0.4rem", flexWrap: "nowrap" }}>
              <input
                type={type === "mc" ? "radio" : "checkbox"}
                name="correct_ui"
                checked={o.correct}
                onChange={(e) => setOpt(i, { correct: e.target.checked })}
                aria-label={`Mark choice ${i + 1} correct`}
                style={{ width: 22, height: 22, flex: "none" }}
              />
              <input type="text" value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} placeholder={`Choice ${i + 1}`} />
              <button type="button" className="small" onClick={() => setOptions((os) => os.filter((_, j) => j !== i))} aria-label="Remove choice">✕</button>
            </div>
          ))}
          <button type="button" className="small" onClick={() => setOptions((os) => [...os, { text: "", correct: false }])}>+ Add choice</button>
        </>
      )}

      {type === "tf" && (
        <>
          <label>Correct answer</label>
          <div className="row">
            {["true", "false"].map((v) => (
              <label key={v} className="inline"><input type="radio" checked={tf === v} onChange={() => setTf(v)} /> {v === "true" ? "True" : "False"}</label>
            ))}
          </div>
        </>
      )}

      {type === "short" && (
        <>
          <label htmlFor="acc">Accepted answers <span className="hint">One per line. Matching ignores capital letters, extra spaces and a trailing period. You can still change points when grading.</span></label>
          <textarea id="acc" value={accepted} onChange={(e) => setAccepted(e.target.value)} placeholder={"mitochondria\nthe mitochondria"} />
        </>
      )}

      {type === "file" && (
        <div className="grid two">
          <div>
            <label htmlFor="accept">Allowed file types <span className="hint">Comma-separated extensions; blank allows any</span></label>
            <input id="accept" type="text" value={accept} onChange={(e) => setAccept(e.target.value)} />
          </div>
          <div>
            <label htmlFor="maxmb">Max size (MB)</label>
            <input id="maxmb" type="number" min={1} max={25} value={maxMb} onChange={(e) => setMaxMb(Number(e.target.value))} />
          </div>
        </div>
      )}

      <label htmlFor="fb">Explanation shown with feedback <span className="hint">Explain why the answer is right. Elaborated feedback helps learning more than right/wrong alone.</span></label>
      <textarea id="fb" value={feedback} onChange={(e) => setFeedback(e.target.value)} style={{ minHeight: "4rem" }} />

      {err && <p className="error" role="alert">{err}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="primary">{q?.id ? "Save question" : props.examId ? "Add to assessment" : "Save to bank"}</button>
        <a className="btn" href={props.back}>Cancel</a>
      </div>
    </form>
  );
}
