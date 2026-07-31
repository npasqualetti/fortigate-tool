"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { useActionStateToast } from "@/hooks/use-action-state-toast";
import { deleteOuiAction, saveOuiAction, updateOuiAction } from "@/lib/admin/actions";
import { ROLE_LABELS, type AllowedOui } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
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

const OUI_TABLE_COLUMNS: ResizableColumnDef[] = [
  { id: "team", defaultWidth: 120, minWidth: 88 },
  { id: "oui", defaultWidth: 120, minWidth: 88 },
  { id: "vendor", defaultWidth: 200, minWidth: 120 },
  { id: "actions", defaultWidth: 160, minWidth: 120 }
];

type OuiSortKey = "teamRole" | "oui" | "vendor";
type SortDirection = "asc" | "desc";

export function OuiManager({ ouis }: { ouis: AllowedOui[] }) {
  const [saveState, saveAction, savePending] = useActionState(saveOuiAction, undefined);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<OuiSortKey>("teamRole");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [editingOui, setEditingOui] = useState<AllowedOui | null>(null);
  const [ouiToDelete, setOuiToDelete] = useState<AllowedOui | null>(null);
  const [newOui, setNewOui] = useState("");

  const displayedOuis = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered = query
      ? ouis.filter((row) => {
          const haystack = [ROLE_LABELS[row.teamRole], row.oui, row.vendor || ""].join(" ").toLowerCase();
          return haystack.includes(query);
        })
      : ouis;

    const sorted = [...filtered].sort((left, right) => compareOuiRows(left, right, sortKey));
    return sortDirection === "asc" ? sorted : sorted.reverse();
  }, [filter, ouis, sortDirection, sortKey]);

  useActionStateToast(saveState, savePending);

  useEffect(() => {
    if (saveState?.message) {
      setNewOui("");
    }
  }, [saveState?.message]);

  const toggleSort = (key: OuiSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  return (
    <div className="space-y-4">
      <form action={saveAction} className="grid gap-3 md:grid-cols-[12rem_1fr_1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="teamRole">Team</Label>
          <select id="teamRole" name="teamRole" className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm">
            <option value="telecom">Telecom</option>
            <option value="fuel">Fuel</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="oui">MAC OUI</Label>
          <Input
            id="oui"
            name="oui"
            value={newOui}
            onChange={(event) => setNewOui(formatOuiInput(event.target.value))}
            placeholder="AA:BB:CC"
            maxLength={8}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vendor">Vendor</Label>
          <Input id="vendor" name="vendor" />
        </div>
        <Button className="self-end" type="submit" disabled={savePending}>
          {savePending ? "Saving..." : "Add OUI"}
        </Button>
      </form>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full space-y-1 sm:max-w-sm">
          <Label htmlFor="ouiTableFilter">Search OUIs</Label>
          <Input
            id="ouiTableFilter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Team, OUI, or vendor"
          />
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          {displayedOuis.length} of {ouis.length} OUI{ouis.length === 1 ? "" : "s"}
        </p>
      </div>

      <ResizableTable
        tableId="admin-ouis"
        columns={OUI_TABLE_COLUMNS}
        className="overflow-x-auto rounded-md border border-[var(--border)]"
      >
        <ResizableTableElement>
          <thead className="bg-slate-100">
            <tr>
              <OuiSortHeader
                columnIndex={0}
                label="Team"
                column="teamRole"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <OuiSortHeader
                columnIndex={1}
                label="MAC OUI"
                column="oui"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <OuiSortHeader
                columnIndex={2}
                label="Vendor"
                column="vendor"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <ResizableTh columnIndex={3} className="p-2 text-right">
                Actions
              </ResizableTh>
            </tr>
          </thead>
          <tbody>
            {displayedOuis.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-[var(--muted-foreground)]">
                  {ouis.length === 0 ? "No allowed OUIs configured yet." : "No OUIs match this search."}
                </td>
              </tr>
            ) : (
              displayedOuis.map((row) => (
                <tr key={row.id} className="border-t border-[var(--border)]">
                  <td className={resizableTdClassName("p-2")}>
                    <Badge variant="secondary">{ROLE_LABELS[row.teamRole]}</Badge>
                  </td>
                  <td className={resizableTdClassName("p-2 font-mono text-base")}>{row.oui}</td>
                  <td className={resizableTdClassName("p-2")}>{row.vendor || "—"}</td>
                  <td className={resizableTdClassName("p-2")}>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingOui(row)}>
                        Edit
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => setOuiToDelete(row)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ResizableTableElement>
      </ResizableTable>

      <Dialog open={Boolean(editingOui)} onOpenChange={(open) => !open && setEditingOui(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit allowed OUI</DialogTitle>
            <DialogDescription>Update the team, OUI prefix, or vendor label.</DialogDescription>
          </DialogHeader>
          {editingOui ? (
            <OuiEditForm key={editingOui.id} oui={editingOui} onCancel={() => setEditingOui(null)} onSuccess={() => setEditingOui(null)} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ouiToDelete)} onOpenChange={(open) => !open && setOuiToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete allowed OUI?</DialogTitle>
            <DialogDescription>
              {ouiToDelete
                ? `Remove ${ouiToDelete.oui} (${ROLE_LABELS[ouiToDelete.teamRole]}${ouiToDelete.vendor ? `, ${ouiToDelete.vendor}` : ""}) from the allow list. Telecom and Fuel POE reset will be blocked for MACs with this prefix until it is added again.`
                : null}
            </DialogDescription>
          </DialogHeader>
          {ouiToDelete ? (
            <OuiDeleteForm
              key={ouiToDelete.id}
              oui={ouiToDelete}
              onCancel={() => setOuiToDelete(null)}
              onSuccess={() => setOuiToDelete(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OuiDeleteForm({
  oui,
  onCancel,
  onSuccess
}: {
  oui: AllowedOui;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, action, pending] = useActionState(deleteOuiAction, undefined);

  useActionStateToast(state, pending);

  useEffect(() => {
    if (state?.message && !pending) {
      onSuccess();
    }
  }, [state?.message, pending, onSuccess]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="ouiId" value={oui.id} />
      <input type="hidden" name="oui" value={oui.oui} />
      <input type="hidden" name="teamRole" value={oui.teamRole} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deleting..." : "Delete OUI"}
        </Button>
      </div>
    </form>
  );
}

function OuiEditForm({
  oui,
  onCancel,
  onSuccess
}: {
  oui: AllowedOui;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, action, pending] = useActionState(updateOuiAction, undefined);
  const [ouiValue, setOuiValue] = useState(oui.oui);

  useActionStateToast(state, pending);

  useEffect(() => {
    if (state?.message && !pending) {
      onSuccess();
    }
  }, [state?.message, pending, onSuccess]);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="ouiId" value={oui.id} />
      <div className="space-y-2">
        <Label htmlFor={`edit-teamRole-${oui.id}`}>Team</Label>
        <select
          id={`edit-teamRole-${oui.id}`}
          name="teamRole"
          defaultValue={oui.teamRole}
          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        >
          <option value="telecom">Telecom</option>
          <option value="fuel">Fuel</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`edit-oui-${oui.id}`}>MAC OUI</Label>
        <Input
          id={`edit-oui-${oui.id}`}
          name="oui"
          value={ouiValue}
          onChange={(event) => setOuiValue(formatOuiInput(event.target.value))}
          maxLength={8}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`edit-vendor-${oui.id}`}>Vendor</Label>
        <Input id={`edit-vendor-${oui.id}`} name="vendor" defaultValue={oui.vendor || ""} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OuiSortHeader({
  columnIndex,
  label,
  column,
  sortKey,
  sortDirection,
  onSort
}: {
  columnIndex: number;
  label: string;
  column: OuiSortKey;
  sortKey: OuiSortKey;
  sortDirection: SortDirection;
  onSort: (column: OuiSortKey) => void;
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

function compareOuiRows(left: AllowedOui, right: AllowedOui, sortKey: OuiSortKey) {
  if (sortKey === "teamRole") {
    return ROLE_LABELS[left.teamRole].localeCompare(ROLE_LABELS[right.teamRole], undefined, { sensitivity: "base" });
  }
  if (sortKey === "oui") {
    return left.oui.localeCompare(right.oui, undefined, { sensitivity: "base" });
  }
  return (left.vendor || "").localeCompare(right.vendor || "", undefined, { sensitivity: "base" });
}

function formatOuiInput(value: string) {
  const hex = value.replace(/[^a-fA-F0-9]/g, "").toUpperCase().slice(0, 6);
  if (hex.length <= 2) {
    return hex;
  }
  if (hex.length <= 4) {
    return `${hex.slice(0, 2)}:${hex.slice(2)}`;
  }
  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4)}`;
}
