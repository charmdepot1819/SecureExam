import AuthForm from "@/components/AuthForm";
import { login } from "../actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="wrap narrow">
      <p style={{ fontWeight: 700, fontSize: "1.2rem", marginTop: "2rem" }}>Exam Online</p>
      <AuthForm mode="login" action={login} next={next} />
    </main>
  );
}
