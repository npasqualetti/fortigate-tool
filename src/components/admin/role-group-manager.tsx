"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { useActionStateToast } from "@/hooks/use-action-state-toast";
import { deleteRoleGroupAction, saveRoleGroupAction, updateRoleGroupAction } from "@/lib/admin/actions";
import { APP_ROLES, ROLE_LABELS, type RoleGroup } from "@/lib/types";
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

const ROLE_GROUP_COLUMNS: ResizableColumnDef[] = [
  { id: "role", defaultWidth: 140, minWidth: 96 },
  { id: "groupDn", defaultWidth: 280, minWidth: 160 },
  { id: "description", defaultWidth: 200, minWidth: 120 },
  { id: "actions", defaultWidth: 160, minWidth: 120 }
];

export function RoleGroupManager({ roleGroups }: { roleGroups: RoleGroup[] }) {
  const [saveState, saveAction, savePending] = useActionState(saveRoleGroupAction, undefined);
  const [filter, setFilter] = useState("");
  const [editingMapping, setEditingMapping] = useState<RoleGroup | null>(null);
  const [mappingToDelete, setMappingToDelete] = useState<RoleGroup | null>(null);

  const displayedMappings = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return roleGroups;
    }

    return roleGroups.filter((mapping) => {
      const haystack = [ROLE_LABELS[mapping.role], mapping.groupDn, mapping.description || ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [filter, roleGroups]);

  useActionStateToast(saveState, savePending);

  return (
    <div className="space-y-4">
      <form action={saveAction} className="grid gap-3 md:grid-cols-[12rem_1fr_1fr_auto]">
        <RoleFields roleIdPrefix="new" />
        <Button className="self-end" type="submit" disabled={savePending}>
          {savePending ? "Saving..." : "Add mapping"}
        </Button>
      </form>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full space-y-1 sm:max-w-sm">
          <Label htmlFor="roleGroupFilter">Search mappings</Label>
          <Input
            id="roleGroupFilter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Role, group DN, or description"
          />
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          {displayedMappings.length} of {roleGroups.length} mapping{roleGroups.length === 1 ? "" : "s"}
        </p>
      </div>

      <ResizableTable
        tableId="admin-role-groups"
        columns={ROLE_GROUP_COLUMNS}
        className="overflow-x-auto rounded-md border border-[var(--border)]"
      >
        <ResizableTableElement>
          <thead className="bg-slate-100">
            <tr>
              <ResizableTh columnIndex={0} className="p-2">
                Role
              </ResizableTh>
              <ResizableTh columnIndex={1} className="p-2">
                Group DN
              </ResizableTh>
              <ResizableTh columnIndex={2} className="p-2">
                Description
              </ResizableTh>
              <ResizableTh columnIndex={3} className="p-2 text-right">
                Actions
              </ResizableTh>
            </tr>
          </thead>
          <tbody>
            {displayedMappings.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-[var(--muted-foreground)]">
                  {roleGroups.length === 0 ? "No AD group mappings configured yet." : "No mappings match this search."}
                </td>
              </tr>
            ) : (
              displayedMappings.map((mapping) => (
                <tr key={mapping.id} className="border-t border-[var(--border)]">
                  <td className={resizableTdClassName("p-2")}>
                    <Badge>{ROLE_LABELS[mapping.role]}</Badge>
                  </td>
                  <td className={resizableTdClassName("p-2 font-mono text-xs")}>{mapping.groupDn}</td>
                  <td className={resizableTdClassName("p-2")}>{mapping.description || "—"}</td>
                  <td className={resizableTdClassName("p-2")}>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingMapping(mapping)}>
                        Edit
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => setMappingToDelete(mapping)}>
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

      <Dialog open={Boolean(editingMapping)} onOpenChange={(open) => !open && setEditingMapping(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit AD group mapping</DialogTitle>
            <DialogDescription>Update the platform role, group DN, or description.</DialogDescription>
          </DialogHeader>
          {editingMapping ? (
            <RoleGroupEditForm
              key={editingMapping.id}
              mapping={editingMapping}
              onCancel={() => setEditingMapping(null)}
              onSuccess={() => setEditingMapping(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(mappingToDelete)} onOpenChange={(open) => !open && setMappingToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete AD group mapping?</DialogTitle>
            <DialogDescription>
              {mappingToDelete
                ? `Remove ${ROLE_LABELS[mappingToDelete.role]} access for ${mappingToDelete.groupDn}. Users in that group will no longer receive this role.`
                : null}
            </DialogDescription>
          </DialogHeader>
          {mappingToDelete ? (
            <RoleGroupDeleteForm
              key={mappingToDelete.id}
              mapping={mappingToDelete}
              onCancel={() => setMappingToDelete(null)}
              onSuccess={() => setMappingToDelete(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleFields({
  roleIdPrefix,
  defaultRole,
  defaultGroupDn,
  defaultDescription
}: {
  roleIdPrefix: string;
  defaultRole?: RoleGroup["role"];
  defaultGroupDn?: string;
  defaultDescription?: string;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${roleIdPrefix}-role`}>Role</Label>
        <select
          id={`${roleIdPrefix}-role`}
          name="role"
          defaultValue={defaultRole}
          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        >
          {APP_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${roleIdPrefix}-groupDn`}>AD group DN</Label>
        <Input
          id={`${roleIdPrefix}-groupDn`}
          name="groupDn"
          defaultValue={defaultGroupDn}
          placeholder="CN=Fortinet-Telecom,OU=Groups,DC=example,DC=local"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${roleIdPrefix}-description`}>Description</Label>
        <Input id={`${roleIdPrefix}-description`} name="description" defaultValue={defaultDescription || ""} />
      </div>
    </>
  );
}

function RoleGroupEditForm({
  mapping,
  onCancel,
  onSuccess
}: {
  mapping: RoleGroup;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, action, pending] = useActionState(updateRoleGroupAction, undefined);

  useActionStateToast(state, pending);

  useEffect(() => {
    if (state?.message && !pending) {
      onSuccess();
    }
  }, [state?.message, pending, onSuccess]);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="roleGroupId" value={mapping.id} />
      <RoleFields
        roleIdPrefix={`edit-${mapping.id}`}
        defaultRole={mapping.role}
        defaultGroupDn={mapping.groupDn}
        defaultDescription={mapping.description || ""}
      />
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

function RoleGroupDeleteForm({
  mapping,
  onCancel,
  onSuccess
}: {
  mapping: RoleGroup;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, action, pending] = useActionState(deleteRoleGroupAction, undefined);

  useActionStateToast(state, pending);

  useEffect(() => {
    if (state?.message && !pending) {
      onSuccess();
    }
  }, [state?.message, pending, onSuccess]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="roleGroupId" value={mapping.id} />
      <input type="hidden" name="groupDn" value={mapping.groupDn} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deleting..." : "Delete mapping"}
        </Button>
      </div>
    </form>
  );
}
