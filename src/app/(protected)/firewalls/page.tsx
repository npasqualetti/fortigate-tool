import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FirewallOverviewTable } from "@/components/firewall-overview-table";
import { requireRole } from "@/lib/auth/session";
import { listFirewalls, writeAudit } from "@/lib/db";
import { toPublicFirewall } from "@/lib/fortinet/overview";

export default async function FirewallsPage() {
  const user = await requireRole(["network_admin", "help_desk", "telecom", "fuel"]);
  const firewalls = listFirewalls();

  writeAudit({
    username: user.username,
    action: "firewall.overview.list",
    targetType: "firewall",
    targetId: null,
    status: "success",
    details: `Viewed ${firewalls.length} configured firewalls.`
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Firewall overview</h1>
        <p className="text-[var(--muted-foreground)]">
          Condensed read-only inventory, Fortinet API health, interface status, and entry points for the Help Desk.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Device inventory</CardTitle>
          <CardDescription>
            Live fields are pulled from Fortinet APIs when an API token is configured. Offline devices stay visible with their
            stored inventory values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FirewallOverviewTable firewalls={firewalls.map(toPublicFirewall)} />
        </CardContent>
      </Card>
    </div>
  );
}
