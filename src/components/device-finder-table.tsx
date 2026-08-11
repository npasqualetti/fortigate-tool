"use client";

import { useMemo, useState } from "react";
import { usePingMonitor, type PingMonitorTarget } from "@/components/ping-monitor-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableTable,
  ResizableTableElement,
  ResizableTh,
  resizableTdClassName
} from "@/components/ui/resizable-table";
import { TablePagination } from "@/components/ui/table-pagination";
import type { ResizableColumnDef } from "@/hooks/use-resizable-table-columns";
import { useTablePagination } from "@/hooks/use-table-pagination";
import { deviceRowId, isPingableIpv4 } from "@/lib/ping-utils";

const DEVICE_FINDER_COLUMNS: ResizableColumnDef[] = [
  { id: "select", defaultWidth: 48, minWidth: 44 },
  { id: "hostname", defaultWidth: 140, minWidth: 96 },
  { id: "interface", defaultWidth: 120, minWidth: 88 },
  { id: "switchPort", defaultWidth: 160, minWidth: 120 },
  { id: "ip", defaultWidth: 140, minWidth: 104 },
  { id: "mac", defaultWidth: 160, minWidth: 120 },
  { id: "oui", defaultWidth: 96, minWidth: 72 },
  { id: "ouiStatus", defaultWidth: 112, minWidth: 96 }
];

const DEVICE_FINDER_ACTION_COLUMN: ResizableColumnDef = {
  id: "action",
  defaultWidth: 112,
  minWidth: 96
};

export type FinderDevice = {
  interfaceName: string;
  ipAddress: string;
  macAddress: string;
  oui: string;
  deviceName?: string;
  switchPort?: string;
  ouiApproved?: boolean;
};

export function DeviceFinderTable({
  devices,
  onAutofill,
  cableTestForm,
  pageSize = 10
}: {
  devices: FinderDevice[];
  onAutofill?: (device: FinderDevice) => void;
  cableTestForm?: {
    firewallId: number;
    bulkAction: (payload: FormData) => void;
    bulkPending: boolean;
  };
  pageSize?: number;
}) {
  const { startPing, running } = usePingMonitor();
  const [filter, setFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const showSwitchPortColumn = useMemo(
    () => devices.some((device) => Boolean(device.switchPort || device.interfaceName.includes("/"))),
    [devices]
  );
  const showOuiStatusColumn = useMemo(
    () => devices.some((device) => device.ouiApproved !== undefined),
    [devices]
  );

  const filteredDevices = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return devices;
    }
    return devices.filter((device) => {
      const haystack = [
        device.deviceName,
        device.interfaceName,
        device.switchPort,
        device.ipAddress,
        device.macAddress,
        device.oui
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [devices, filter]);

  const { pageItems, setPage, ...pagination } = useTablePagination(filteredDevices, pageSize, filter);

  const filteredIds = useMemo(() => filteredDevices.map((device) => deviceRowId(device)), [filteredDevices]);
  const hasActionColumn = Boolean(onAutofill);
  const tableColumns = useMemo(() => {
    const columns = DEVICE_FINDER_COLUMNS.filter((column) => {
      if (column.id === "switchPort") {
        return showSwitchPortColumn;
      }
      if (column.id === "ouiStatus") {
        return showOuiStatusColumn;
      }
      return true;
    });
    return hasActionColumn ? [...columns, DEVICE_FINDER_ACTION_COLUMN] : columns;
  }, [hasActionColumn, showOuiStatusColumn, showSwitchPortColumn]);
  const tableId = onAutofill ? "device-finder-poe" : cableTestForm ? "device-finder-cable" : "device-finder";

  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  const selectedDevices = useMemo(
    () => devices.filter((device) => selectedIds.has(deviceRowId(device))),
    [devices, selectedIds]
  );

  const selectedPingable = useMemo(() => {
    return selectedDevices
      .filter((device) => isPingableIpv4(device.ipAddress))
      .map(
        (device): PingMonitorTarget => ({
          id: deviceRowId(device),
          ipAddress: device.ipAddress.trim(),
          interfaceName: device.interfaceName,
          macAddress: device.macAddress
        })
      );
  }, [selectedDevices]);

  const selectedInterfaces = useMemo(
    () => [...new Set(selectedDevices.map((device) => device.interfaceName).filter(Boolean))],
    [selectedDevices]
  );

  const toggleAllFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        for (const id of filteredIds) {
          next.delete(id);
        }
      } else {
        for (const id of filteredIds) {
          next.add(id);
        }
      }
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const columnIndex = (id: string) => tableColumns.findIndex((column) => column.id === id);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full space-y-1 sm:max-w-xs">
          <label htmlFor="deviceTableFilter" className="text-xs font-medium text-[var(--muted-foreground)]">
            Filter results
          </label>
          <Input
            id="deviceTableFilter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Hostname, interface, IP, MAC, or OUI"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={selectedPingable.length === 0}
            onClick={() => startPing(selectedPingable)}
          >
            {running ? "Update ping selection" : `Ping selected (${selectedPingable.length})`}
          </Button>
          {cableTestForm ? (
            <CableTestBulkForm
              firewallId={cableTestForm.firewallId}
              interfaceNames={selectedInterfaces}
              action={cableTestForm.bulkAction}
              pending={cableTestForm.bulkPending}
            />
          ) : null}
        </div>
      </div>

      <TablePagination {...pagination} onPageChange={setPage} />
      <ResizableTable
        tableId={tableId}
        columns={tableColumns}
        className="max-h-[28rem] w-full min-w-0 overflow-auto rounded-md border border-[var(--border)]"
      >
        <ResizableTableElement>
          <thead className="bg-slate-100">
            <tr>
              <ResizableTh columnIndex={columnIndex("select")} className="p-2">
                <input
                  type="checkbox"
                  aria-label="Select all filtered devices"
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                  disabled={filteredDevices.length === 0}
                />
              </ResizableTh>
              <ResizableTh columnIndex={columnIndex("hostname")} className="p-2">
                Hostname
              </ResizableTh>
              <ResizableTh columnIndex={columnIndex("interface")} className="p-2">
                Interface
              </ResizableTh>
              {showSwitchPortColumn ? (
                <ResizableTh columnIndex={columnIndex("switchPort")} className="p-2">
                  Switch / port
                </ResizableTh>
              ) : null}
              <ResizableTh columnIndex={columnIndex("ip")} className="p-2">
                IP address
              </ResizableTh>
              <ResizableTh columnIndex={columnIndex("mac")} className="p-2">
                MAC address
              </ResizableTh>
              <ResizableTh columnIndex={columnIndex("oui")} className="p-2">
                OUI
              </ResizableTh>
              {showOuiStatusColumn ? (
                <ResizableTh columnIndex={columnIndex("ouiStatus")} className="p-2">
                  OUI status
                </ResizableTh>
              ) : null}
              {hasActionColumn ? (
                <ResizableTh columnIndex={columnIndex("action")} className="p-2">
                  Manual reset
                </ResizableTh>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {filteredDevices.length === 0 ? (
              <tr>
                <td colSpan={tableColumns.length} className="p-4 text-center text-sm text-[var(--muted-foreground)]">
                  No devices match this filter.
                </td>
              </tr>
            ) : (
              pageItems.map((device) => {
                const id = deviceRowId(device);
                const pingable = isPingableIpv4(device.ipAddress);
                const switchPort =
                  device.switchPort || (device.interfaceName.includes("/") ? device.interfaceName : undefined);
                return (
                  <tr key={id} className="border-t border-[var(--border)]">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${device.ipAddress}`}
                        checked={selectedIds.has(id)}
                        onChange={() => toggleRow(id)}
                      />
                    </td>
                    <td className={resizableTdClassName("p-2")}>{device.deviceName || "—"}</td>
                    <td className={resizableTdClassName("p-2 font-mono text-xs")}>{device.interfaceName}</td>
                    {showSwitchPortColumn ? (
                      <td className={resizableTdClassName("p-2 font-mono text-xs")}>{switchPort || "—"}</td>
                    ) : null}
                    <td className={resizableTdClassName("font-mono")}>
                      {device.ipAddress}
                      {!pingable ? (
                        <span className="ml-2 text-xs text-[var(--muted-foreground)]">(not pingable)</span>
                      ) : null}
                    </td>
                    <td className={resizableTdClassName("font-mono text-xs")}>{device.macAddress}</td>
                    <td className={resizableTdClassName("font-mono")}>{device.oui}</td>
                    {showOuiStatusColumn ? (
                      <td className={resizableTdClassName("p-2")}>
                        {device.ouiApproved ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>
                        ) : (
                          <Badge variant="outline">Blocked</Badge>
                        )}
                      </td>
                    ) : null}
                    {onAutofill ? (
                      <td className={resizableTdClassName("p-2")}>
                        <Button type="button" size="sm" variant="outline" onClick={() => onAutofill(device)}>
                          Use MAC
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </ResizableTableElement>
      </ResizableTable>
    </div>
  );
}

function CableTestBulkForm({
  firewallId,
  interfaceNames,
  action,
  pending
}: {
  firewallId: number;
  interfaceNames: string[];
  action: (payload: FormData) => void;
  pending: boolean;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Run cable test on ${interfaceNames.length} interface${interfaceNames.length === 1 ? "" : "s"}?`
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="firewallId" value={firewallId} />
      {interfaceNames.map((interfaceName) => (
        <input key={interfaceName} type="hidden" name="interfaceName" value={interfaceName} />
      ))}
      <Button type="submit" variant="outline" disabled={pending || interfaceNames.length === 0}>
        {pending ? "Testing..." : `Cable test selected (${interfaceNames.length})`}
      </Button>
    </form>
  );
}
