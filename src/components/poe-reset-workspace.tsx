"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { DeviceFinderTable, type FinderDevice } from "@/components/device-finder-table";
import { usePingMonitor, type PingMonitorTarget } from "@/components/ping-monitor-provider";
import { isPingableIpv4 } from "@/lib/ping-utils";

const PORT_TABLE_COLUMNS: ResizableColumnDef[] = [
  { id: "select", defaultWidth: 48, minWidth: 44 },
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
  firewalls: Firewall[];
}) {
  const [workspaceState, loadWorkspaceAction, workspacePending] = useActionState(loadPoeWorkspaceAction, undefined);
  const [resetState, resetAction, resetPending] = useActionState(poeResetAction, undefined);
  const [firewallId, setFirewallId] = useState(() => String(firewalls[0]?.id ?? ""));
  const [filter, setFilter] = useState("");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [manualPort, setManualPort] = useState("");
  const [manualMac, setManualMac] = useState("");
  const [selectedPortKeys, setSelectedPortKeys] = useState<Set<string>>(new Set());
  const { startPing, running: pingRunning } = usePingMonitor();
  const canChooseOuiPolicy =
    user.roles.includes("network_admin") || user.roles.includes("help_desk");
  const isTelecom = user.roles.includes("telecom");
  const isFuel = user.roles.includes("fuel");
  const [teamRole, setTeamRole] = useState<"telecom" | "fuel">(() => {
    if (canChooseOuiPolicy) {
      return "telecom";
    }
    if (isTelecom) {
      return "telecom";
    }
    if (isFuel) {
      return "fuel";
    }
    return "telecom";
  });

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

  const { pageItems: pagedPorts, setPage: setPortPage, ...portPagination } = useTablePagination(
    filteredPorts,
    10,
    `${filter}|${approvedOnly}`
  );

  const filteredPortKeys = useMemo(() => filteredPorts.map((port) => port.portKey), [filteredPorts]);
  const allFilteredPortsSelected =
    filteredPortKeys.length > 0 && filteredPortKeys.every((portKey) => selectedPortKeys.has(portKey));

  const selectedPingablePorts = useMemo(() => {
    return ports
      .filter((port) => selectedPortKeys.has(port.portKey) && port.ipAddress && isPingableIpv4(port.ipAddress))
      .map(
        (port): PingMonitorTarget => ({
          id: port.portKey,
          ipAddress: port.ipAddress!.trim(),
          interfaceName: port.portKey,
          macAddress: port.macAddress || ""
        })
      );
  }, [ports, selectedPortKeys]);

  const toggleAllFilteredPorts = () => {
    setSelectedPortKeys((current) => {
      const next = new Set(current);
      if (allFilteredPortsSelected) {
        for (const portKey of filteredPortKeys) {
          next.delete(portKey);
        }
      } else {
        for (const portKey of filteredPortKeys) {
          next.add(portKey);
        }
      }
      return next;
    });
  };

  const togglePortSelection = (portKey: string) => {
    setSelectedPortKeys((current) => {
      const next = new Set(current);
      if (next.has(portKey)) {
        next.delete(portKey);
      } else {
        next.add(portKey);
      }
      return next;
    });
  };

  const learnedDevices = workspaceState?.learnedDevices ?? [];
  const learnedDeviceRows: FinderDevice[] = useMemo(
    () =>
      learnedDevices.map((device) => ({
        interfaceName: device.interfaceName,
        ipAddress: device.ipAddress,
        macAddress: device.macAddress,
        deviceName: device.deviceName,
        oui: device.oui,
        ouiApproved: device.ouiApproved,
        switchPort: device.switchPort
      })),
    [learnedDevices]
  );

  const workspaceLoaded = Boolean(workspaceState && !workspaceState.error && workspaceState.learnedDevices !== undefined);

  const fillManualResetFromDevice = (device: FinderDevice) => {
    setManualMac(device.macAddress);
    const portKey = device.switchPort || (device.interfaceName.includes("/") ? device.interfaceName : "");
    if (portKey) {
      setManualPort(portKey);
    }
    document.getElementById("manualMac")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("manualMac")?.focus();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Select firewall</CardTitle>
          <CardDescription>
            PoE reset runs through FortiManager when configured. Ports come from managed FortiSwitch inventory on
            the FortiGate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={loadWorkspaceAction} className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
            <SearchableFirewallSelect
              firewalls={readyFirewalls}
              value={firewallId}
              onChange={setFirewallId}
              disabled={readyFirewalls.length === 0}
            />
            <OuiPolicySelect
              id="teamRole"
              value={teamRole}
              onChange={setTeamRole}
              canChooseOuiPolicy={canChooseOuiPolicy}
              isTelecom={isTelecom}
              isFuel={isFuel}
            />
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
            <CardTitle>Choose a port</CardTitle>
            <CardDescription>
              Match DHCP/ARP devices to ports using Device Inventory and switch telemetry. Rows with a learned MAC show
              OUI approval status; use Manual reset when MAC is still unknown.
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
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={selectedPingablePorts.length === 0}
                  onClick={() => startPing(selectedPingablePorts)}
                >
                  {pingRunning ? "Update ping selection" : `Ping selected (${selectedPingablePorts.length})`}
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approvedOnly}
                    onChange={(event) => setApprovedOnly(event.target.checked)}
                  />
                  Show approved ports only
                </label>
              </div>
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
                      <input
                        type="checkbox"
                        aria-label="Select all filtered ports"
                        checked={allFilteredPortsSelected}
                        onChange={toggleAllFilteredPorts}
                        disabled={filteredPorts.length === 0}
                      />
                    </ResizableTh>
                    <ResizableTh columnIndex={1} className="p-2">
                      Switch
                    </ResizableTh>
                    <ResizableTh columnIndex={2} className="p-2">
                      Port
                    </ResizableTh>
                    <ResizableTh columnIndex={3} className="p-2">
                      MAC
                    </ResizableTh>
                    <ResizableTh columnIndex={4} className="p-2">
                      IP
                    </ResizableTh>
                    <ResizableTh columnIndex={5} className="p-2">
                      OUI
                    </ResizableTh>
                    <ResizableTh columnIndex={6} className="p-2">
                      Status
                    </ResizableTh>
                    <ResizableTh columnIndex={7} className="p-2">
                      Action
                    </ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {filteredPorts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-sm text-[var(--muted-foreground)]">
                        No ports match this filter.
                      </td>
                    </tr>
                  ) : (
                    pagedPorts.map((port) => (
                      <PoePortRowActions
                        key={port.portKey}
                        port={port}
                        firewallId={firewallId}
                        teamRole={teamRole}
                        resetAction={resetAction}
                        resetPending={resetPending}
                        lastResetPort={resetState?.portKey}
                        selected={selectedPortKeys.has(port.portKey)}
                        onToggleSelect={() => togglePortSelection(port.portKey)}
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

      {workspaceLoaded ? (
        <Card>
          <CardHeader>
            <CardTitle>DHCP / ARP devices</CardTitle>
            <CardDescription>
              Learned hosts from this FortiGate&apos;s ARP and DHCP tables. Use{" "}
              <span className="font-medium">Use MAC</span> to fill manual reset below, or select rows and{" "}
              <span className="font-medium">Ping selected</span> to ping their IP addresses from this app server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {learnedDeviceRows.length > 0 ? (
              <DeviceFinderTable devices={learnedDeviceRows} onAutofill={fillManualResetFromDevice} />
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                No ARP or DHCP entries were returned for this firewall.
              </p>
            )}
            {workspaceState?.learnedDiagnostics?.length ? (
              <LearnedDeviceDiagnostics diagnostics={workspaceState.learnedDiagnostics} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {workspaceLoaded ? (
        <Card>
          <CardHeader>
            <CardTitle>Manual reset</CardTitle>
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
              <OuiPolicySelect
                id="manualTeamRole"
                value={teamRole}
                onChange={setTeamRole}
                canChooseOuiPolicy={canChooseOuiPolicy}
                isTelecom={isTelecom}
                isFuel={isFuel}
              />
              <div className="md:col-span-2">
                <Button type="submit" variant="destructive" disabled={resetPending}>
                  {resetPending ? "Sending PoE reset..." : "Reset PoE manually"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

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

function OuiPolicySelect({
  id,
  value,
  onChange,
  canChooseOuiPolicy,
  isTelecom,
  isFuel
}: {
  id: string;
  value: "telecom" | "fuel";
  onChange: (role: "telecom" | "fuel") => void;
  canChooseOuiPolicy: boolean;
  isTelecom: boolean;
  isFuel: boolean;
}) {
  const telecomDisabled = !canChooseOuiPolicy && isFuel && !isTelecom;
  const fuelDisabled = !canChooseOuiPolicy && isTelecom;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>OUI policy</Label>
      <select
        id={id}
        name="teamRole"
        value={value}
        onChange={(event) => onChange(event.target.value as "telecom" | "fuel")}
        disabled={!canChooseOuiPolicy}
        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-[var(--muted-foreground)]"
      >
        <option value="telecom" disabled={telecomDisabled}>
          Telecom
        </option>
        <option value="fuel" disabled={fuelDisabled}>
          Fuel
        </option>
      </select>
    </div>
  );
}

function LearnedDeviceDiagnostics({
  diagnostics
}: {
  diagnostics: Array<{ path: string; records: number; devices: number; error?: string; note?: string }>;
}) {
  const summary = diagnostics
    .filter((entry) => !entry.error || entry.records > 0 || entry.devices > 0)
    .map((entry) => {
      const label = entry.note || entry.path.split("/").pop() || entry.path;
      if (entry.error) {
        return `${label}: unavailable`;
      }
      return `${label}: ${entry.devices || entry.records} device${(entry.devices || entry.records) === 1 ? "" : "s"}`;
    })
    .join(" · ");

  if (!summary) {
    return null;
  }

  return <p className="text-xs text-[var(--muted-foreground)]">Sources — {summary}</p>;
}

function formatFirewallLabel(firewall: Firewall) {
  return `${firewall.name} (${firewall.ipAddress})`;
}

function SearchableFirewallSelect({
  firewalls,
  value,
  onChange,
  disabled
}: {
  firewalls: Firewall[];
  value: string;
  onChange: (firewallId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = firewalls.find((firewall) => String(firewall.id) === value);

  const filteredFirewalls = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return firewalls;
    }
    return firewalls.filter((firewall) =>
      [
        firewall.name,
        firewall.ipAddress,
        firewall.fmgDeviceName,
        firewall.hostname
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [firewalls, search]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative space-y-2">
      <Label htmlFor="workspaceFirewallId">Firewall</Label>
      <input type="hidden" name="firewallId" value={value} required />
      <Button
        id="workspaceFirewallId"
        type="button"
        variant="outline"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="h-10 w-full justify-between font-normal"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate text-left">
          {selected ? formatFirewallLabel(selected) : disabled ? "No firewalls available" : "Select a firewall"}
        </span>
        <span aria-hidden className="ml-2 text-[var(--muted-foreground)]">
          {open ? "▴" : "▾"}
        </span>
      </Button>
      {open ? (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-[var(--border)] bg-white shadow-lg">
          <div className="border-b border-[var(--border)] p-2">
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search site, name, IP, or FGT…"
              aria-label="Search firewalls"
            />
          </div>
          <ul className="max-h-60 overflow-auto p-1" role="listbox">
            {filteredFirewalls.length === 0 ? (
              <li className="px-3 py-2 text-sm text-[var(--muted-foreground)]">No firewalls match this search.</li>
            ) : (
              filteredFirewalls.map((firewall) => {
                const id = String(firewall.id);
                const isSelected = id === value;
                return (
                  <li key={firewall.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={`w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-slate-100 ${
                        isSelected ? "bg-slate-100 font-medium" : ""
                      }`}
                      onClick={() => {
                        onChange(id);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      {formatFirewallLabel(firewall)}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PoePortRowActions({
  port,
  firewallId,
  teamRole,
  resetAction,
  resetPending,
  lastResetPort,
  selected,
  onToggleSelect,
  onUseManual
}: {
  port: PoePortRow;
  firewallId: string;
  teamRole: "telecom" | "fuel";
  resetAction: (payload: FormData) => void;
  resetPending: boolean;
  lastResetPort?: string;
  selected: boolean;
  onToggleSelect: () => void;
  onUseManual: (portKey: string) => void;
}) {
  const canReset = port.ouiApproved;
  const justReset = lastResetPort === port.portKey && !resetPending;
  const resetBlockedReason = !port.macAddress
    ? "No MAC learned"
    : !port.ouiApproved
      ? "OUI not approved"
      : null;
  const pingable = port.ipAddress ? isPingableIpv4(port.ipAddress) : false;

  return (
    <tr className="border-t border-[var(--border)]">
      <td className="p-2">
        <input
          type="checkbox"
          aria-label={`Select ${port.portKey}`}
          checked={selected}
          onChange={onToggleSelect}
        />
      </td>
      <td className={resizableTdClassName("p-2 font-mono text-xs")}>{port.switchId}</td>
      <td className={resizableTdClassName("p-2 font-mono text-xs")}>{port.portName}</td>
      <td className={resizableTdClassName("font-mono text-xs")}>{port.macAddress || "—"}</td>
      <td className={resizableTdClassName("font-mono text-xs")}>
        {port.ipAddress || "—"}
        {port.ipAddress && !pingable ? (
          <span className="ml-2 text-xs text-[var(--muted-foreground)]">(not pingable)</span>
        ) : null}
      </td>
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
            <input type="hidden" name="teamRole" value={teamRole} />
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
