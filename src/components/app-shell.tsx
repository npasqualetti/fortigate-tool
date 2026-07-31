import { AppShellClient } from "@/components/app-shell-client";
import { AppShellHeader } from "@/components/app-shell-header";
import { logoutAction } from "@/lib/auth/actions";
import { ROLE_LABELS, type SessionUser } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AppShellHeader displayName={user.displayName} logoutAction={logoutAction} />
      <AppShellClient>
        <main className="container min-w-0 py-8">{children}</main>
      </AppShellClient>
      <div className="fixed bottom-4 right-4 z-50 flex flex-wrap justify-end gap-2 rounded-xl border border-[var(--border)] bg-white/90 p-3 shadow-lg backdrop-blur">
        {user.roles.map((role) => (
          <Badge key={role} variant="secondary">
            {ROLE_LABELS[role]}
          </Badge>
        ))}
      </div>
    </div>
  );
}
