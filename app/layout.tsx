import "./globals.css";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { currentUser, educatorMode } from "@/lib/auth";
import { logout, toggleMode } from "./actions";

export const metadata: Metadata = { title: "Exam Online", description: "Create, deliver and grade quizzes and exams." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const edu = await educatorMode(user);
  return (
    <html lang="en">
      <body>
        {user && (
          <header className="topbar" data-hide-in-exam>
            <Link href="/dashboard" className="brand">Exam Online</Link>
            {user.is_educator ? (
              <form action={toggleMode}>
                <input type="hidden" name="mode" value={edu ? "student" : "educator"} />
                <button className="small" title="Switch between teaching and learning views">
                  {edu ? "Educator mode: on" : "Educator mode: off"}
                </button>
              </form>
            ) : null}
            {edu && <Link href="/admin/users" className="btn small">Users</Link>}
            <span className="muted" style={{ fontSize: "0.85rem" }}>{user.name}</span>
            <form action={logout}><button className="small">Sign out</button></form>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
