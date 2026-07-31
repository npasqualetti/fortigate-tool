"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  cableTestFirewallInterfacesAction,
  findDevicesByOuiAction,
  refreshFirewallWorkspaceAction
} from "@/lib/fortinet/actions";
import type { FirewallWorkspaceSnapshot } from "@/lib/fortinet/firewall-workspace";
import type { PublicFirewallRecord } from "@/lib/fortinet/overview";
import { CableTestResults } from "@/components/cable-test-results";
import { DeviceFinderTable } from "@/components/device-finder-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatOuiInput } from "@/lib/format-oui";
import { useActionStateToast, useCableTestResultToasts } from "@/hooks/use-action-state-toast";

function statusBadgeVariant(status: "up" | "down" | "unknown" | "online" | "offline" | "not_configured") {
  if (status === "up" || status === "online") {
    return "secondary" as const;
  }
  if (status === "down" || status === "offline") {
    return "destructive" as const;
  }
  return "outline" as const;
}

export function FirewallWorkspace({
  firewall,
  initialSnapshot
}: {
  firewall: PublicFirewallRecord;
  initialSnapshot: FirewallWorkspaceSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refreshState, refreshAction, refreshPending] = useActionState(refreshFirewallWorkspaceAction, undefined);
  const [finderState, finderAction, finderPending] = useActionState(findDevicesByOuiAction, undefined);
  const [bulkCableState, bulkCableAction, bulkCablePending] = useActionState(
    cableTestFirewallInterfacesAction,
    undefined
  );
  const [finderOui, setFinderOui] = useState("");

  const finderOuiComplete = useMemo(() => finderOui.replace(/[^a-fA-F0-9]/g, "").length >= 6, [finderOui]);
  const overview = snapshot.overview;
  const cableResults = bulkCableState?.results;

  useActionStateToast(refreshState, refreshPending);
  useActionStateToast(finderState, finderPending);
  useActionStateToast(bulkCableState, bulkCablePending);
  useCableTestResultToasts(cableResults, bulkCablePending);

  useEffect(() => {
    if (refreshState?.snapshot && !refreshPending) {
      setSnapshot(refreshState.snapshot);
    }
  }, [refreshState, refreshPending]);

  return (
    <div className="min-w-0 space-y-6">
      <div className="space-y-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/firewalls">&lt; Firewall overview</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{firewall.hostname || firewall.name}</h1>
            <p className="text-[var(--muted-foreground)]">
              {firewall.name} · {firewall.ipAddress}
              {firewall.fmgDeviceName ? ` · ${firewall.fmgDeviceName}` : ""}
            </p>
          </div>
          <form action={refreshAction}>
            <input type="hidden" name="firewallId" value={firewall.id} />
            <Button type="submit" variant="outline" disabled={refreshPending}>
              {refreshPending ? "Refreshing..." : "Refresh status"}
            </Button>
          </form>
        </div>
      </div>

      {snapshot.error || overview.error ? (
        <Card>
          <CardHeader>
            <CardTitle>Fortinet query issue</CardTitle>
            <CardDescription>{snapshot.error || overview.error}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="API status"
          value={overview.apiStatus === "online" ? "Online" : overview.apiStatus === "offline" ? "Offline" : "Not configured"}
          badge={overview.apiStatus}
        />
        <MetricCard title="CPU" value={overview.cpuUsage || "—"} />
        <MetricCard title="Memory" value={overview.memoryUsage || "—"} />
        <MetricCard title="Uptime" value={overview.uptime || "—"} subtitle={overview.fortiOsVersion} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>WAN links</CardTitle>
            <CardDescription>Broadband and cellular interface link state from FortiGate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.wanLinks.map((link) => (
              <div key={link.definition.interfaceName} className="rounded-md border border-[var(--border)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{link.definition.label}</p>
                    <p className="font-mono text-xs text-[var(--muted-foreground)]">{link.definition.interfaceName}</p>
                  </div>
                  <Badge variant={statusBadgeVariant(link.status)}>{link.status}</Badge>
                </div>
                <p className="mt-2 text-sm">Link: {link.speedDuplex}</p>
                {link.ip ? <p className="text-sm text-[var(--muted-foreground)]">IP: {link.ip}</p> : null}
                {link.error ? <p className="mt-1 text-sm text-red-700">{link.error}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ISP modem reachability</CardTitle>
            <CardDescription>
              Default gateway on {snapshot.ispGateway.interfaceName} (broadband path to the ISP).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {snapshot.ispGateway.gateway ? (
              <p>
                Gateway: <span className="font-mono">{snapshot.ispGateway.gateway}</span>
              </p>
            ) : null}
            {snapshot.ispGateway.ping ? (
              <p>
                FortiGate ping:{" "}
                <Badge variant={snapshot.ispGateway.ping.reachable ? "secondary" : "destructive"}>
                  {snapshot.ispGateway.ping.reachable ? "Reachable" : "Unreachable"}
                </Badge>
                {snapshot.ispGateway.ping.avgRttMs !== undefined ? (
                  <span className="ml-2 text-[var(--muted-foreground)]">~{snapshot.ispGateway.ping.avgRttMs} ms avg</span>
                ) : null}
              </p>
            ) : null}
            {snapshot.ispGateway.serverPing ? (
              <p className="text-[var(--muted-foreground)]">
                App server ping (fallback):{" "}
                {snapshot.ispGateway.serverPing.reachable
                  ? `reachable (${snapshot.ispGateway.serverPing.latencyMs ?? "?"} ms)`
                  : snapshot.ispGateway.serverPing.error || "unreachable"}
              </p>
            ) : null}
            {snapshot.ispGateway.error ? <p className="text-red-700">{snapshot.ispGateway.error}</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Find hosts</CardTitle>
          <CardDescription>
            Search learned ARP and DHCP entries, then run cable tests on each device&apos;s interface — same flow as
            POE reset, but for layer-1 diagnostics.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <section className="space-y-3 rounded-md border border-[var(--border)] p-4">
            <div>
              <h3 className="text-sm font-semibold">Device finder</h3>
              <p className="text-sm text-[var(--muted-foreground)]">
                Enter the first 6 hexadecimal MAC characters. Devices come from this firewall&apos;s ARP and DHCP tables.
              </p>
            </div>
            <form action={finderAction} className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
            <input type="hidden" name="firewallId" value={firewall.id} />
            <div className="space-y-2">
              <Label htmlFor="workspaceFinderOui">MAC OUI</Label>
              <Input
                id="workspaceFinderOui"
                name="ouiPrefix"
                value={finderOui}
                onChange={(event) => setFinderOui(formatOuiInput(event.target.value))}
                placeholder="CC:CC:CC"
                maxLength={8}
              />
            </div>
            <Button
              className="self-end"
              type="submit"
              name="intent"
              value="findOui"
              variant="outline"
              disabled={finderPending || !finderOuiComplete}
            >
              {finderPending ? "Searching..." : "Find devices"}
            </Button>
            <Button
              className="self-end"
              type="submit"
              name="intent"
              value="findAll"
              variant="outline"
              disabled={finderPending}
              formNoValidate
            >
              {finderPending ? "Searching..." : "Find all"}
            </Button>
          </form>
            {!finderOuiComplete ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Device finder by OUI starts after 6 hexadecimal characters, for example CC:CC:CC.
              </p>
            ) : null}
            {finderState?.devices?.length ? (
              <DeviceFinderTable
                devices={finderState.devices}
                cableTestForm={{
                  firewallId: firewall.id,
                  bulkAction: bulkCableAction,
                  bulkPending: bulkCablePending
                }}
              />
            ) : null}
          </section>
          <CableTestResults results={cableResults} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Device details</CardTitle>
          <CardDescription>Stored inventory and live identity from FortiGate.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>Admin name: {firewall.name}</p>
          <p>Hostname: {overview.hostname || firewall.hostname || "—"}</p>
          <p>Platform: {overview.platform || firewall.model || "—"}</p>
          <p>Serial: {overview.serialNumber || firewall.serialNumber || "—"}</p>
          <p>TLS: {firewall.verifyTls ? "Verify certificate" : "Skip verification"}</p>
          <p>Connection: {firewall.connectionLabel}</p>
          {firewall.fmgDeviceName ? <p>FortiManager device: {firewall.fmgDeviceName}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  badge
}: {
  title: string;
  value: string;
  subtitle?: string;
  badge?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-2xl">
          {value}
          {badge ? <Badge variant={statusBadgeVariant(badge as "online")}>{badge}</Badge> : null}
        </CardTitle>
        {subtitle ? <p className="text-xs text-[var(--muted-foreground)]">{subtitle}</p> : null}
      </CardHeader>
    </Card>
  );
}
