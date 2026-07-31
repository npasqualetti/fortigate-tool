import { notFound } from "next/navigation";
import { FirewallWorkspace } from "@/components/firewall-workspace";
import { requireRole } from "@/lib/auth/session";
import { getFirewall, writeAudit } from "@/lib/db";
import { getFirewallWorkspaceSnapshot } from "@/lib/fortinet/firewall-workspace";
import { toPublicFirewall } from "@/lib/fortinet/overview";

export default async function FirewallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["network_admin", "help_desk", "telecom", "fuel"]);
  const { id } = await params;
  const firewall = getFirewall(Number(id));

  if (!firewall) {
    notFound();
  }

  const snapshot = await getFirewallWorkspaceSnapshot(firewall);

  writeAudit({
    username: user.username,
    action: "firewall.overview.view",
    targetType: "firewall",
    targetId: firewall.ipAddress,
    status: snapshot.error || snapshot.overview.error ? "error" : "success",
    details: "Opened firewall helpdesk workspace."
  });

  return (
    <FirewallWorkspace firewall={toPublicFirewall(firewall)} initialSnapshot={snapshot} />
  );
}
