import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/change-password-form";
import { getSessionUser } from "@/lib/auth/session";

export default async function ChangePasswordPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  if (user.authProvider !== "local" || !user.mustChangePassword) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <ChangePasswordForm />
    </main>
  );
}
