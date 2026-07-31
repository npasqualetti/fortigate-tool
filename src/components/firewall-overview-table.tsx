"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadFirewallOverviewAction } from "@/lib/fortinet/actions";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ResizableTable,
  ResizableTableElement,
  ResizableTh,
  resizableTdClassName
} from "@/components/ui/resizable-table";
import type { ResizableColumnDef } from "@/hooks/use-resizable-table-columns";
import { useTablePagination } from "@/hooks/use-table-pagination";
import { TablePagination } from "@/components/ui/table-pagination";
import type { FirewallOverview, PublicFirewallRecord } from "@/lib/fortinet/overview";

const refreshMs = 60_000;

const FIREWALL_OVERVIEW_COLUMNS: ResizableColumnDef[] = [
  { id: "status", defaultWidth: 132, minWidth: 96 },
  { id: "firewall", defaultWidth: 148, minWidth: 96 },
  { id: "ip", defaultWidth: 112, minWidth: 96 },
  { id: "hostname", defaultWidth: 136, minWidth: 96 },
  { id: "platform", defaultWidth: 128, minWidth: 96 },
  { id: "fortios", defaultWidth: 156, minWidth: 104 },
  { id: "serial", defaultWidth: 156, minWidth: 104 },
  { id: "uptime", defaultWidth: 104, minWidth: 80 },
  { id: "cpu", defaultWidth: 72, minWidth: 56 },
  { id: "memory", defaultWidth: 80, minWidth: 56 },
  { id: "tls", defaultWidth: 72, minWidth: 56 },
  { id: "token", defaultWidth: 96, minWidth: 72 },
  { id: "updated", defaultWidth: 88, minWidth: 72 }
];

export function FirewallOverviewTable({ firewalls }: { firewalls: PublicFirewallRecord[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [visibleIds, setVisibleIds] = useState<number[]>([]);
  const [overviewById, setOverviewById] = useState<Record<number, FirewallOverview>>({});
  const [loadingIds, setLoadingIds] = useState<number[]>([]);
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredFirewalls = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return firewalls;
    }

    return firewalls.filter((firewall) =>
      [
        firewall.name,
        firewall.fmgDeviceName || "",
        firewall.ipAddress,
        firewall.model || "",
        firewall.serialNumber || "",
        firewall.hostname || "",
        overviewById[firewall.id]?.hostname || "",
        overviewById[firewall.id]?.fortiOsVersion || "",
        overviewById[firewall.id]?.platform || ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [firewalls, overviewById, search]);

  const { pageItems, setPage, ...pagination } = useTablePagination(filteredFirewalls, 10, search);

  const visibleIdsKey = visibleIds.join(",");

  const refreshVisibleRows = useCallback((ids: number[]) => {
    if (ids.length === 0) {
      return;
    }

    setLoadingIds(ids);
    startTransition(() => {
      void loadFirewallOverviewAction(ids).then((rows) => {
        setOverviewById((current) => ({
          ...current,
          ...Object.fromEntries(rows.map((row) => [row.firewall.id, row]))
        }));
        setLoadingIds([]);
      });
    });
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisibleIds: number[] = [];
        setVisibleIds((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const id = Number((entry.target as HTMLElement).dataset.firewallId);
            if (!id) {
              continue;
            }
            if (entry.isIntersecting) {
              next.add(id);
              newlyVisibleIds.push(id);
            } else {
              next.delete(id);
            }
          }
          return Array.from(next).sort((a, b) => a - b);
        });
        refreshVisibleRows(newlyVisibleIds);
      },
      { root, threshold: 0.1 }
    );

    root.querySelectorAll("[data-firewall-id]").forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [pageItems, refreshVisibleRows]);

  useEffect(() => {
    const interval = window.setInterval(() => refreshVisibleRows(visibleIds), refreshMs);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIdsKey]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label htmlFor="firewallOverviewSearch" className="text-sm font-medium">
          Search firewalls
        </label>
        <Input
          id="firewallOverviewSearch"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setVisibleIds([]);
            setPage(0);
            scrollRef.current?.scrollTo({ top: 0 });
          }}
          placeholder="Search site, firewall, IP, hostname, model, serial, or FortiOS"
        />
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        {filteredFirewalls.length} matching firewall{filteredFirewalls.length === 1 ? "" : "s"}. Live status loads for
        the current page only and refreshes every minute. Drag column borders in the header to resize.
      </p>
      <TablePagination {...pagination} onPageChange={setPage} />
      <div ref={scrollRef} className="max-h-[28rem] overflow-auto rounded-md border border-[var(--border)]">
        <ResizableTable tableId="firewall-overview" columns={FIREWALL_OVERVIEW_COLUMNS}>
          <ResizableTableElement>
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr>
                <ResizableTh columnIndex={0} className="p-2">
                  Status
                </ResizableTh>
                <ResizableTh columnIndex={1} className="p-2">
                  Firewall
                </ResizableTh>
                <ResizableTh columnIndex={2} className="p-2">
                  Mgmt IP
                </ResizableTh>
                <ResizableTh columnIndex={3} className="p-2">
                  Hostname
                </ResizableTh>
                <ResizableTh columnIndex={4} className="p-2">
                  Platform
                </ResizableTh>
                <ResizableTh columnIndex={5} className="p-2">
                  FortiOS
                </ResizableTh>
                <ResizableTh columnIndex={6} className="p-2">
                  Serial
                </ResizableTh>
                <ResizableTh columnIndex={7} className="p-2">
                  Uptime
                </ResizableTh>
                <ResizableTh columnIndex={8} className="p-2">
                  CPU
                </ResizableTh>
                <ResizableTh columnIndex={9} className="p-2">
                  Memory
                </ResizableTh>
                <ResizableTh columnIndex={10} className="p-2">
                  TLS
                </ResizableTh>
                <ResizableTh columnIndex={11} className="p-2">
                  Connection
                </ResizableTh>
                <ResizableTh columnIndex={12} className="p-2">
                  Updated
                </ResizableTh>
              </tr>
            </thead>
            <tbody>
            {pageItems.map((firewall) => {
              const row = overviewById[firewall.id];
              const isLoading = loadingIds.includes(firewall.id) || (isPending && !row);
              const hostname = row?.hostname || firewall.hostname || null;
              return (
                <tr
                  key={firewall.id}
                  data-firewall-id={firewall.id}
                  tabIndex={0}
                  onClick={() => router.push(`/firewalls/${firewall.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/firewalls/${firewall.id}`);
                    }
                  }}
                  className="cursor-pointer border-t border-[var(--border)] align-top transition-colors hover:bg-blue-50 focus:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  <td className="p-2 align-top overflow-hidden break-words whitespace-normal">
                    <StatusBadge status={row?.apiStatus || (firewall.tokenConfigured ? "offline" : "not_configured")} />
                    {row?.error ? <p className="mt-1 text-xs text-red-700">{row.error}</p> : null}
                    {isLoading ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">Refreshing...</p> : null}
                  </td>
                  <td className={resizableTdClassName("p-2 font-semibold")}>
                    {hostname || (isLoading ? "…" : firewall.name)}
                    {firewall.fmgDeviceName && firewall.fmgDeviceName !== firewall.name ? (
                      <p className="text-xs font-normal text-[var(--muted-foreground)]">{firewall.fmgDeviceName}</p>
                    ) : null}
                  </td>
                  <td className={resizableTdClassName("p-2 font-mono")}>{firewall.ipAddress}</td>
                  <td className={resizableTdClassName("p-2")}>
                    {hostname || (row?.apiStatus === "online" ? "—" : "Unknown")}
                  </td>
                  <td className={resizableTdClassName("p-2")}>
                    <p>{row?.platform || firewall.model || "Unknown"}</p>
                    {firewall.model && row?.platform && firewall.model !== row.platform ? (
                      <p className="text-xs text-[var(--muted-foreground)]">Stored: {firewall.model}</p>
                    ) : null}
                  </td>
                  <td className={resizableTdClassName("p-2")}>{row?.fortiOsVersion || "Unknown"}</td>
                  <td className={resizableTdClassName("p-2 font-mono")}>
                    {row?.serialNumber || firewall.serialNumber || "Unknown"}
                  </td>
                  <td className={resizableTdClassName("p-2")}>{row?.uptime || "Unknown"}</td>
                  <td className={resizableTdClassName("p-2 font-mono")}>
                    {row?.cpuUsage ?? (row?.apiStatus === "online" ? "—" : "Unknown")}
                  </td>
                  <td className={resizableTdClassName("p-2 font-mono")}>
                    {row?.memoryUsage ?? (row?.apiStatus === "online" ? "—" : "Unknown")}
                  </td>
                  <td className={resizableTdClassName("p-2")}>{firewall.verifyTls ? "Verify" : "Skip"}</td>
                  <td className={resizableTdClassName("p-2")}>{firewall.connectionLabel}</td>
                  <td className={resizableTdClassName("p-2 text-xs text-[var(--muted-foreground)]")}>
                    {row?.updatedAt ? new Date(row.updatedAt).toLocaleTimeString() : "Pending"}
                  </td>
                </tr>
              );
            })}
            </tbody>
          </ResizableTableElement>
        </ResizableTable>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FirewallOverview["apiStatus"] }) {
  if (status === "online") {
    return (
      <Badge className="animate-pulse border-transparent bg-green-600 text-white shadow-sm shadow-green-300">
        Online
      </Badge>
    );
  }

  if (status === "not_configured") {
    return <Badge variant="destructive">Not configured</Badge>;
  }

  return <Badge variant="destructive">Offline</Badge>;
}
