"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { finishAttempt, saveResponse, startUpload, uploadChunk } from "@/app/actions";

type Q = {
  id: string;
  type: "mc" | "multi" | "tf" | "short" | "essay" | "file";
  prompt: string;
  points: number;
  options: { id: string; text: string }[];
  accept: string;
  maxMb: number;
  answer: any;
  fileName: string | null;
};
type Settings = {
  focusPolicy: "off" | "log" | "submit";
  focusWarnings: number;
  lossesSoFar: number;
  requireFullscreen: boolean;
  blockCopy: boolean;
  oneAtATime: boolean;
  lockBacktrack: boolean;
  seb: boolean;
};

const LEAVE_LABEL: Record<string, string> = {
  tab_hidden: "You switched to another tab or app.",
  window_blur: "You moved to another window or app.",
  fullscreen_exit: "You left fullscreen.",
};

function answered(q: Q, a: any, fileName: string | null) {
  if (q.type === "file") return !!fileName;
  if (!a) return false;
  if (q.type === "multi") return (a.choices || []).length > 0;
  if (q.type === "short" || q.type === "essay") return !!(a.text || "").trim();
  return a.choice != null;
}

/**
 * Phone photos are often 3 to 8 MB. Before upload, re-encode large photos as JPEG at most 1600 px on the
 * long side (still readable for handwriting and lab photos), which usually gives 200 to 600 KB.
 * Only done when JPEG is an allowed type; if anything fails, the original file is sent.
 */
async function shrinkImage(file: File, accept: string): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size <= 500 * 1024) return file;
  const allowed = accept.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ext = !allowed.length || allowed.includes(".jpg") ? ".jpg" : allowed.includes(".jpeg") ? ".jpeg" : null;
  if (!ext) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // <img> applies the photo's EXIF rotation when drawn
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.8));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]*$/, "") + ext, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ExamRunner(props: {
  attemptId: string;
  examId: string;
  title: string;
  studentLabel: string;
  deadline: string | null;
  serverNow: number;
  questions: Q[];
  settings: Settings;
}) {
  const { attemptId, questions, settings: S } = props;
  const [answers, setAnswers] = useState<Record<string, any>>(() => Object.fromEntries(questions.map((q) => [q.id, q.answer])));
  const [files, setFiles] = useState<Record<string, string | null>>(() => Object.fromEntries(questions.map((q) => [q.id, q.fileName])));
  const [idx, setIdx] = useState(0);
  const [maxIdx, setMaxIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [warning, setWarning] = useState<{ text: string; remaining: number } | null>(null);
  const [forced, setForced] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // In-page confirm instead of window.confirm(): native dialogs take focus away from the page and would count as leaving.
  const [ask, setAsk] = useState<{ text: string; resolve: (ok: boolean) => void } | null>(null);
  const confirmInPage = (text: string) => new Promise<boolean>((resolve) => setAsk({ text, resolve }));

  const armed = useRef(false);
  const picking = useRef<number>(0); // timestamp until which a file picker may legitimately hide the page
  const lastLeave = useRef(0);
  const lastLog = useRef<Record<string, number>>({});
  const timers = useRef<Record<string, any>>({});
  const offset = useRef(0);
  const fsSupported = useRef(false);

  const reviewUrl = `/attempts/${attemptId}/review`;

  const goReview = useCallback(() => {
    armed.current = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    window.location.replace(reviewUrl);
  }, [reviewUrl]);

  /** Sends an integrity event. keepalive lets it complete even if the browser freezes the page right after hiding it. */
  const report = useCallback(
    (type: string, detail = "", counting = false) => {
      if (!counting) {
        const now = Date.now();
        if (now - (lastLog.current[type] || 0) < 10_000) return; // throttle log-only events
        lastLog.current[type] = now;
      }
      fetch(`/api/attempts/${attemptId}/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, detail }),
        keepalive: true,
        credentials: "same-origin",
      })
        .then((r) => r.json())
        .then((res) => {
          if (res.submitted) {
            armed.current = false;
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            setForced(LEAVE_LABEL[type] || "This attempt was submitted.");
          } else if (counting && S.focusPolicy === "submit" && res.remaining >= 0) {
            setWarning({ text: LEAVE_LABEL[type] || "You left the exam.", remaining: res.remaining });
          } else if (counting && S.focusPolicy === "log") {
            setWarning({ text: (LEAVE_LABEL[type] || "You left the exam.") + " This was recorded for your teacher.", remaining: -1 });
          }
        })
        .catch(() => {});
    },
    [attemptId, S.focusPolicy]
  );

  const leave = useCallback(
    (type: string, detail = "") => {
      if (!armed.current || S.focusPolicy === "off") return;
      if (Date.now() < picking.current) {
        report("file_picker", `${type} while choosing a file`);
        return;
      }
      const now = Date.now();
      if (now - lastLeave.current < 1500) return; // one switch often fires blur + hidden together
      lastLeave.current = now;
      report(type, detail, true);
    },
    [report, S.focusPolicy]
  );

  // ---------- Timer ----------
  useEffect(() => {
    offset.current = props.serverNow - Date.now();
    if (!props.deadline) return;
    const end = new Date(props.deadline).getTime();
    const tick = () => {
      const left = end - (Date.now() + offset.current);
      setRemainingMs(left);
      if (left <= 0) {
        clearInterval(t);
        armed.current = false;
        finishAttempt(attemptId, "time").finally(goReview);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [props.deadline, props.serverNow, attemptId, goReview]);

  // ---------- Integrity monitoring ----------
  useEffect(() => {
    fsSupported.current = !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
    const onVis = () => {
      if (document.visibilityState === "hidden") leave("tab_hidden", "page hidden");
      else if (armed.current) report("resume", "returned to the exam");
    };
    const onBlur = () => {
      setTimeout(() => {
        if (document.visibilityState === "visible" && !document.hasFocus()) leave("window_blur", "focus left the page");
      }, 800);
    };
    const onFs = () => {
      if (!document.fullscreenElement && armed.current && S.requireFullscreen && fsSupported.current) leave("fullscreen_exit", "exited fullscreen");
    };
    const onFocus = () => {
      if (picking.current && Date.now() < picking.current) picking.current = Date.now() + 1500;
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFs);

    // Opening the same attempt in two tabs is logged.
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(`exam-attempt-${attemptId}`);
      bc.onmessage = (e) => {
        if (e.data === "hello") { bc!.postMessage("here"); report("multi_tab", "attempt open in another tab"); }
        if (e.data === "here") report("multi_tab", "attempt open in another tab");
      };
      bc.postMessage("hello");
    } catch {}

    const blockers: [string, EventListener][] = [];
    if (S.blockCopy) {
      const stop = (type: string) => (e: Event) => {
        const t = e.target as HTMLElement;
        // Students can still select/edit text inside their own answer boxes, but not copy it out or paste in.
        if (type === "selectstart" && t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
        e.preventDefault();
        if (type !== "selectstart" && type !== "dragstart") report(`${type === "contextmenu" ? "context_menu" : type + "_blocked"}`, type);
      };
      for (const ev of ["copy", "cut", "paste", "contextmenu", "selectstart", "dragstart", "drop"]) {
        const h = stop(ev === "cut" ? "copy" : ev === "drop" ? "paste" : ev);
        document.addEventListener(ev, h, true);
        blockers.push([ev, h]);
      }
      const onKey = (e: KeyboardEvent) => {
        const k = e.key.toLowerCase();
        const mod = e.ctrlKey || e.metaKey;
        const bad =
          (mod && ["c", "x", "v", "p", "s", "u", "f", "g"].includes(k)) ||
          k === "f12" ||
          (mod && e.shiftKey && ["i", "j", "c", "k"].includes(k)) ||
          k === "printscreen";
        if (bad) {
          e.preventDefault();
          report(k === "p" ? "print_blocked" : "key_blocked", `${mod ? "Ctrl/Cmd+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key}`);
        }
      };
      document.addEventListener("keydown", onKey as EventListener, true);
      blockers.push(["keydown", onKey as EventListener]);
      const onBeforePrint = () => report("print_blocked", "print");
      window.addEventListener("beforeprint", onBeforePrint);
      blockers.push(["beforeprint", onBeforePrint as EventListener]);
    }

    // Heuristic devtools check on computers only (docked devtools shrink the page). Logged, never auto-submits.
    let dt: any = null;
    if (window.matchMedia("(pointer: fine)").matches) {
      dt = setInterval(() => {
        if (!armed.current) return;
        if (window.outerWidth - window.innerWidth > 200 || window.outerHeight - window.innerHeight > 250) report("devtools", "browser panel open (possible developer tools)");
      }, 3000);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFs);
      for (const [ev, h] of blockers) {
        if (ev === "beforeprint") window.removeEventListener(ev, h);
        else document.removeEventListener(ev, h, true);
      }
      bc?.close();
      if (dt) clearInterval(dt);
    };
  }, [attemptId, leave, report, S.blockCopy, S.requireFullscreen]);

  async function begin() {
    if (S.requireFullscreen && fsSupported.current && !document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" } as any);
      } catch {}
    }
    armed.current = true;
    setStarted(true);
    setWarning(null);
  }

  // ---------- Answers ----------
  async function persist(qid: string, answer: any) {
    setSaveState("saving");
    try {
      const r = await saveResponse(attemptId, qid, answer);
      if (!r.ok) {
        setSaveState("error");
        setSaveError(r.error || "Not saved");
        if (/submitted|Time is up/.test(r.error || "")) goReview();
        return;
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
      setSaveError("Connection problem. Your answer will be saved when you change it again.");
    }
  }
  function setAnswer(qid: string, answer: any, debounce = 0) {
    setAnswers((a) => ({ ...a, [qid]: answer }));
    clearTimeout(timers.current[qid]);
    if (debounce) timers.current[qid] = setTimeout(() => persist(qid, answer), debounce);
    else persist(qid, answer);
  }

  /** Sends the file in small pieces (see lib/files.ts) so each request stays under hosting limits. */
  async function upload(q: Q, file: File | undefined) {
    picking.current = Date.now() + 1500;
    if (!file) return;
    setSaveState("saving");
    try {
      file = await shrinkImage(file, q.accept || "");
      const st = await startUpload(attemptId, q.id, file.name, file.size);
      if (!st.ok) throw new Error(st.error);
      const n = Math.ceil(file.size / st.chunkBytes!);
      for (let i = 0; i < n; i++) {
        const fd = new FormData();
        fd.set("file_id", st.fileId!);
        fd.set("index", String(i));
        fd.set("chunk", file.slice(i * st.chunkBytes!, (i + 1) * st.chunkBytes!));
        setSaveError("");
        const r = await uploadChunk(fd);
        if (!r.ok) throw new Error(r.error);
        if (r.done) setFiles((f) => ({ ...f, [q.id]: r.name! }));
      }
      setSaveState("saved");
    } catch (e: any) {
      setSaveState("error");
      setSaveError(e?.message || "Upload failed. Check your connection.");
    }
  }

  const unanswered = useMemo(() => questions.filter((q) => !answered(q, answers[q.id], files[q.id])).length, [questions, answers, files]);

  async function submit() {
    const msg = unanswered ? `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit anyway?` : "Submit your answers? You can't change them afterwards.";
    if (!(await confirmInPage(msg))) return;
    setSubmitting(true);
    armed.current = false;
    // Flush any pending debounced saves first.
    await Promise.all(Object.entries(timers.current).map(([qid, t]) => { clearTimeout(t); return persist(qid, answers[qid]); }));
    await finishAttempt(attemptId, "student");
    goReview();
  }

  async function goTo(i: number) {
    if (S.lockBacktrack && i < idx) return;
    if (S.lockBacktrack && i > idx && !(await confirmInPage("You won't be able to come back to this question. Continue?"))) return;
    setIdx(i);
    setMaxIdx((m) => Math.max(m, i));
    window.scrollTo({ top: 0 });
  }

  const shown = S.oneAtATime ? [questions[idx]] : questions;
  const mm = remainingMs != null ? Math.max(0, Math.floor(remainingMs / 60000)) : 0;
  const ss = remainingMs != null ? Math.max(0, Math.floor((remainingMs % 60000) / 1000)) : 0;

  return (
    <div className={S.blockCopy ? "no-select" : ""}>
      <style>{`[data-hide-in-exam]{display:none!important}`}</style>
      <div className="watermark" aria-hidden>
        {Array.from({ length: 40 }).map((_, i) => <div key={i}>{`${props.studentLabel}   ·   ${props.studentLabel}   ·   ${props.studentLabel}`}</div>)}
      </div>
      <div className="exam-bar">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.title}</div>
          <div className="status-line" aria-live="polite">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "All answers saved" : saveState === "error" ? <span className="error">{saveError}</span> : `${questions.length - unanswered}/${questions.length} answered`}
          </div>
        </div>
        {remainingMs != null && (
          <div className={`timer ${remainingMs < 5 * 60000 ? "low" : ""}`} role="timer" aria-label="Time remaining">
            {mm}:{String(ss).padStart(2, "0")}
          </div>
        )}
      </div>

      <main className="exam-shell">
        {S.oneAtATime && (
          <nav className="qnav" aria-label="Questions">
            {questions.map((q, i) => (
              <button key={q.id} type="button"
                className={`${answered(q, answers[q.id], files[q.id]) ? "answered" : ""} ${i === idx ? "current" : ""}`}
                disabled={S.lockBacktrack ? i !== idx && i !== idx + 1 : false}
                onClick={() => goTo(i)} aria-label={`Question ${i + 1}`}>{i + 1}</button>
            ))}
          </nav>
        )}
        {shown.map((q) => {
          const n = questions.indexOf(q) + 1;
          const a = answers[q.id];
          return (
            <section key={q.id} className="qcard" aria-labelledby={`q${q.id}`}>
              <div className="qhead"><span>Question {n} of {questions.length}</span><span>{q.points} pt{q.points === 1 ? "" : "s"}</span></div>
              <div id={`q${q.id}`} className="prompt">{q.prompt}</div>
              {(q.type === "mc" || q.type === "tf") && q.options.map((o) => (
                <label key={o.id} className={`choice ${a?.choice === o.id ? "sel" : ""}`}>
                  <input type="radio" name={`q${q.id}`} checked={a?.choice === o.id} onChange={() => setAnswer(q.id, { choice: o.id })} />
                  <span>{o.text}</span>
                </label>
              ))}
              {q.type === "multi" && (
                <>
                  <p className="muted" style={{ fontSize: "0.85rem" }}>Select all that apply.</p>
                  {q.options.map((o) => {
                    const on = (a?.choices || []).includes(o.id);
                    return (
                      <label key={o.id} className={`choice ${on ? "sel" : ""}`}>
                        <input type="checkbox" checked={on}
                          onChange={(e) => {
                            const cur: string[] = a?.choices || [];
                            setAnswer(q.id, { choices: e.target.checked ? [...cur, o.id] : cur.filter((c) => c !== o.id) });
                          }} />
                        <span>{o.text}</span>
                      </label>
                    );
                  })}
                </>
              )}
              {q.type === "short" && (
                <input type="text" value={a?.text || ""} autoComplete="off" autoCorrect="off" spellCheck={false}
                  onChange={(e) => setAnswer(q.id, { text: e.target.value }, 800)} aria-label="Your answer" />
              )}
              {q.type === "essay" && (
                <textarea value={a?.text || ""} autoComplete="off" autoCorrect="off" spellCheck={false} style={{ minHeight: "12rem" }}
                  onChange={(e) => setAnswer(q.id, { text: e.target.value }, 1200)} aria-label="Your answer" />
              )}
              {q.type === "file" && (
                <div>
                  <input type="file" accept={q.accept || undefined}
                    onClick={() => { picking.current = Date.now() + 120_000; }}
                    onChange={(e) => upload(q, e.target.files?.[0])}
                    style={{ minHeight: 44 }} />
                  <p className="muted" style={{ fontSize: "0.85rem" }}>
                    {q.accept ? `Allowed: ${q.accept}. ` : ""}Max {q.maxMb} MB. {files[q.id] ? <strong>Uploaded: {files[q.id]}</strong> : "No file uploaded yet."}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </main>

      <footer className="exam-foot">
        {S.oneAtATime ? (
          <>
            <button type="button" onClick={() => goTo(idx - 1)} disabled={idx === 0 || S.lockBacktrack}>Previous</button>
            {idx < questions.length - 1 ? (
              <button type="button" className="primary" onClick={() => goTo(idx + 1)}>Next</button>
            ) : (
              <button type="button" className="primary" onClick={submit} disabled={submitting}>Submit</button>
            )}
          </>
        ) : (
          <>
            <span className="muted" style={{ alignSelf: "center" }}>{unanswered ? `${unanswered} unanswered` : "All answered"}</span>
            <button type="button" className="primary" onClick={submit} disabled={submitting}>{submitting ? "Submitting…" : "Submit"}</button>
          </>
        )}
      </footer>

      {!started && !forced && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{maxIdx > 0 || Object.values(answers).some(Boolean) ? "Continue your exam" : "Ready?"}</h2>
            {S.focusPolicy === "submit" && (
              <p>
                {S.focusWarnings - S.lossesSoFar > 0
                  ? `If you leave this page (another tab, app, or exiting fullscreen) you'll get a warning. You have ${S.focusWarnings - S.lossesSoFar} warning${S.focusWarnings - S.lossesSoFar === 1 ? "" : "s"} left before the exam submits itself.`
                  : "If you leave this page (another tab, app, or exiting fullscreen) your exam is submitted immediately."}
              </p>
            )}
            {S.focusPolicy === "log" && <p>Leaving this page is recorded for your teacher.</p>}
            <p className="muted">Turn on Do Not Disturb so notifications don't pull you away.</p>
            <button className="primary" onClick={begin} style={{ width: "100%" }}>
              {S.requireFullscreen ? "Enter fullscreen and start" : "Start"}
            </button>
          </div>
        </div>
      )}

      {warning && !forced && (
        <div className="overlay" role="alertdialog" aria-modal="true">
          <div className="card">
            <h2 style={{ marginTop: 0, color: "var(--danger)" }}>Warning</h2>
            <p>{warning.text}</p>
            {warning.remaining >= 0 && (
              <p><strong>{warning.remaining === 0 ? "Next time you leave, your exam will be submitted." : `${warning.remaining} more warning${warning.remaining === 1 ? "" : "s"} before your exam is submitted.`}</strong></p>
            )}
            <button className="primary" style={{ width: "100%" }} onClick={begin}>Return to the exam</button>
          </div>
        </div>
      )}

      {ask && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card">
            <p style={{ marginTop: 0 }}>{ask.text}</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" onClick={() => { ask.resolve(false); setAsk(null); }}>Cancel</button>
              <button type="button" className="primary" onClick={() => { ask.resolve(true); setAsk(null); }}>Continue</button>
            </div>
          </div>
        </div>
      )}

      {forced && (
        <div className="overlay" role="alertdialog" aria-modal="true">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Your exam was submitted</h2>
            <p>{forced} Under this exam's rules, leaving the exam submits it. Your answers up to that moment were saved and your teacher can see what happened.</p>
            <a className="btn primary" href={reviewUrl} style={{ width: "100%" }}>See my submission</a>
          </div>
        </div>
      )}
    </div>
  );
}
