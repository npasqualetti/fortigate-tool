"use client";

import { useMemo, useState } from "react";
import type { Firewall } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TablePagination } from "@/components/ui/table-pagination";
import {
  ResizableTable,
  ResizableTableElement,
  ResizableTh,
  resizableTdClassName
} from "@/components/ui/resizable-table";
import type { ResizableColumnDef } from "@/hooks/use-resizable-table-columns";
import { useTablePagination } from "@/hooks/use-table-pagination";

type SyncedDevice = Firewall;

const DEVICE_COLUMNS: ResizableColumnDef[] = [
  { id: "fmg", defaultWidth: 140, minWidth: 104 },
  { id: "name", defaultWidth: 160, minWidth: 120 },
  { id: "ip", defaultWidth: 120, minWidth: 96 },
  { id: "model", defaultWidth: 140, minWidth: 96 },
  { id: "serial", defaultWidth: 140, minWidth: 104 },
  { id: "adom", defaultWidth: 88, minWidth: 72 }
];

export function FortiManagerDeviceList({
  devices,
  configured,
  lastSyncedAt
}: {
  devices: SyncedDevice[];
  configured: boolean;
  lastSyncedAt: string | null;
}) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return devices;
    }
    return devices.filter((device) =>
      [
        device.fmgDeviceName,
        device.name,
        device.hostname,
        device.ipAddress,
        device.model,
        device.serialNumber,
        device.adom
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [devices, filter]);

  const { pageItems, setPage, ...pagination } = useTablePagination(filtered, 10, filter);

  if (!configured) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Save FortiManager connection settings, then use Sync to pull managed FortiGate devices into this app.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Synced FortiGate devices</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            {devices.length} device{devices.length === 1 ? "" : "s"} in the local inventory
            {lastSyncedAt ? ` · last sync ${new Date(lastSyncedAt).toLocaleString()}` : ""}.
            Use Sync above to refresh from FortiManager.
          </p>
        </div>
        <div className="w-full space-y-1 sm:max-w-xs">
          <Label htmlFor="fmgDeviceFilter">Filter</Label>
          <Input
            id="fmgDeviceFilter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Name, IP, serial, ADOM..."
          />
        </div>
      </div>

      {devices.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
          No devices synced yet. Click &quot;Sync all FortiGate devices&quot; to pull inventory from FortiManager.
        </p>
      ) : (
        <div className="space-y-2">
          <TablePagination {...pagination} onPageChange={setPage} />
          <ResizableTable
          tableId="admin-fmg-devices"
          columns={DEVICE_COLUMNS}
          className="max-h-[28rem] w-full min-w-0 overflow-auto rounded-md border border-[var(--border)]"
        >
          <ResizableTableElement>
            <thead className="bg-slate-100">
              <tr>
                <ResizableTh columnIndex={0} className="p-2">
                  FGT
                </ResizableTh>
                <ResizableTh columnIndex={1} className="p-2">
                  Hostname
                </ResizableTh>
                <ResizableTh columnIndex={2} className="p-2">
                  IP
                </ResizableTh>
                <ResizableTh columnIndex={3} className="p-2">
                  Model
                </ResizableTh>
                <ResizableTh columnIndex={4} className="p-2">
                  Serial
                </ResizableTh>
                <ResizableTh columnIndex={5} className="p-2">
                  ADOM
                </ResizableTh>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-sm text-[var(--muted-foreground)]">
                    No devices match this filter.
                  </td>
                </tr>
              ) : (
                pageItems.map((device) => (
                  <tr key={device.id} className="border-t border-[var(--border)]">
                    <td className={resizableTdClassName("p-2 font-mono text-xs")}>
                      {device.fmgDeviceName || "—"}
                    </td>
                    <td className={resizableTdClassName("p-2")}>{device.hostname || device.name}</td>
                    <td className={resizableTdClassName("p-2 font-mono text-xs")}>{device.ipAddress}</td>
                    <td className={resizableTdClassName("p-2 text-xs")}>{device.model || "—"}</td>
                    <td className={resizableTdClassName("p-2 font-mono text-xs")}>{device.serialNumber || "—"}</td>
                    <td className={resizableTdClassName("p-2 text-xs")}>{device.adom || "root"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </ResizableTableElement>
        </ResizableTable>
        </div>
      )}
    </div>
  );
}
