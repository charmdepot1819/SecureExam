"use client";
import { useState } from "react";
import Link from "next/link";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile } from "firebase/auth";
import { clientAuth } from "@/lib/firebase-client";
import { establishSession } from "@/app/actions";

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "Email or password is incorrect.",
  "auth/email-already-in-use": "An account with that email already exists. Sign in instead.",
  "auth/weak-password": "Password must be at least 8 characters.",
  "auth/invalid-email": "Enter a valid email.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/network-request-failed": "Network problem. Check your connection.",
};

export default function AuthForm({ mode, next }: { mode: "login" | "register"; next?: string }) {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim();
    const password = String(f.get("password"));
    const name = String(f.get("name") || "").trim();
    try {
      const auth = clientAuth();
      if (mode === "register" && password.length < 8) throw { code: "auth/weak-password" };
      const cred = mode === "register"
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password);
      if (mode === "register" && name) await updateProfile(cred.user, { displayName: name });
      const r = await establishSession(await cred.user.getIdToken(), name || undefined);
      await signOut(auth); // the server session cookie is the source of truth from here on
      if (!r.ok) throw new Error(r.error);
      const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      window.location.assign(dest);
    } catch (err: any) {
      setError(MESSAGES[err?.code] || err?.message || "Something went wrong.");
      setPending(false);
    }
  }

  async function reset(e: React.MouseEvent) {
    e.preventDefault();
    const email = (document.getElementById("email") as HTMLInputElement)?.value.trim();
    if (!email) return setError("Type your email first, then tap “Forgot password”.");
    try {
      await sendPasswordResetEmail(clientAuth(), email);
      setInfo("If that email has an account, a reset link is on its way.");
    } catch (err: any) {
      setError(MESSAGES[err?.code] || "Could not send the reset email.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
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
      {error && <p className="error" role="alert">{error}</p>}
      {info && <p className="notice">{info}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="primary" disabled={pending}>{pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        {mode === "login" ? (
          <>
            <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
            <a href="#" onClick={reset}>Forgot password</a>
          </>
        ) : (
          <Link href="/login">I already have an account</Link>
        )}
      </div>
    </form>
  );
}
