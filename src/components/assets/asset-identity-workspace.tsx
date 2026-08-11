"use client";

import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  beginAssetSyncAction,
  cancelAssetSyncAction,
  processAssetSyncBatchAction,
  searchAssetIdentitiesAction,
  type AssetSearchInitialData
} from "@/lib/assets/actions";
import type { AssetIdentityRecord, AssetInventoryStats } from "@/lib/assets/types";
import { usePingMonitor, type PingMonitorTarget } from "@/components/ping-monitor-provider";
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
import { TablePagination } from "@/components/ui/table-pagination";
import type { ResizableColumnDef } from "@/hooks/use-resizable-table-columns";
import { LocalTimestamp } from "@/components/local-timestamp";
import { useColumnVisibilityCookie } from "@/hooks/use-column-visibility-cookie";
import { showErrorToast, showSuccessToast } from "@/hooks/use-action-state-toast";
import { isPingableIpv4 } from "@/lib/ping-utils";
import type { Firewall, SessionUser } from "@/lib/types";

const ASSET_COLUMN_COOKIE = "asset-identity-visible-columns";

const ASSET_COLUMNS: ResizableColumnDef[] = [
  { id: "select", defaultWidth: 48, minWidth: 44 },
  { id: "firewall", defaultWidth: 140, minWidth: 104 },
  { id: "mac", defaultWidth: 150, minWidth: 120 },
  { id: "ip", defaultWidth: 120, minWidth: 96 },
  { id: "hostname", defaultWidth: 140, minWidth: 96 },
  { id: "switchPort", defaultWidth: 160, minWidth: 120 },
  { id: "interface", defaultWidth: 120, minWidth: 88 },
  { id: "oui", defaultWidth: 88, minWidth: 72 },
  { id: "status", defaultWidth: 88, minWidth: 72 },
  { id: "lastSeen", defaultWidth: 168, minWidth: 128 }
];

const COLUMN_LABELS: Record<string, string> = {
  select: "Select",
  firewall: "Firewall",
  mac: "MAC",
  ip: "IP",
  hostname: "Hostname",
  switchPort: "Switch / port",
  interface: "Interface",
  oui: "OUI",
  status: "Status",
  lastSeen: "Last seen"
};

const TOGGLEABLE_COLUMN_IDS = ASSET_COLUMNS.map((column) => column.id).filter((id) => id !== "select");
const ASSET_COLUMN_IDS = ASSET_COLUMNS.map((column) => column.id);

type SyncPhase = "idle" | "syncing" | "complete" | "error";

export function AssetIdentityWorkspace({
  user,
  firewalls,
  initialData
}: {
  user: SessionUser;
  firewalls: Firewall[];
  initialData: AssetSearchInitialData;
}) {
  const canSync = user.roles.includes("network_admin") || user.roles.includes("help_desk");
  const { startPing, running: pingRunning } = usePingMonitor();
  const { visible, visibleColumnIds, setColumnVisible } = useColumnVisibilityCookie(
    ASSET_COLUMN_COOKIE,
    ASSET_COLUMN_IDS
  );
  const [query, setQuery] = useState("");
  const [firewallId, setFirewallId] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "stale">("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AssetIdentityRecord[]>(initialData.items);
  const [total, setTotal] = useState(initialData.total);
  const [stats, setStats] = useState<AssetInventoryStats>(initialData.stats);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchPending, startSearch] = useTransition();
  const [syncPhase, setSyncPhase] = useState<SyncPhase>("idle");
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  const [syncStatusText, setSyncStatusText] = useState<string | null>(null);

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const visibleColumnKey = useMemo(
    () => ASSET_COLUMN_IDS.filter((columnId) => visible[columnId] !== false).join("|"),
    [visible]
  );

  const tableColumns = useMemo(
    () => ASSET_COLUMNS.filter((column) => visible[column.id] !== false),
    [visibleColumnKey]
  );

  const columnIndex = useCallback(
    (columnId: string) => tableColumns.findIndex((column) => column.id === columnId),
    [tableColumns]
  );

  const runSearch = useCallback(
    (nextPage = page) => {
      startSearch(async () => {
        const result = await searchAssetIdentitiesAction({
          query,
          firewallId: firewallId ? Number(firewallId) : undefined,
          status,
          page: nextPage,
          pageSize
        });
        if (result.error) {
          showErrorToast(result.error);
          return;
        }
        setRows(result.items);
        setTotal(result.total);
        if (result.stats) {
          setStats(result.stats);
        }
        setPage(result.page);
        setSelectedIds(new Set());
      });
    },
    [firewallId, page, pageSize, query, status]
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds]
  );

  const selectedPingable = useMemo(
    () =>
      selectedRows
        .filter((row) => row.ipAddress && isPingableIpv4(row.ipAddress))
        .map(
          (row): PingMonitorTarget => ({
            id: `asset-${row.id}`,
            ipAddress: row.ipAddress!.trim(),
            interfaceName: row.switchPort || row.interfaceName || row.firewallName,
            macAddress: row.macAddress
          })
        ),
    [selectedRows]
  );

  const allRowsSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  async function runBatchedSync() {
    setSyncPhase("syncing");
    setSyncStatusText("Starting asset inventory sync…");
    setSyncProgress(null);

    let syncId: string | undefined;
    try {
      const begin = await beginAssetSyncAction();
      if (begin.error) {
        setSyncPhase("error");
        setSyncStatusText(begin.error);
        showErrorToast(begin.error);
        return;
      }
      syncId = begin.syncId;
      if (!syncId || !begin.totalFirewalls) {
        setSyncPhase("error");
        setSyncStatusText("Sync did not return a session id.");
        showErrorToast("Sync did not return a session id.");
        return;
      }

      let offset = 0;
      const totalFirewalls = begin.totalFirewalls;
      setSyncProgress({ processed: 0, total: totalFirewalls });

      while (true) {
        const batch = await processAssetSyncBatchAction(syncId, offset);
        if (batch.error) {
          setSyncPhase("error");
          setSyncStatusText(batch.error);
          showErrorToast(batch.error);
          return;
        }

        setSyncProgress({
          processed: batch.processed || 0,
          total: batch.totalFirewalls || totalFirewalls
        });
        setSyncStatusText(batch.message || "Syncing firewalls…");

        if (batch.complete) {
          setSyncPhase("complete");
          setSyncStatusText(batch.message || "Sync complete.");
          showSuccessToast(batch.message || "Asset inventory sync complete.");
          runSearch(1);
          break;
        }

        offset = batch.processed || offset + 1;
      }
    } catch (error) {
      if (syncId) {
        await cancelAssetSyncAction(syncId);
      }
      const message = error instanceof Error ? error.message : "Asset sync failed.";
      setSyncPhase("error");
      setSyncStatusText(message);
      showErrorToast(message);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Inventory snapshot</CardTitle>
          <CardDescription>
            Cached device identities from FortiGate ARP, DHCP, and switch port telemetry. Data is kept for{" "}
            {stats.retentionDays} days; entries not seen in {stats.staleDays} days are marked stale until they age out.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Tracked devices" value={String(stats.total)} />
          <StatTile label="Active" value={String(stats.active)} />
          <StatTile label="Stale" value={String(stats.stale)} />
          <StatTile label="Last full sync">
            {stats.lastFullSyncAt ? (
              <>
                <LocalTimestamp value={stats.lastFullSyncAt} />
                {stats.lastFullSyncBy ? ` · ${stats.lastFullSyncBy}` : null}
              </>
            ) : (
              "Never"
            )}
          </StatTile>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search devices</CardTitle>
          <CardDescription>
            Find a device by MAC, IP, hostname, switch port, or firewall. Use this when a device moved or you need the
            last known switch port without a site visit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_180px_160px_auto]">
            <div className="space-y-1">
              <Label htmlFor="assetQuery">Search</Label>
              <Input
                id="assetQuery"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="MAC, IP, hostname, switch/port, firewall"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="assetFirewall">Firewall</Label>
              <select
                id="assetFirewall"
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                value={firewallId}
                onChange={(event) => setFirewallId(event.target.value)}
              >
                <option value="">All firewalls</option>
                {firewalls.map((firewall) => (
                  <option key={firewall.id} value={firewall.id}>
                    {firewall.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="assetStatus">Status</Label>
              <select
                id="assetStatus"
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                value={status}
                onChange={(event) => setStatus(event.target.value as "all" | "active" | "stale")}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="stale">Stale</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button type="button" disabled={searchPending} onClick={() => runSearch(1)}>
                {searchPending ? "Searching…" : "Search"}
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">Visible columns</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {TOGGLEABLE_COLUMN_IDS.map((columnId) => (
                <label key={columnId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={visible[columnId] !== false}
                    onChange={(event) => setColumnVisible(columnId, event.target.checked)}
                  />
                  {COLUMN_LABELS[columnId]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Drag a column edge to resize it. Double-click an edge to expand that column to fit its content.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={selectedPingable.length === 0}
              onClick={() => startPing(selectedPingable)}
            >
              {pingRunning ? "Update ping selection" : `Ping selected (${selectedPingable.length})`}
            </Button>
            {canSync ? (
              <Button type="button" variant="outline" disabled={syncPhase === "syncing"} onClick={() => void runBatchedSync()}>
                {syncPhase === "syncing" ? "Syncing inventory…" : "Sync all firewalls"}
              </Button>
            ) : null}
          </div>

          {syncStatusText ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              {syncStatusText}
              {syncProgress ? ` (${syncProgress.processed}/${syncProgress.total} firewalls)` : null}
            </p>
          ) : null}

          <TablePagination
            page={page - 1}
            pageCount={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={(nextPage) => {
              const next = nextPage + 1;
              setPage(next);
              runSearch(next);
            }}
          />

          <ResizableTable
            tableId="asset-identity"
            columns={tableColumns}
            className="max-h-[36rem] w-full min-w-0 overflow-auto rounded-md border border-[var(--border)]"
          >
            <ResizableTableElement>
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  {tableColumns.map((column) => (
                    <ResizableTh key={column.id} columnIndex={columnIndex(column.id)} className="p-2">
                      {column.id === "select" ? (
                        <input
                          type="checkbox"
                          aria-label="Select all rows on this page"
                          checked={allRowsSelected}
                          onChange={() => {
                            setSelectedIds((current) => {
                              if (allRowsSelected) {
                                return new Set();
                              }
                              return new Set(rows.map((row) => row.id));
                            });
                          }}
                          disabled={rows.length === 0}
                        />
                      ) : (
                        COLUMN_LABELS[column.id]
                      )}
                    </ResizableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={tableColumns.length} className="p-4 text-center text-sm text-[var(--muted-foreground)]">
                      {stats.total === 0
                        ? "No cached devices yet. Network Admin or Help Desk can run a full sync to populate inventory."
                        : "No devices match this search."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border)]">
                      {tableColumns.map((column) => (
                        <AssetIdentityCell
                          key={column.id}
                          columnId={column.id}
                          row={row}
                          selected={selectedIds.has(row.id)}
                          onToggleSelected={() => {
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (next.has(row.id)) {
                                next.delete(row.id);
                              } else {
                                next.add(row.id);
                              }
                              return next;
                            });
                          }}
                        />
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </ResizableTableElement>
          </ResizableTable>
        </CardContent>
      </Card>
    </div>
  );
}

function AssetIdentityCell({
  columnId,
  row,
  selected,
  onToggleSelected
}: {
  columnId: string;
  row: AssetIdentityRecord;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  switch (columnId) {
    case "select":
      return (
        <td className="p-2">
          <input
            type="checkbox"
            aria-label={`Select ${row.macAddress}`}
            checked={selected}
            onChange={onToggleSelected}
          />
        </td>
      );
    case "firewall":
      return (
        <td className={resizableTdClassName("p-2 text-xs")} title={`${row.firewallName} · ${row.firewallIp}`}>
          <div>{row.firewallName}</div>
          <div className="font-mono text-[var(--muted-foreground)]">{row.firewallIp}</div>
        </td>
      );
    case "mac":
      return (
        <td className={resizableTdClassName("font-mono text-xs")} title={row.macAddress}>
          {row.macAddress}
        </td>
      );
    case "ip":
      return (
        <td className={resizableTdClassName("font-mono text-xs")} title={row.ipAddress || undefined}>
          {row.ipAddress || "—"}
        </td>
      );
    case "hostname":
      return (
        <td className={resizableTdClassName("text-xs")} title={row.deviceName || undefined}>
          {row.deviceName || "—"}
        </td>
      );
    case "switchPort":
      return (
        <td className={resizableTdClassName("font-mono text-xs")} title={row.switchPort || undefined}>
          {row.switchPort || "—"}
        </td>
      );
    case "interface":
      return (
        <td className={resizableTdClassName("font-mono text-xs")} title={row.interfaceName || undefined}>
          {row.interfaceName || "—"}
        </td>
      );
    case "oui":
      return (
        <td className={resizableTdClassName("font-mono text-xs")} title={row.oui || undefined}>
          {row.oui || "—"}
        </td>
      );
    case "status":
      return (
        <td className={resizableTdClassName("p-2")}>
          {row.status === "active" ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
          ) : (
            <Badge variant="outline">Stale</Badge>
          )}
        </td>
      );
    case "lastSeen":
      return (
        <td className={resizableTdClassName("text-xs")}>
          <LocalTimestamp value={row.lastSeenAt} />
        </td>
      );
    default:
      return null;
  }
}

function StatTile({
  label,
  value,
  children
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] p-3">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-sm font-medium">{children ?? value}</p>
    </div>
  );
}
