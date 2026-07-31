import { PoeResetWorkspace } from "@/components/poe-reset-workspace";
import { requireRole } from "@/lib/auth/session";
import { listAllowedOuis, listFirewalls } from "@/lib/db";

export default async function PoeResetPage() {
  const user = await requireRole(["network_admin", "help_desk", "telecom", "fuel"]);
  const firewalls = listFirewalls();
  const canChooseOuiPolicy =
    user.roles.includes("network_admin") || user.roles.includes("help_desk");
  const teamRole = user.roles.includes("telecom") ? "telecom" : user.roles.includes("fuel") ? "fuel" : "telecom";
  const allowedOuis = listAllowedOuis(canChooseOuiPolicy ? undefined : teamRole);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">POE reset</h1>
        <p className="text-[var(--muted-foreground)]">
          Load managed FortiSwitch ports from the FortiGate, verify the device MAC OUI, then reset PoE in one click.
        </p>
      </div>
      {allowedOuis.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No approved OUIs are configured for your team yet. A network admin must add OUI allow-list entries in Admin
          before PoE reset is permitted.
        </p>
      ) : null}
      <PoeResetWorkspace user={user} firewalls={firewalls} />
    </div>
  );
}
