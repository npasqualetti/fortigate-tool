"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
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
import { LocalTimestamp } from "@/components/local-timestamp";
import { formatStoredTimestamp, parseStoredTimestamp } from "@/lib/format-timestamp";
import type { AuditEvent } from "@/lib/types";

const AUDIT_TABLE_COLUMNS: ResizableColumnDef[] = [
  { id: "time", defaultWidth: 160, minWidth: 120 },
  { id: "user", defaultWidth: 120, minWidth: 88 },
  { id: "action", defaultWidth: 180, minWidth: 120 },
  { id: "status", defaultWidth: 96, minWidth: 72 },
  { id: "details", defaultWidth: 320, minWidth: 160 }
];

export function AuditLogViewer({
  previewLogs,
  allLogs
}: {
  previewLogs: AuditEvent[];
  allLogs: AuditEvent[];
}) {
  return (
    <div className="space-y-4">
      <PaginatedAuditTable logs={previewLogs} />
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="outline">
            View more logs
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Audit logs</DialogTitle>
            <DialogDescription>
              Logs are retained for 30 days. Search with regex and filter by timeframe.
            </DialogDescription>
          </DialogHeader>
          <AuditLogModal logs={allLogs} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditLogModal({ logs }: { logs: AuditEvent[] }) {
  const [regexSearch, setRegexSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { filteredLogs, regexError } = useMemo(() => {
    let regex: RegExp | null = null;

    if (regexSearch.trim()) {
      try {
        regex = new RegExp(regexSearch.trim(), "i");
      } catch (error) {
        return {
          filteredLogs: [],
          regexError: error instanceof Error ? error.message : "Invalid regular expression."
        };
      }
    }

    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate).getTime() : null;

    return {
      regexError: null,
      filteredLogs: logs.filter((event) => {
        const parsedCreatedAt = parseStoredTimestamp(event.createdAt);
        const createdAt = parsedCreatedAt?.getTime() ?? Number.NaN;
        const formattedCreatedAt = formatStoredTimestamp(event.createdAt);
        const searchable = [
          event.createdAt,
          formattedCreatedAt,
          event.username,
          event.action,
          event.status,
          event.targetType,
          event.targetId || "",
          event.details || ""
        ].join(" ");

        if (from && (!Number.isFinite(createdAt) || createdAt < from)) {
          return false;
        }

        if (to && (!Number.isFinite(createdAt) || createdAt > to)) {
          return false;
        }

        return regex ? regex.test(searchable) : true;
      })
    };
  }, [fromDate, logs, regexSearch, toDate]);

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="auditRegex">Regex search</Label>
          <Input
            id="auditRegex"
            value={regexSearch}
            onChange={(event) => setRegexSearch(event.target.value)}
            placeholder="admin\\.firewall|error|10\\.10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auditFrom">From</Label>
          <Input id="auditFrom" type="datetime-local" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auditTo">To</Label>
          <Input id="auditTo" type="datetime-local" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>
      </div>
      {regexError ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{regexError}</p> : null}
      <p className="text-sm text-[var(--muted-foreground)]">
        Showing {filteredLogs.length} of {logs.length} retained logs.
      </p>
      <PaginatedAuditTable logs={filteredLogs} resetKey={`${regexSearch}|${fromDate}|${toDate}`} />
    </div>
  );
}

function PaginatedAuditTable({ logs, resetKey = "" }: { logs: AuditEvent[]; resetKey?: string }) {
  const { pageItems, setPage, ...pagination } = useTablePagination(logs, 10, resetKey);

  return (
    <div className="space-y-2">
      <TablePagination {...pagination} onPageChange={setPage} />
      <div className="max-h-[50vh] w-full min-w-0 overflow-auto rounded-md border border-[var(--border)] sm:max-h-[65vh]">
        <AuditTable logs={pageItems} />
      </div>
    </div>
  );
}

function AuditTable({ logs }: { logs: AuditEvent[] }) {
  return (
    <ResizableTable tableId="admin-audit-log" columns={AUDIT_TABLE_COLUMNS} className="overflow-x-auto">
      <ResizableTableElement>
        <thead>
          <tr>
            <ResizableTh columnIndex={0} className="p-2">
              Time
            </ResizableTh>
            <ResizableTh columnIndex={1} className="p-2">
              User
            </ResizableTh>
            <ResizableTh columnIndex={2} className="p-2">
              Action
            </ResizableTh>
            <ResizableTh columnIndex={3} className="p-2">
              Status
            </ResizableTh>
            <ResizableTh columnIndex={4} className="p-2">
              Details
            </ResizableTh>
          </tr>
        </thead>
        <tbody>
          {logs.map((event) => (
            <tr key={event.id} className="border-t border-[var(--border)]">
              <td className={resizableTdClassName("p-2 whitespace-nowrap")}>
                <LocalTimestamp value={event.createdAt} />
              </td>
              <td className={resizableTdClassName()}>{event.username}</td>
              <td className={resizableTdClassName()}>{event.action}</td>
              <td className={resizableTdClassName()}>
                <Badge variant={event.status === "error" || event.status === "denied" ? "destructive" : "secondary"}>
                  {event.status}
                </Badge>
              </td>
              <td className={resizableTdClassName("overflow-hidden break-words whitespace-normal")}>{event.details}</td>
            </tr>
          ))}
        </tbody>
      </ResizableTableElement>
    </ResizableTable>
  );
}
