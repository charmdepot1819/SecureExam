import AuthForm from "@/components/AuthForm";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="wrap narrow">
      <p style={{ fontWeight: 700, fontSize: "1.2rem", marginTop: "2rem" }}>Exam Online</p>
      <AuthForm mode="login" next={next} />
    </main>
  );
}
