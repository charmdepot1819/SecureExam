import AuthForm from "@/components/AuthForm";
import { register } from "../actions";
import { get } from "@/lib/db";

export default async function Register({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const first = !get("SELECT 1 FROM users LIMIT 1");
  return (
    <main className="wrap narrow">
      <p style={{ fontWeight: 700, fontSize: "1.2rem", marginTop: "2rem" }}>Exam Online</p>
      {first && <div className="notice">This is the first account, so it will be an educator account.</div>}
      <AuthForm mode="register" action={register} next={next} />
    </main>
  );
}
