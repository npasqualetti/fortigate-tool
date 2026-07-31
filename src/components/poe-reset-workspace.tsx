"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { loadPoeWorkspaceAction, poeResetAction } from "@/lib/fortinet/actions";
import type { PoePortRow } from "@/lib/fortinet/poe-workspace";
import type { Firewall, SessionUser } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableTable,
  ResizableTableElement,
  ResizableTh,
  resizableTdClassName
} from "@/components/ui/resizable-table";
import type { ResizableColumnDef } from "@/hooks/use-resizable-table-columns";
import { useTablePagination } from "@/hooks/use-table-pagination";
import { TablePagination } from "@/components/ui/table-pagination";
import { useActionStateToast } from "@/hooks/use-action-state-toast";

const PORT_TABLE_COLUMNS: ResizableColumnDef[] = [
  { id: "switch", defaultWidth: 160, minWidth: 120 },
  { id: "port", defaultWidth: 88, minWidth: 72 },
  { id: "mac", defaultWidth: 150, minWidth: 120 },
  { id: "ip", defaultWidth: 130, minWidth: 104 },
  { id: "oui", defaultWidth: 96, minWidth: 72 },
  { id: "status", defaultWidth: 120, minWidth: 96 },
  { id: "action", defaultWidth: 120, minWidth: 104 }
];

export function PoeResetWorkspace({
  user,
  firewalls
}: {
  user: SessionUser;
  firewalls: Array<Firewall & { siteNumber: string; siteName: string }>;
}) {
  const [workspaceState, loadWorkspaceAction, workspacePending] = useActionState(loadPoeWorkspaceAction, undefined);
  const [resetState, resetAction, resetPending] = useActionState(poeResetAction, undefined);
  const [firewallId, setFirewallId] = useState(() => String(firewalls[0]?.id ?? ""));
  const [firewallSearch, setFirewallSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [manualPort, setManualPort] = useState("");
  const [manualMac, setManualMac] = useState("");
  const [teamRole, setTeamRole] = useState<"telecom" | "fuel">("telecom");
  const isAdmin = user.roles.includes("network_admin");

  useActionStateToast(workspaceState, workspacePending);
  useActionStateToast(resetState, resetPending);

  const ports = workspaceState?.ports ?? [];
  const filteredPorts = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return ports.filter((port) => {
      if (approvedOnly && !port.ouiApproved) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [port.switchId, port.portName, port.portKey, port.macAddress, port.ipAddress, port.oui]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [ports, filter, approvedOnly]);

  const readyFirewalls = firewalls.filter((firewall) => Boolean(firewall.fmgDeviceName || firewall.apiTokenEncrypted));

  const filteredReadyFirewalls = useMemo(() => {
    const query = firewallSearch.trim().toLowerCase();
    if (!query) {
      return readyFirewalls;
    }
    return readyFirewalls.filter((firewall) =>
      [firewall.siteNumber, firewall.siteName, firewall.name, firewall.ipAddress, firewall.fmgDeviceName, firewall.hostname]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [readyFirewalls, firewallSearch]);

  const firewallSelectOptions = useMemo(() => {
    const selected = readyFirewalls.find((firewall) => String(firewall.id) === firewallId);
    const pool = firewallSearch.trim() ? filteredReadyFirewalls : filteredReadyFirewalls.slice(0, 10);
    if (selected && !pool.some((firewall) => firewall.id === selected.id)) {
      return [selected, ...pool];
    }
    return pool;
  }, [filteredReadyFirewalls, firewallId, firewallSearch, readyFirewalls]);

  const { pageItems: pagedPorts, setPage: setPortPage, ...portPagination } = useTablePagination(
    filteredPorts,
    10,
    `${filter}|${approvedOnly}`
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Select firewall</CardTitle>
          <CardDescription>
            PoE reset runs through FortiManager when configured. Ports come from managed FortiSwitch inventory on
            the FortiGate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={loadWorkspaceAction} className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="firewallSearch">Find firewall</Label>
              <Input
                id="firewallSearch"
                value={firewallSearch}
                onChange={(event) => setFirewallSearch(event.target.value)}
                placeholder={
                  readyFirewalls.length > 10
                    ? `Search ${readyFirewalls.length} firewalls by site, name, IP, or FMGR name…`
                    : "Search firewalls by site, name, IP, or FMGR name…"
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspaceFirewallId">Firewall</Label>
              <select
                id="workspaceFirewallId"
                name="firewallId"
                value={firewallId}
                onChange={(event) => setFirewallId(event.target.value)}
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                required
              >
                {firewallSelectOptions.map((firewall) => (
                  <option key={firewall.id} value={firewall.id}>
                    {firewall.siteNumber} - {firewall.name} ({firewall.ipAddress})
                  </option>
                ))}
              </select>
              {!firewallSearch.trim() && readyFirewalls.length > 10 ? (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Showing first 10 of {readyFirewalls.length}. Search to find a specific FortiGate.
                </p>
              ) : null}
            </div>
            {isAdmin ? (
              <div className="space-y-2">
                <Label htmlFor="teamRole">OUI policy</Label>
                <select
                  id="teamRole"
                  name="teamRole"
                  value={teamRole}
                  onChange={(event) => setTeamRole(event.target.value as "telecom" | "fuel")}
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                >
                  <option value="telecom">Telecom</option>
                  <option value="fuel">Fuel</option>
                </select>
              </div>
            ) : null}
            <Button className="self-end" type="submit" disabled={workspacePending || readyFirewalls.length === 0}>
              {workspacePending ? "Loading ports..." : "Load switch ports"}
            </Button>
          </form>
          {readyFirewalls.length === 0 ? (
            <p className="mt-3 text-sm text-red-700">
              No connected firewalls are available. Sync devices from FortiManager in Admin first.
            </p>
          ) : null}
          {workspaceState?.connectionLabel ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              Connection mode: {workspaceState.connectionLabel}
              {workspaceState.allowedOuis?.length
                ? ` · Allowed OUIs: ${workspaceState.allowedOuis.join(", ")}`
                : null}
            </p>
          ) : null}
          {workspaceState?.message ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">{workspaceState.message}</p>
          ) : null}
          {workspaceState?.error ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{workspaceState.error}</p>
          ) : null}
        </CardContent>
      </Card>

      {ports.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Choose a port</CardTitle>
            <CardDescription>
              Per-row Reset is enabled when the port has a learned MAC with an approved OUI. CMDB lists every port,
              but connected device MACs usually come from live switch telemetry or Device Inventory — use manual reset
              below when MAC is unknown.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full space-y-1 sm:max-w-sm">
                <Label htmlFor="portFilter">Filter ports</Label>
                <Input
                  id="portFilter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Switch serial, port, MAC, IP, or OUI"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={approvedOnly}
                  onChange={(event) => setApprovedOnly(event.target.checked)}
                />
                Show approved ports only
              </label>
            </div>

            <div className="space-y-4">
            <TablePagination {...portPagination} onPageChange={setPortPage} />
            <ResizableTable
              tableId="poe-port-workspace"
              columns={PORT_TABLE_COLUMNS}
              className="max-h-[32rem] w-full min-w-0 overflow-auto rounded-md border border-[var(--border)]"
            >
              <ResizableTableElement>
                <thead className="bg-slate-100">
                  <tr>
                    <ResizableTh columnIndex={0} className="p-2">
                      Switch
                    </ResizableTh>
                    <ResizableTh columnIndex={1} className="p-2">
                      Port
                    </ResizableTh>
                    <ResizableTh columnIndex={2} className="p-2">
                      MAC
                    </ResizableTh>
                    <ResizableTh columnIndex={3} className="p-2">
                      IP
                    </ResizableTh>
                    <ResizableTh columnIndex={4} className="p-2">
                      OUI
                    </ResizableTh>
                    <ResizableTh columnIndex={5} className="p-2">
                      Status
                    </ResizableTh>
                    <ResizableTh columnIndex={6} className="p-2">
                      Action
                    </ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {filteredPorts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-sm text-[var(--muted-foreground)]">
                        No ports match this filter.
                      </td>
                    </tr>
                  ) : (
                    pagedPorts.map((port) => (
                      <PoePortRowActions
                        key={port.portKey}
                        port={port}
                        firewallId={firewallId}
                        isAdmin={isAdmin}
                        teamRole={teamRole}
                        resetAction={resetAction}
                        resetPending={resetPending}
                        lastResetPort={resetState?.portKey}
                        onUseManual={(portKey) => {
                          setManualPort(portKey);
                          setManualMac("");
                          document.getElementById("manualPort")?.scrollIntoView({ behavior: "smooth", block: "center" });
                          document.getElementById("manualPort")?.focus();
                        }}
                      />
                    ))
                  )}
                </tbody>
              </ResizableTableElement>
            </ResizableTable>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>3. Manual reset</CardTitle>
          <CardDescription>
            Use this when you already know the switch serial and port, for example{" "}
            <span className="font-mono">S108FFTV21013920/port8</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={resetAction}
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              if (!window.confirm("Reset PoE on this port? The connected device will briefly lose power.")) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="firewallId" value={firewallId} />
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="manualPort">Port</Label>
              <Input
                id="manualPort"
                name="portName"
                value={manualPort}
                onChange={(event) => setManualPort(event.target.value)}
                placeholder="SwitchSerial/port8"
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="manualMac">Device MAC (required for OUI check)</Label>
              <Input
                id="manualMac"
                name="macAddress"
                value={manualMac}
                onChange={(event) => setManualMac(event.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF"
                required
              />
            </div>
            {isAdmin ? (
              <div className="space-y-2">
                <Label htmlFor="manualTeamRole">OUI policy</Label>
                <select
                  id="manualTeamRole"
                  name="teamRole"
                  value={teamRole}
                  onChange={(event) => setTeamRole(event.target.value as "telecom" | "fuel")}
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                >
                  <option value="telecom">Telecom</option>
                  <option value="fuel">Fuel</option>
                </select>
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" variant="destructive" disabled={resetPending}>
                {resetPending ? "Sending PoE reset..." : "Reset PoE manually"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {resetState?.message || resetState?.error ? (
        <Card className={resetState.error ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}>
          <CardContent className="space-y-2 pt-6 text-sm">
            {resetState.message ? <p className="text-green-900">{resetState.message}</p> : null}
            {resetState.error ? <p className="text-red-900">{resetState.error}</p> : null}
            {resetState.method ? (
              <p className="text-[var(--muted-foreground)]">
                Method: {resetState.method}
                {resetState.command ? (
                  <>
                    {" "}
                    · <span className="font-mono">{resetState.command}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PoePortRowActions({
  port,
  firewallId,
  isAdmin,
  teamRole,
  resetAction,
  resetPending,
  lastResetPort,
  onUseManual
}: {
  port: PoePortRow;
  firewallId: string;
  isAdmin: boolean;
  teamRole: "telecom" | "fuel";
  resetAction: (payload: FormData) => void;
  resetPending: boolean;
  lastResetPort?: string;
  onUseManual: (portKey: string) => void;
}) {
  const canReset = port.ouiApproved;
  const justReset = lastResetPort === port.portKey && !resetPending;
  const resetBlockedReason = !port.macAddress
    ? "No MAC learned"
    : !port.ouiApproved
      ? "OUI not approved"
      : null;

  return (
    <tr className="border-t border-[var(--border)]">
      <td className={resizableTdClassName("p-2 font-mono text-xs")}>{port.switchId}</td>
      <td className={resizableTdClassName("p-2 font-mono text-xs")}>{port.portName}</td>
      <td className={resizableTdClassName("font-mono text-xs")}>{port.macAddress || "—"}</td>
      <td className={resizableTdClassName("font-mono text-xs")}>{port.ipAddress || "—"}</td>
      <td className={resizableTdClassName("font-mono text-xs")}>{port.oui || "—"}</td>
      <td className={resizableTdClassName("p-2")}>
        {port.ouiApproved ? (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>
        ) : port.macAddress ? (
          <Badge variant="outline">OUI blocked</Badge>
        ) : (
          <Badge variant="outline">MAC unknown</Badge>
        )}
        {justReset ? <span className="ml-2 text-xs text-green-700">Sent</span> : null}
      </td>
      <td className={resizableTdClassName("p-2")}>
        {canReset ? (
          <form
            action={resetAction}
            onSubmit={(event) => {
              if (!port.macAddress) {
                event.preventDefault();
                window.alert("Enter the device MAC in the manual reset section when the port MAC is unknown.");
                return;
              }
              if (!window.confirm(`Reset PoE on ${port.portKey}?`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="firewallId" value={firewallId} />
            <input type="hidden" name="portName" value={port.portKey} />
            <input type="hidden" name="macAddress" value={port.macAddress || ""} />
            {isAdmin ? <input type="hidden" name="teamRole" value={teamRole} /> : null}
            <Button type="submit" size="sm" variant="destructive" disabled={resetPending || !canReset}>
              {resetPending ? "..." : "Reset"}
            </Button>
          </form>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-[var(--muted-foreground)]">{resetBlockedReason}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => onUseManual(port.portKey)}>
              Manual reset
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
