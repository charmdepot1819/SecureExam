import Link from "next/link";
import { notFound } from "next/navigation";
import { getMany, getById, where } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { examItems, getExam, getQuestions, rowToQuestion } from "@/lib/exam";
import {
  addExistingQuestions,
  addRandomDraw,
  deleteExam,
  moveItem,
  removeItem,
  setAssignees,
  setPublished,
  updateExamSettings,
} from "../../../actions";
import ConfirmButton from "@/components/ConfirmButton";
import QuestionEditor from "@/components/QuestionEditor";
import QuestionPreview from "@/components/QuestionPreview";
import DateTimeField, { TzOffset } from "@/components/DateTimeField";
import { baseUrl, examSebConfig } from "@/lib/seb-access";
import { configKey } from "@/lib/seb";

export default async function EditExam({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ add?: string; saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const exam = await getExam(id);
  if (!exam) notFound();
  await requireTeacher(exam.course_id);
  const course = (await getById("courses", exam.course_id))!;
  const allQs = (await where("questions", ["course_id", "==", exam.course_id])).map(rowToQuestion);
  const banks = (await where("banks", ["course_id", "==", exam.course_id]))
    .map((b: any) => ({ id: b.id, title: b.title, n: allQs.filter((q) => q.bank_id === b.id).length }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const items = await examItems(exam.id);
  const qmap = await getQuestions(items.map((i) => i.question_id!).filter(Boolean));
  const usedIds = items.filter((i) => i.question_id).map((i) => i.question_id);
  const bankQs = allQs.filter((q) => !usedIds.includes(q.id)).sort((a, b) => (a.bank_id || "").localeCompare(b.bank_id || ""));
  const studentIds = (await where("enrollments", ["course_id", "==", exam.course_id], ["role", "==", "student"])).map((e: any) => e.user_id);
  const userMap = await getMany("users", studentIds);
  const students = studentIds.map((sid: string) => userMap.get(sid)).filter(Boolean).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const assigned = (await where("exam_assignees", ["exam_id", "==", exam.id])).map((r: any) => r.user_id);
  const total = items.reduce((s, it) => s + (it.question_id ? qmap.get(it.question_id)?.points || 0 : 0), 0);
  const perStudent = items.reduce((n, r) => n + (r.question_id ? 1 : r.draw_count || 0), 0);
  const hasDraws = items.some((i: any) => i.bank_id);
  const back = `/exams/${exam.id}/edit`;
  const base = await baseUrl();
  const ck = configKey(examSebConfig(exam, base));
  const sebLink = `${base.replace(/^http/, "seb")}/exams/${exam.id}/config.seb`;
  const timed = exam.kind !== "assignment";

  return (
    <main className="wrap">
      <div className="muted" style={{ fontSize: "0.85rem" }}><Link href={`/courses/${course.id}`}>{course.title}</Link></div>
      <div className="spread">
        <h1>{exam.title}</h1>
        <div className="row">
          {exam.published ? <span className="badge ok">Published</span> : <span className="badge">Draft</span>}
          <form action={setPublished}>
            <input type="hidden" name="exam_id" value={exam.id} />
            {!exam.published && <input type="hidden" name="value" value="1" />}
            <button className={exam.published ? "small" : "small primary"}>{exam.published ? "Unpublish" : "Publish"}</button>
          </form>
          <Link className="btn small" href={`/exams/${exam.id}`}>Student view</Link>
          <Link className="btn small" href={`/exams/${exam.id}/submissions`}>Submissions</Link>
        </div>
      </div>
      {sp.saved && <div className="notice">Settings saved.</div>}

      {/* ---------- Questions ---------- */}
      <section className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Questions</h2>
          <span className="muted">{perStudent} per student{hasDraws ? "" : ` · ${total} pts`}</span>
        </div>
        <ol className="list" style={{ marginTop: "0.5rem" }}>
          {items.map((it: any, i: number) => {
            const q = it.question_id ? qmap.get(it.question_id) : null;
            const bank = it.bank_id ? banks.find((b: any) => b.id === it.bank_id) : null;
            return (
              <li key={it.id}>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Item {i + 1}</div>
                {q ? <QuestionPreview q={q} /> : (
                  <p><strong>Random draw:</strong> {it.draw_count} question{it.draw_count === 1 ? "" : "s"} from “{bank?.title}” ({bank?.n ?? 0} in bank)
                    {bank && bank.n < (it.draw_count || 0) && <span className="badge danger" style={{ marginLeft: 6 }}>bank too small</span>}</p>
                )}
                <div className="row" style={{ marginTop: "0.3rem" }}>
                  {[["up", "↑"], ["down", "↓"]].map(([d, l]) => (
                    <form key={d} action={moveItem}>
                      <input type="hidden" name="exam_id" value={exam.id} />
                      <input type="hidden" name="item_id" value={it.id} />
                      <input type="hidden" name="dir" value={d} />
                      <button className="small" aria-label={`Move ${d}`}>{l}</button>
                    </form>
                  ))}
                  {q && <Link className="btn small" href={`/questions/${q.id}/edit?back=${encodeURIComponent(back)}`}>Edit</Link>}
                  <form action={removeItem}>
                    <input type="hidden" name="exam_id" value={exam.id} />
                    <input type="hidden" name="item_id" value={it.id} />
                    <button className="small danger">Remove</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="tabs" style={{ marginTop: "1rem" }}>
          <Link href={`${back}?add=new#add`} className={sp.add === "new" || !sp.add ? "on" : ""}>Write a new question</Link>
          <Link href={`${back}?add=bank#add`} className={sp.add === "bank" ? "on" : ""}>Pick from bank</Link>
          <Link href={`${back}?add=draw#add`} className={sp.add === "draw" ? "on" : ""}>Random draw from bank</Link>
        </div>
        <div id="add">
          {(sp.add === "new" || !sp.add) && (
            <QuestionEditor courseId={exam.course_id} banks={banks} examId={exam.id} back={back}
              initial={exam.kind === "assignment" && items.length === 0 ? { type: "file", points: 100 } : undefined} />
          )}
          {sp.add === "bank" && (
            <form action={addExistingQuestions}>
              <input type="hidden" name="exam_id" value={exam.id} />
              {bankQs.length === 0 && <p className="muted">No unused questions in this course's banks.</p>}
              {bankQs.map((q) => (
                <label key={q.id} className="inline card" style={{ margin: "0.4rem 0" }}>
                  <input type="checkbox" name="question_id" value={q.id} />
                  <div style={{ flex: 1 }}><QuestionPreview q={q} /></div>
                </label>
              ))}
              {bankQs.length > 0 && <button className="primary">Add selected</button>}
            </form>
          )}
          {sp.add === "draw" && (
            <form action={addRandomDraw} className="row">
              <input type="hidden" name="exam_id" value={exam.id} />
              <span>Give each student</span>
              <input type="number" name="draw_count" min={1} defaultValue={5} style={{ width: 90 }} />
              <span>random questions from</span>
              <select name="bank_id" style={{ width: "auto" }}>
                {banks.map((b: any) => <option key={b.id} value={b.id}>{b.title} ({b.n})</option>)}
              </select>
              <button className="primary">Add draw</button>
            </form>
          )}
        </div>
      </section>

      {/* ---------- Settings ---------- */}
      <form action={updateExamSettings} className="card">
        <input type="hidden" name="exam_id" value={exam.id} />
        <TzOffset />
        <h2 style={{ marginTop: 0 }}>Settings</h2>
        <div className="grid two">
          <div><label htmlFor="title">Title</label><input id="title" name="title" type="text" defaultValue={exam.title} /></div>
          <div>
            <label htmlFor="kind">Type</label>
            <select id="kind" name="kind" defaultValue={exam.kind}>
              <option value="quiz">Quiz</option><option value="exam">Exam</option><option value="assignment">Assignment</option>
            </select>
          </div>
        </div>
        <label htmlFor="instructions">Instructions</label>
        <textarea id="instructions" name="instructions" defaultValue={exam.instructions} />

        <h3>Availability</h3>
        <div className="grid three">
          <div><label htmlFor="af">Opens</label><DateTimeField id="af" name="available_from" iso={exam.available_from} /></div>
          <div><label htmlFor="due">Due</label><DateTimeField id="due" name="due_at" iso={exam.due_at} /></div>
          <div><label htmlFor="lock">Closes <span className="hint">No starts or saves after this</span></label><DateTimeField id="lock" name="lock_at" iso={exam.lock_at} /></div>
        </div>
        <div className="grid three">
          <div><label htmlFor="tl">Time limit (minutes) <span className="hint">Blank = untimed</span></label><input id="tl" name="time_limit_min" type="number" min={1} defaultValue={exam.time_limit_min ?? ""} /></div>
          <div><label htmlFor="ma">Attempts allowed <span className="hint">0 = unlimited; highest score counts</span></label><input id="ma" name="max_attempts" type="number" min={0} defaultValue={exam.max_attempts} /></div>
          <div><label className="inline" style={{ marginTop: "2rem" }}><input type="checkbox" name="allow_late" defaultChecked={!!exam.allow_late} /> Accept late submissions (marked late)</label></div>
        </div>

        <h3>Delivery</h3>
        <label className="inline"><input type="checkbox" name="shuffle_questions" defaultChecked={!!exam.shuffle_questions} /> Shuffle question order for each student</label>
        <label className="inline"><input type="checkbox" name="shuffle_options" defaultChecked={!!exam.shuffle_options} /> Shuffle answer choices</label>
        <label className="inline"><input type="checkbox" name="one_at_a_time" defaultChecked={!!exam.one_at_a_time} /> Show one question at a time</label>
        <label className="inline"><input type="checkbox" name="lock_backtrack" defaultChecked={!!exam.lock_backtrack} /> Lock questions after answering (no going back; needs one-at-a-time)</label>

        <h3>Feedback to students</h3>
        <div className="grid two">
          <div>
            <label htmlFor="fm">When students see scores and feedback</label>
            <select id="fm" name="feedback_mode" defaultValue={exam.feedback_mode}>
              <option value="immediate">Right after submitting (best for practice quizzes)</option>
              <option value="after_due">After the due/close date (best for exams)</option>
              <option value="never">Never (only you see scores)</option>
            </select>
          </div>
          <div><label className="inline" style={{ marginTop: "2rem" }}><input type="checkbox" name="show_correct" defaultChecked={!!exam.show_correct} /> Show correct answers and explanations with feedback</label></div>
        </div>

        <h3>Exam integrity</h3>
        <p className="hint">These work in any phone or computer browser. A browser can't stop a second device or someone helping in the room. See the README's “Limits” section.</p>
        <div className="grid two">
          <div>
            <label htmlFor="fp">When a student leaves the exam (switches tab or app, exits fullscreen)</label>
            <select id="fp" name="focus_policy" defaultValue={exam.focus_policy}>
              <option value="submit">Auto-submit the exam</option>
              <option value="log">Only log it for me</option>
              <option value="off">Do nothing</option>
            </select>
          </div>
          <div>
            <label htmlFor="fw">Warnings before auto-submit <span className="hint">0 = submit on the first time they leave</span></label>
            <input id="fw" name="focus_warnings" type="number" min={0} max={10} defaultValue={exam.focus_warnings} />
          </div>
        </div>
        <label className="inline"><input type="checkbox" name="require_fullscreen" defaultChecked={!!exam.require_fullscreen} /> Require fullscreen where the device supports it (Android and computers; iPhone browsers don't)</label>
        <label className="inline"><input type="checkbox" name="block_copy" defaultChecked={!!exam.block_copy} /> Block copy, paste, right-click, text selection and printing</label>
        <label className="inline"><input type="checkbox" name="require_pledge" defaultChecked={!!exam.require_pledge} /> Students must agree to an academic honesty statement before starting</label>

        <details style={{ marginTop: "0.75rem" }}>
          <summary>Safe Exam Browser (optional, for computer labs or iPads)</summary>
          <label className="inline"><input type="checkbox" name="require_lockdown" defaultChecked={!!exam.require_lockdown} /> Require Safe Exam Browser for this assessment</label>
          <p className="hint">
            Students on Windows, macOS or iPad install the free <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer">Safe Exam Browser</a>, then open the start link below.
            The server only lets them in if SEB proves it's running this exam's configuration. SEB has no Android version, so phone users can't take SEB-required exams.
          </p>
          {exam.require_lockdown && exam.published ? (
            <div className="notice">
              <div>Start link for students: <code style={{ wordBreak: "break-all" }}>{sebLink}</code></div>
              <div>Config file: <a href={`/exams/${exam.id}/config.seb`}>download .seb</a></div>
              <div className="hint">Config Key: <code style={{ wordBreak: "break-all" }}>{ck}</code></div>
            </div>
          ) : <p className="hint">Tick the box, save, and publish to get the start link.</p>}
          <label htmlFor="qp">Quit password <span className="hint">{exam.seb_quit_hash ? "A password is set. Type a new one to replace it." : "Optional. Students need it to leave SEB early."}</span></label>
          <input id="qp" name="seb_quit_password" type="password" autoComplete="new-password" />
          {exam.seb_quit_hash ? <label className="inline"><input type="checkbox" name="seb_quit_clear" /> Remove quit password</label> : null}
          <label htmlFor="xk">Extra accepted keys <span className="hint">Optional. Paste Browser Exam Keys or Config Keys from a custom SEB config (64 hex characters each).</span></label>
          <textarea id="xk" name="seb_extra_keys" defaultValue={exam.seb_extra_keys} style={{ minHeight: "3rem" }} />
        </details>

        <div className="row" style={{ marginTop: "1rem" }}><button className="primary">Save settings</button></div>
        {!timed && <p className="hint">Tip: for take-home file assignments, set the integrity options to “Do nothing” so students can switch apps to find their file.</p>}
      </form>

      {/* ---------- Assign ---------- */}
      <form action={setAssignees} className="card">
        <input type="hidden" name="exam_id" value={exam.id} />
        <h2 style={{ marginTop: 0 }}>Assign to</h2>
        <label className="inline"><input type="radio" name="assign_all" value="1" defaultChecked={!!exam.assign_all} /> Every student in the course ({students.length})</label>
        <label className="inline"><input type="radio" name="assign_all" value="0" defaultChecked={!exam.assign_all} /> Only these students:</label>
        <div style={{ paddingLeft: "1.5rem", maxHeight: 260, overflow: "auto" }}>
          {students.length === 0 && <p className="muted">No students tagged yet. <Link href={`/courses/${exam.course_id}/people`}>Tag students</Link></p>}
          {students.map((s: any) => (
            <label key={s.id} className="inline"><input type="checkbox" name="user_id" value={s.id} defaultChecked={assigned.includes(s.id)} /> {s.name} <span className="muted">{s.email}</span></label>
          ))}
        </div>
        <button className="primary" style={{ marginTop: "0.75rem" }}>Save assignment</button>
      </form>

      <form action={deleteExam} className="card">
        <input type="hidden" name="exam_id" value={exam.id} />
        <ConfirmButton className="danger" message="Delete this assessment and every submission? This cannot be undone.">Delete this assessment and all its submissions</ConfirmButton>
      </form>
    </main>
  );
}
