import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) {
    redirect("/change-password");
  }
  return <AppShell user={user}>{children}</AppShell>;
}
