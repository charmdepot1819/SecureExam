import { requireEducator } from "@/lib/auth";
import { createCourse } from "../../actions";

export default async function NewCourse() {
  await requireEducator();
  return (
    <main className="wrap narrow">
      <form action={createCourse} className="card">
        <h1>New course</h1>
        <label htmlFor="title">Course title</label>
        <input id="title" name="title" type="text" required placeholder="e.g. Anatomy & Physiology 1" />
        <label htmlFor="code">Course code <span className="hint">Optional</span></label>
        <input id="code" name="code" type="text" placeholder="e.g. BIO101-A" />
        <label htmlFor="description">Description <span className="hint">Optional</span></label>
        <textarea id="description" name="description" />
        <div style={{ marginTop: "1rem" }}><button className="primary">Create course</button></div>
      </form>
    </main>
  );
}
