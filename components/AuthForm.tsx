"use client";
import { useActionState } from "react";
import Link from "next/link";

export default function AuthForm({ mode, action, next }: { mode: "login" | "register"; action: any; next?: string }) {
  const [state, formAction, pending] = useActionState(action, null as any);
  return (
    <form action={formAction} className="card">
      <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
      <input type="hidden" name="next" value={next || ""} />
      {mode === "register" && (
        <>
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" type="text" autoComplete="name" required />
        </>
      )}
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" minLength={mode === "register" ? 8 : undefined}
        autoComplete={mode === "login" ? "current-password" : "new-password"} required />
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="primary" disabled={pending}>{mode === "login" ? "Sign in" : "Create account"}</button>
        {mode === "login" ? (
          <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
        ) : (
          <Link href="/login">I already have an account</Link>
        )}
      </div>
    </form>
  );
}
