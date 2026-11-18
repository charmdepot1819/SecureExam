import AuthForm from "@/components/AuthForm";
import { getById } from "@/lib/db";

export default async function Register({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const meta = await getById("meta", "app");
  return (
    <main className="wrap narrow">
      <p style={{ fontWeight: 700, fontSize: "1.2rem", marginTop: "2rem" }}>Exam Online</p>
      {!meta?.has_users && <div className="notice">This is the first account, so it will be an educator account.</div>}
      <AuthForm mode="register" next={next} />
    </main>
  );
}
