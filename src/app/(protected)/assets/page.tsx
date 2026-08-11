import { AssetIdentityWorkspace } from "@/components/assets/asset-identity-workspace";
import { loadAssetWorkspaceAction } from "@/lib/assets/actions";
import { requireRole } from "@/lib/auth/session";
import { listFirewalls } from "@/lib/db";

export default async function AssetIdentityPage() {
  const user = await requireRole(["network_admin", "help_desk", "telecom", "fuel"]);
  const [initialData, firewalls] = await Promise.all([
    loadAssetWorkspaceAction(),
    Promise.resolve(listFirewalls())
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asset Identity Manager</h1>
        <p className="text-[var(--muted-foreground)]">
          Search cached device identities across sites to find last-known IP, MAC, and switch port without dispatching a
          technician.
        </p>
      </div>
      <AssetIdentityWorkspace user={user} firewalls={firewalls} initialData={initialData} />
    </div>
  );
}
