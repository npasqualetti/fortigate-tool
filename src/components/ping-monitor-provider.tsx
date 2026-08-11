"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableTable,
  ResizableTableElement,
  ResizableTh,
  resizableTdClassName
} from "@/components/ui/resizable-table";
import type { ResizableColumnDef } from "@/hooks/use-resizable-table-columns";

const PING_MONITOR_COLUMNS: ResizableColumnDef[] = [
  { id: "ip", defaultWidth: 120, minWidth: 96 },
  { id: "status", defaultWidth: 160, minWidth: 96 },
  { id: "rtt", defaultWidth: 80, minWidth: 64 }
];

type PingSortKey = "ipAddress" | "status" | "latencyMs";
type SortDirection = "asc" | "desc";

export type PingMonitorTarget = {
  id: string;
  ipAddress: string;
  interfaceName: string;
  macAddress: string;
};

export type PingMonitorResult = {
  id: string;
  ipAddress: string;
  interfaceName: string;
  macAddress: string;
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
  checkedAt: number | null;
};

type PingMonitorContextValue = {
  running: boolean;
  panelOpen: boolean;
  targets: PingMonitorTarget[];
  results: PingMonitorResult[];
  startPing: (targets: PingMonitorTarget[]) => void;
  stopPing: () => void;
  setPanelOpen: (open: boolean) => void;
};

const PingMonitorContext = createContext<PingMonitorContextValue | null>(null);

export function usePingMonitor() {
  const context = useContext(PingMonitorContext);
  if (!context) {
    throw new Error("usePingMonitor must be used within PingMonitorProvider.");
  }
  return context;
}

export function PingMonitorProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [targets, setTargets] = useState<PingMonitorTarget[]>([]);
  const [results, setResults] = useState<PingMonitorResult[]>([]);
  const targetsRef = useRef<PingMonitorTarget[]>([]);

  const mergeResults = useCallback((incoming: Array<{
    id: string;
    ipAddress: string;
    reachable: boolean;
    latencyMs: number | null;
    error?: string;
    checkedAt: number;
  }>) => {
    const targetById = new Map(targetsRef.current.map((target) => [target.id, target]));
    setResults(
      incoming.map((row) => {
        const target = targetById.get(row.id);
        return {
          id: row.id,
          ipAddress: row.ipAddress,
          interfaceName: target?.interfaceName || "unknown",
          macAddress: target?.macAddress || "unknown",
          reachable: row.reachable,
          latencyMs: row.latencyMs,
          error: row.error,
          checkedAt: row.checkedAt
        };
      })
    );
  }, []);

  const runPingCycle = useCallback(async () => {
    const activeTargets = targetsRef.current;
    if (!activeTargets.length) {
      return;
    }

    const response = await fetch("/api/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        targets: activeTargets.map((target) => ({
          id: target.id,
          ipAddress: target.ipAddress
        }))
      })
    });

    if (!response.ok) {
      let errorMessage = "Ping request failed.";
      try {
        const payload = (await response.json()) as { error?: string };
        if (payload.error) {
          errorMessage = payload.error;
        }
      } catch {
        // ignore parse errors
      }
      const checkedAt = Date.now();
      mergeResults(
        activeTargets.map((target) => ({
          id: target.id,
          ipAddress: target.ipAddress,
          reachable: false,
          latencyMs: null,
          error: errorMessage,
          checkedAt
        }))
      );
      return;
    }

    const payload = (await response.json()) as {
      results: Array<{
        id: string;
        ipAddress: string;
        reachable: boolean;
        latencyMs: number | null;
        error?: string;
        checkedAt: number;
      }>;
    };
    mergeResults(payload.results || []);
  }, [mergeResults]);

  const startPing = useCallback(
    (nextTargets: PingMonitorTarget[]) => {
      const unique = new Map<string, PingMonitorTarget>();
      for (const target of nextTargets) {
        unique.set(target.id, target);
      }
      const list = Array.from(unique.values());
      targetsRef.current = list;
      setTargets(list);
      setResults(
        list.map((target) => ({
          ...target,
          reachable: false,
          latencyMs: null,
          checkedAt: null
        }))
      );
      setRunning(true);
      setPanelOpen(true);
      void runPingCycle();
    },
    [runPingCycle]
  );

  const stopPing = useCallback(() => {
    setRunning(false);
    targetsRef.current = [];
    setTargets([]);
    setResults([]);
    setPanelOpen(false);
  }, []);

  useEffect(() => {
    if (!running) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void runPingCycle();
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [running, runPingCycle]);

  const value = useMemo(
    () => ({
      running,
      panelOpen,
      targets,
      results,
      startPing,
      stopPing,
      setPanelOpen
    }),
    [running, panelOpen, targets, results, startPing, stopPing]
  );

  const reachableCount = results.filter((row) => row.reachable).length;

  return (
    <PingMonitorContext.Provider value={value}>
      {children}
      {running || results.length > 0 ? (
        <PingMonitorFloatingPanel
          running={running}
          panelOpen={panelOpen}
          results={results}
          reachableCount={reachableCount}
          targetCount={targets.length}
          onOpen={() => setPanelOpen(true)}
          onHide={() => setPanelOpen(false)}
          onStop={stopPing}
        />
      ) : null}
    </PingMonitorContext.Provider>
  );
}

function PingMonitorFloatingPanel({
  running,
  panelOpen,
  results,
  reachableCount,
  targetCount,
  onOpen,
  onHide,
  onStop
}: {
  running: boolean;
  panelOpen: boolean;
  results: PingMonitorResult[];
  reachableCount: number;
  targetCount: number;
  onOpen: () => void;
  onHide: () => void;
  onStop: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<PingSortKey>("ipAddress");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const displayedResults = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered = query
      ? results.filter((row) => {
          const statusLabel = formatPingStatusLabel(row);
          const haystack = [row.ipAddress, row.macAddress, statusLabel, row.latencyMs?.toString()]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : results;

    const sorted = [...filtered].sort((left, right) => comparePingRows(left, right, sortKey));
    return sortDirection === "asc" ? sorted : sorted.reverse();
  }, [filter, results, sortDirection, sortKey]);

  const toggleSort = (key: PingSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  return (
    <div className="fixed bottom-20 right-4 z-[60] flex max-w-md flex-col items-end gap-2">
      {!panelOpen ? (
        <Button type="button" size="sm" className="shadow-lg" onClick={onOpen}>
          Ping monitor ({reachableCount}/{results.length || targetCount} up)
        </Button>
      ) : (
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-white/95 p-4 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">Ping monitor</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {running ? "Refreshing every second" : "Stopped"} · {reachableCount}/{results.length} reachable · from
                this app server
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={onHide}>
                Hide
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={onStop}>
                Stop
              </Button>
            </div>
          </div>
          <div className="mb-3">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search IP, status, or RTT"
              className="h-8 text-xs"
            />
          </div>
          <ResizableTable
            tableId="ping-monitor"
            columns={PING_MONITOR_COLUMNS}
            className="max-h-64 overflow-y-auto rounded-md border border-[var(--border)]"
          >
            <ResizableTableElement className="text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  <PingSortHeader
                    columnIndex={0}
                    label="IP"
                    column="ipAddress"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <PingSortHeader
                    columnIndex={1}
                    label="Status"
                    column="status"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <PingSortHeader
                    columnIndex={2}
                    label="RTT"
                    column="latencyMs"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {displayedResults.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-[var(--muted-foreground)]">
                      No rows match this search.
                    </td>
                  </tr>
                ) : (
                  displayedResults.map((row) => {
                    const statusLabel = formatPingStatusLabel(row);
                    return (
                    <tr key={row.id} className="border-t border-[var(--border)]">
                      <td className={resizableTdClassName("p-2 font-mono")}>{row.ipAddress}</td>
                      <td
                        className={resizableTdClassName(
                          row.checkedAt === null
                            ? "text-[var(--muted-foreground)]"
                            : row.reachable
                              ? "text-green-700"
                              : "text-red-700"
                        )}
                      >
                        {statusLabel}
                      </td>
                      <td className={resizableTdClassName("font-mono")}>
                        {row.latencyMs !== null ? `${row.latencyMs} ms` : "—"}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </ResizableTableElement>
          </ResizableTable>
        </div>
      )}
    </div>
  );
}

function PingSortHeader({
  columnIndex,
  label,
  column,
  sortKey,
  sortDirection,
  onSort
}: {
  columnIndex: number;
  label: string;
  column: PingSortKey;
  sortKey: PingSortKey;
  sortDirection: SortDirection;
  onSort: (column: PingSortKey) => void;
}) {
  const active = sortKey === column;
  const indicator = active ? (sortDirection === "asc" ? " ↑" : " ↓") : "";

  return (
    <ResizableTh columnIndex={columnIndex} className="p-2">
      <button
        type="button"
        className="inline-flex items-center font-semibold hover:text-[var(--primary)]"
        onClick={() => onSort(column)}
      >
        {label}
        <span className="text-[var(--muted-foreground)]">{indicator}</span>
      </button>
    </ResizableTh>
  );
}

function comparePingRows(left: PingMonitorResult, right: PingMonitorResult, sortKey: PingSortKey) {
  if (sortKey === "ipAddress") {
    return compareIpAddresses(left.ipAddress, right.ipAddress);
  }
  if (sortKey === "status") {
    return compareStatus(left, right);
  }
  return compareLatency(left.latencyMs, right.latencyMs, left.reachable, right.reachable);
}

function formatPingStatusLabel(row: PingMonitorResult) {
  if (row.checkedAt === null) {
    return "Pending";
  }
  if (row.reachable) {
    return "Up";
  }
  return simplifyPingFailure(row.error);
}

function simplifyPingFailure(error?: string) {
  if (!error?.trim()) {
    return "Down";
  }

  const normalized = error.trim().toLowerCase();
  if (
    normalized.includes("no reply") ||
    normalized.includes("host unreachable") ||
    normalized.includes("timed out") ||
    normalized.includes("request timed out") ||
    normalized.includes("100% packet loss")
  ) {
    return "Down";
  }

  return error.trim();
}

function compareStatus(left: PingMonitorResult, right: PingMonitorResult) {
  const rank = (row: PingMonitorResult) => {
    if (row.checkedAt === null) {
      return 1;
    }
    return row.reachable ? 0 : 2;
  };
  return rank(left) - rank(right);
}

function compareLatency(
  leftMs: number | null,
  rightMs: number | null,
  leftReachable: boolean,
  rightReachable: boolean
) {
  const leftScore = leftMs ?? (leftReachable ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER);
  const rightScore = rightMs ?? (rightReachable ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER);
  return leftScore - rightScore;
}

function compareIpAddresses(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  if (leftParts.length === 4 && rightParts.length === 4 && leftParts.every(Number.isFinite) && rightParts.every(Number.isFinite)) {
    for (let index = 0; index < 4; index += 1) {
      if (leftParts[index] !== rightParts[index]) {
        return leftParts[index] - rightParts[index];
      }
    }
    return 0;
  }
  return left.localeCompare(right, undefined, { numeric: true });
}
