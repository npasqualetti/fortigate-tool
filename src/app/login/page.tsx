import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSessionUser } from "@/lib/auth/session";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
