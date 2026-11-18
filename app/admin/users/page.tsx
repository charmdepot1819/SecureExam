import { all } from "@/lib/db";
import { requireEducator } from "@/lib/auth";
import { setEducator } from "../../actions";

export default async function Users() {
  const me = await requireEducator();
  const users = all("SELECT id, name, email, is_educator, created_at FROM users ORDER BY name");
  return (
    <main className="wrap">
      <h1>Users</h1>
      <p className="muted">Educators can create courses and switch Educator mode on. Everyone else uses the student view.</p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Educator</th></tr></thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td>
                <td>
                  {u.id === me.id ? <span className="badge accent">You</span> : (
                    <form action={setEducator}>
                      <input type="hidden" name="user_id" value={u.id} />
                      {u.is_educator ? null : <input type="hidden" name="value" value="1" />}
                      <button className="small">{u.is_educator ? "Remove educator" : "Make educator"}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
