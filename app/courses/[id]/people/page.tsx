import { notFound } from "next/navigation";
import { allDocs, getMany, getById, where } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { tagUsers, untagUser } from "../../../actions";
import CourseTabs from "@/components/CourseTabs";

export default async function People({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const { q = "" } = await searchParams;
  const course = await getById("courses", id);
  if (!course) notFound();
  const me = await requireTeacher(course.id);
  const enr = await where("enrollments", ["course_id", "==", course.id]);
  const byId = await getMany<any>("users", enr.map((e: any) => e.user_id));
  // The tagging list reads user accounts only when the teacher searches, to save free-tier reads.
  const users: any[] = q ? await allDocs("users", 2000) : [];
  const members = enr
    .map((e: any) => ({ ...byId.get(e.user_id), id: e.user_id, role: e.role }))
    .filter((m: any) => m.email)
    .sort((a: any, b: any) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "teacher" ? -1 : 1));
  const enrolled = new Set(enr.map((e: any) => e.user_id));
  const needle = q.toLowerCase();
  const others = users
    .filter((u: any) => !enrolled.has(u.id) && (!needle || u.name.toLowerCase().includes(needle) || u.email.includes(needle)))
    .sort((a: any, b: any) => a.name.localeCompare(b.name))
    .slice(0, 100);
  return (
    <main className="wrap">
      <CourseTabs course={course} active="people" teacher />
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Tag users as students</h2>
        <p className="muted">Students need an account first (they can sign up at the login page). Then tag them here.</p>
        <form method="get" className="row" style={{ margin: "0.5rem 0" }}>
          <input name="q" type="text" defaultValue={q} placeholder="Search name or email" style={{ flex: "1 1 200px" }} />
          <button>Search</button>
        </form>
        <form action={tagUsers}>
          <input type="hidden" name="course_id" value={course.id} />
          {!q ? <p className="muted">Search by name or email to find accounts, or paste emails below.</p> : others.length === 0 ? <p className="muted">No untagged users match.</p> : (
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: "0 0.75rem" }}>
              {others.map((o: any) => (
                <label key={o.id} className="inline"><input type="checkbox" name="user_id" value={o.id} /> {o.name} <span className="muted">{o.email}</span></label>
              ))}
            </div>
          )}
          <label htmlFor="emails">Or paste emails <span className="hint">Separated by commas, spaces or new lines</span></label>
          <textarea id="emails" name="emails" style={{ minHeight: "4rem" }} />
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <select name="role" style={{ width: "auto" }}>
              <option value="student">Tag as student</option>
              <option value="teacher">Add as co-teacher</option>
            </select>
            <button className="primary">Save</button>
          </div>
        </form>
      </div>
      <div className="card table-wrap">
        <h2 style={{ marginTop: 0 }}>Members ({members.length})</h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {members.map((m: any) => (
              <tr key={m.id}>
                <td>{m.name}</td><td>{m.email}</td>
                <td><span className={`badge ${m.role === "teacher" ? "accent" : ""}`}>{m.role}</span></td>
                <td>{m.id !== me.id && (
                  <form action={untagUser}>
                    <input type="hidden" name="course_id" value={course.id} />
                    <input type="hidden" name="user_id" value={m.id} />
                    <button className="small danger">Remove</button>
                  </form>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
