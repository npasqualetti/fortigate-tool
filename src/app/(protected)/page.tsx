import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/types";

export default async function DashboardPage() {
  const user = await requireUser();
  const roleLabels = user.roles.map((role) => ROLE_LABELS[role]);
  const canReset =
    user.roles.includes("telecom") ||
    user.roles.includes("fuel") ||
    user.roles.includes("network_admin") ||
    user.roles.includes("help_desk");
  const canAdmin = user.roles.includes("network_admin");
  const canViewFirewalls =
    user.roles.includes("help_desk") ||
    user.roles.includes("telecom") ||
    user.roles.includes("fuel") ||
    user.roles.includes("network_admin");
  const canUseAssets = canViewFirewalls;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-lg text-[var(--muted-foreground)]">
          Fortinet RBAC is an internal console for approved teams to work with FortiGate firewalls. Sign-in uses
          Active Directory; every action is scoped to your assigned role and recorded in the audit log.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your access</h2>
        <p className="text-[var(--muted-foreground)]">
          Signed in as <span className="font-medium text-foreground">{user.displayName}</span>
          {user.username !== user.displayName ? (
            <>
              {" "}
              (<span className="font-mono text-sm">{user.username}</span>)
            </>
          ) : null}
          . Your roles: {roleLabels.length ? roleLabels.join(", ") : "none assigned"}.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
          {canUseAssets ? (
            <li>
              <Link href="/assets" className="text-[var(--primary)] underline-offset-4 hover:underline">
                Asset Identity Manager
              </Link>{" "}
              — search cached MAC/IP/switch-port history across sites (90-day retention).
            </li>
          ) : null}
          {canViewFirewalls ? (
            <li>
              <Link href="/firewalls" className="text-[var(--primary)] underline-offset-4 hover:underline">
                Firewall overview
              </Link>{" "}
              — read-only status, interfaces, and live health for configured devices.
            </li>
          ) : (
            <li>Firewall overview is not available for your role.</li>
          )}
          {canReset ? (
            <li>
              <Link href="/poe-reset" className="text-[var(--primary)] underline-offset-4 hover:underline">
                POE reset
              </Link>{" "}
              — reset switch ports when the connected device&apos;s MAC OUI is on your team&apos;s approved list.
            </li>
          ) : (
            <li>POE reset is limited to Help Desk, Telecom, Fuel, and Network Admin roles.</li>
          )}
          {canAdmin ? (
            <li>
              <Link href="/admin" className="text-[var(--primary)] underline-offset-4 hover:underline">
                Admin
              </Link>{" "}
              — manage sites, firewalls, AD group mappings, OUI policies, and review audit history.
            </li>
          ) : (
            <li>Administration is limited to Network Admin.</li>
          )}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ol className="list-decimal space-y-4 pl-5 text-[var(--muted-foreground)]">
          <li>
            <span className="font-medium text-foreground">Sign in with AD.</span> Your directory groups are mapped to
            application roles (Network Admin, Help Desk, Telecom, or Fuel). If no mapping matches, you cannot use the
            app.
          </li>
          <li>
            <span className="font-medium text-foreground">Work against registered firewalls.</span> Network Admins add
            sites and FortiGate records (IP, API token, TLS settings). All other pages use that inventory.
          </li>
          <li>
            <span className="font-medium text-foreground">FortiGate APIs, not direct CLI.</span> The app calls FortiOS
            REST endpoints on your behalf—status, interfaces, learned MACs from network ARP and DHCP, and (where
            configured) switch-controller actions.
          </li>
          <li>
            <span className="font-medium text-foreground">OUI checks on sensitive actions.</span> POE reset is allowed
            only when the port&apos;s learned or entered MAC matches an OUI on the Telecom or Fuel allow list. Network
            Admins and Help Desk can run resets under either team policy.
          </li>
          <li>
            <span className="font-medium text-foreground">Audit trail.</span> Logins, denials, resets, and admin changes
            are stored locally (30-day retention) for compliance and troubleshooting.
          </li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Areas of the app</h2>

        <div className="space-y-2 border-l-2 border-[var(--border)] pl-4">
          <h3 className="font-semibold">Firewall overview</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            Searchable table of all configured FortiGates with live hostname, FortiOS version, uptime, CPU, and memory.
            Rows refresh while visible on screen. Click a firewall for interface detail and learned device counts. Help
            Desk and operational roles use this for triage without changing configuration.
          </p>
        </div>

        <div className="space-y-2 border-l-2 border-[var(--border)] pl-4">
          <h3 className="font-semibold">POE reset &amp; device finder</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            Pick a firewall and port, optionally confirm the MAC, then reset PoE if the OUI is approved. The device
            finder searches learned MACs from the FortiGate network ARP and DHCP tables—useful before a reset or to
            verify a handset is on the network. FortiSwitch-managed PoE requires switch-controller support on the
            firewall; many sites use FortiGate-only discovery even when PoE hardware is separate.
          </p>
        </div>

        <div className="space-y-2 border-l-2 border-[var(--border)] pl-4">
          <h3 className="font-semibold">Administration</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            Network Admins maintain AD group-to-role mappings, per-team OUI lists, site numbers, firewall credentials,
            and bulk CSV import. Bootstrap admin exists for first install; production access should be AD-only after
            mappings are in place.
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-[var(--border)] bg-slate-50/80 p-4 text-sm text-[var(--muted-foreground)]">
        <h2 className="text-base font-semibold text-foreground">Deployment note</h2>
        <p>
          This instance is intended for offline or air-gapped Windows servers: the app bundles Node, uses a local SQLite
          database, and talks to FortiGates on your internal network only. Use the navigation bar above to open a
          section; role badges in the corner reflect your current permissions.
        </p>
      </section>
    </div>
  );
}
