"use client";

import { useCallback, useEffect, useMemo, useState, useActionState } from "react";
import {
  useActionStateToast,
  useFirewallLiveErrorToasts,
  useMessageToast
} from "@/hooks/use-action-state-toast";
import {
  bulkDeleteFirewallsAction,
  bulkUpdateFirewallsAction,
  loadFirewallLiveHardwareAction,
  saveFirewallAction,
  syncFirewallHardwareToDbAction,
  testFirewallApiAction,
  type FirewallLiveHardwareRow
} from "@/lib/admin/actions";
import type { Firewall, Site } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  ResizableTable,
  ResizableTableElement,
  ResizableTh,
  resizableTdClassName
} from "@/components/ui/resizable-table";
import type { ResizableColumnDef } from "@/hooks/use-resizable-table-columns";
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

const ipv4Pattern =
  "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}";
type FirewallWithSite = Firewall & { siteNumber: string; siteName: string };

export function FirewallManager({
  sites,
  firewalls,
  fmgConfigured = false
}: {
  sites: Array<Site & { firewallCount: number }>;
  firewalls: FirewallWithSite[];
  fmgConfigured?: boolean;
}) {
  const [state, action, pending] = useActionState(saveFirewallAction, undefined);
  const [testState, testAction, testPending] = useActionState(testFirewallApiAction, undefined);
  const [bulkState, bulkAction, bulkPending] = useActionState(bulkUpdateFirewallsAction, undefined);
  const [showAllFirewalls, setShowAllFirewalls] = useState(false);
  const [editingFirewall, setEditingFirewall] = useState<FirewallWithSite | null>(null);
  const [modalEditingFirewall, setModalEditingFirewall] = useState<FirewallWithSite | null>(null);
  const [selectedFirewallIds, setSelectedFirewallIds] = useState<number[]>([]);
  const [liveHardwareById, setLiveHardwareById] = useState<Record<number, FirewallLiveHardwareRow>>({});
  const [hardwareLoading, setHardwareLoading] = useState(false);
  const [hardwareMessage, setHardwareMessage] = useState<string | null>(null);
  const [hardwareError, setHardwareError] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [regexSearch, setRegexSearch] = useState("");
  const visibleFirewalls = firewalls.slice(0, 5);

  const { filteredModalFirewalls, regexError } = useMemo(() => {
    if (!regexSearch.trim()) {
      return { filteredModalFirewalls: firewalls, regexError: null };
    }

    try {
      const regex = new RegExp(regexSearch.trim(), "i");
      return {
        regexError: null,
        filteredModalFirewalls: firewalls.filter((firewall) => {
          const live = liveHardwareById[firewall.id];
          return [
            firewall.id,
            firewall.name,
            firewall.ipAddress,
            firewall.hostname || "",
            live?.hostname || "",
            firewall.siteNumber,
            firewall.siteName,
            firewall.model || "",
            live?.model || "",
            firewall.serialNumber || "",
            live?.serialNumber || "",
            firewall.fmgDeviceName || "",
            firewall.apiTokenEncrypted ? "configured" : "not set",
            firewall.verifyTls ? "verify" : "skip"
          ]
            .join(" ")
            .match(regex);
        })
      };
    } catch (error) {
      return {
        filteredModalFirewalls: [],
        regexError: error instanceof Error ? error.message : "Invalid regular expression."
      };
    }
  }, [firewalls, liveHardwareById, regexSearch]);

  const filteredModalFirewallIds = filteredModalFirewalls.map((firewall) => firewall.id);
  const allVisibleFirewallsSelected =
    filteredModalFirewallIds.length > 0 &&
    filteredModalFirewallIds.every((id) => selectedFirewallIds.includes(id));

  useActionStateToast(state, pending);
  useActionStateToast(testState, testPending);
  useActionStateToast(bulkState, bulkPending);
  useMessageToast(hardwareMessage, hardwareError);
  useMessageToast(null, regexError);
  useFirewallLiveErrorToasts(firewalls, liveHardwareById);

  function toggleFirewallSelection(firewallId: number) {
    setSelectedFirewallIds((current) =>
      current.includes(firewallId) ? current.filter((id) => id !== firewallId) : [...current, firewallId]
    );
  }

  function selectAllVisibleFirewalls() {
    setSelectedFirewallIds((current) => Array.from(new Set([...current, ...filteredModalFirewallIds])));
  }

  function clearVisibleFirewalls() {
    setSelectedFirewallIds((current) => current.filter((id) => !filteredModalFirewallIds.includes(id)));
  }

  const refreshLiveHardware = useCallback(async (firewallIds: number[]) => {
    if (!firewallIds.length) {
      return;
    }
    setHardwareLoading(true);
    setHardwareError(null);
    setLiveHardwareById((current) => {
      const next = { ...current };
      for (const id of firewallIds) {
        if (next[id]) {
          next[id] = { ...next[id], error: undefined };
        }
      }
      return next;
    });
    try {
      const rows = await loadFirewallLiveHardwareAction(firewallIds);
      setLiveHardwareById((current) => {
        const next = { ...current };
        for (const row of rows) {
          next[row.id] = row;
        }
        return next;
      });
    } catch (caught) {
      setHardwareError(caught instanceof Error ? caught.message : "Unable to load FortiGate hardware info.");
    } finally {
      setHardwareLoading(false);
    }
  }, []);

  async function saveLiveHardwareToDatabase() {
    if (!selectedFirewallIds.length) {
      setHardwareError("Select at least one firewall in the table before saving live data.");
      setHardwareMessage(null);
      return;
    }

    const targetIds = selectedFirewallIds;
    setHardwareLoading(true);
    setHardwareError(null);
    setHardwareMessage(null);
    try {
      const result = await syncFirewallHardwareToDbAction(targetIds);
      if (result.error) {
        setHardwareError(result.error);
        return;
      }
      setHardwareMessage(result.message || "Hardware info saved.");
      await refreshLiveHardware(targetIds);
    } catch (caught) {
      setHardwareError(caught instanceof Error ? caught.message : "Unable to save FortiGate hardware info.");
    } finally {
      setHardwareLoading(false);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <form key={editingFirewall?.id || "new"} action={action} className="grid min-w-0 gap-3 md:grid-cols-3">
        <input type="hidden" name="firewallId" value={editingFirewall?.id || ""} />
        <div className="space-y-2">
          <Label htmlFor="siteId">Site</Label>
          <select
            id="siteId"
            name="siteId"
            defaultValue={editingFirewall?.siteId}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
            required
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.siteNumber} - {site.name}
              </option>
            ))}
          </select>
        </div>
        <Field name="name" label="Firewall name" defaultValue={editingFirewall?.name} />
        <Field
          name="ipAddress"
          label="IP address"
          defaultValue={editingFirewall?.ipAddress}
          pattern={ipv4Pattern}
          title="Enter a valid IPv4 address, for example 10.10.101.1"
        />
        <Field name="model" label="Model" required={false} defaultValue={editingFirewall?.model || ""} />
        <Field
          name="serialNumber"
          label="Serial number"
          required={false}
          defaultValue={editingFirewall?.serialNumber || ""}
        />
        {fmgConfigured ? (
          <div className="space-y-2">
            <Label>FortiManager device</Label>
            <Input
              value={editingFirewall?.fmgDeviceName || "Sync from FortiManager to populate"}
              readOnly
              className="bg-slate-50"
            />
          </div>
        ) : (
          <Field
            name="apiToken"
            label="API token"
            required={false}
            type="password"
            autoComplete="new-password"
            placeholder={
              editingFirewall?.apiTokenEncrypted
                ? "Token on file — leave blank to keep, or paste a new one"
                : "Paste REST API token from FortiGate"
            }
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input name="verifyTls" type="checkbox" defaultChecked={editingFirewall?.verifyTls ?? true} />
          Verify TLS certificate
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-3">
          <Button type="submit" disabled={pending}>
            {editingFirewall ? "Update firewall" : "Save firewall"}
          </Button>
          {fmgConfigured ? (
            <Button type="submit" formAction={testAction} variant="outline" disabled={testPending || pending || !editingFirewall?.fmgDeviceName}>
              {testPending ? "Testing..." : "Test via FortiManager"}
            </Button>
          ) : (
            <Button type="submit" formAction={testAction} variant="outline" disabled={testPending || pending}>
              {testPending ? "Testing..." : "Test API token"}
            </Button>
          )}
          {editingFirewall ? (
            <Button type="button" variant="outline" onClick={() => setEditingFirewall(null)}>
              Cancel edit
            </Button>
          ) : null}
        </div>
      </form>

      <div className="space-y-2">
        {visibleFirewalls.map((firewall) => (
          <FirewallPreview key={firewall.id} firewall={firewall} onEdit={() => setEditingFirewall(firewall)} />
        ))}
      </div>

      {firewalls.length > 0 ? (
        <Dialog
          open={showAllFirewalls}
          onOpenChange={(open) => {
            setShowAllFirewalls(open);
            if (!open) {
              setRegexSearch("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              Show all {firewalls.length} firewalls
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>All Fortinet devices</DialogTitle>
              <DialogDescription>Edit, remove, or bulk update configured firewall records.</DialogDescription>
            </DialogHeader>
            <BulkUpdateFirewallsForm
              state={bulkState}
              action={bulkAction}
              pending={bulkPending}
              selectedFirewallIds={selectedFirewallIds}
              fmgConfigured={fmgConfigured}
            />
            {modalEditingFirewall ? (
              <FirewallEditForm
                firewall={modalEditingFirewall}
                sites={sites}
                state={state}
                testState={testState}
                action={action}
                testAction={testAction}
                pending={pending}
                testPending={testPending}
                fmgConfigured={fmgConfigured}
                onCancel={() => setModalEditingFirewall(null)}
              />
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="firewallRegexSearch">Regex search</Label>
              <Input
                id="firewallRegexSearch"
                value={regexSearch}
                onChange={(event) => setRegexSearch(event.target.value)}
                placeholder="FGT|10\\.0\\.0|Gandalf|Main Office"
              />
            </div>
            <FirewallSelectionToolbar
              totalCount={filteredModalFirewalls.length}
              totalAvailable={firewalls.length}
              selectedCount={selectedFirewallIds.length}
              allVisibleSelected={allVisibleFirewallsSelected}
              onSelectAllVisible={selectAllVisibleFirewalls}
              onClearVisible={clearVisibleFirewalls}
              onClearAll={() => setSelectedFirewallIds([])}
              onBulkRemove={() => setBulkDeleteOpen(true)}
            />
            <FirewallHardwareToolbar
              loading={hardwareLoading}
              message={hardwareMessage}
              error={hardwareError}
              selectedCount={selectedFirewallIds.length}
              onRefresh={() => {
                if (!selectedFirewallIds.length) {
                  setHardwareError("Select at least one firewall to refresh live data.");
                  setHardwareMessage(null);
                  return;
                }
                void refreshLiveHardware(selectedFirewallIds);
              }}
              onSave={() => void saveLiveHardwareToDatabase()}
            />
            <FirewallTable
              firewalls={filteredModalFirewalls}
              selectedFirewallIds={selectedFirewallIds}
              liveHardwareById={liveHardwareById}
              hardwareLoading={hardwareLoading}
              fmgConfigured={fmgConfigured}
              onToggleSelect={toggleFirewallSelection}
              onEdit={(firewall) => setModalEditingFirewall(firewall)}
            />

            <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Remove selected firewalls?</DialogTitle>
                  <DialogDescription>
                    {selectedFirewallIds.length
                      ? `Remove ${selectedFirewallIds.length} selected firewall${selectedFirewallIds.length === 1 ? "" : "s"}. This cannot be undone.`
                      : null}
                  </DialogDescription>
                </DialogHeader>
                {selectedFirewallIds.length ? (
                  <FirewallBulkDeleteForm
                    firewalls={firewalls.filter((firewall) => selectedFirewallIds.includes(firewall.id))}
                    onCancel={() => setBulkDeleteOpen(false)}
                    onSuccess={() => {
                      setBulkDeleteOpen(false);
                      setSelectedFirewallIds([]);
                    }}
                  />
                ) : null}
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function FirewallHardwareToolbar({
  loading,
  message,
  error,
  selectedCount,
  onRefresh,
  onSave
}: {
  loading: boolean;
  message: string | null;
  error: string | null;
  selectedCount: number;
  onRefresh: () => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-blue-100 bg-blue-50 p-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading || selectedCount === 0} onClick={onRefresh}>
          {loading ? "Loading from FortiGate..." : `Refresh selected (${selectedCount})`}
        </Button>
        <Button type="button" size="sm" disabled={loading || selectedCount === 0} onClick={onSave}>
          {loading ? "Saving..." : `Save live data for ${selectedCount} selected`}
        </Button>
      </div>
      <p className="text-xs text-blue-900">
        Hostname, model, and serial are read from the FortiGate API when FortiManager or a direct API token is configured.
        Refresh and save apply only to selected rows. Values marked live differ from what is stored in the database.
      </p>
    </div>
  );
}

function FirewallSelectionToolbar({
  totalCount,
  totalAvailable,
  selectedCount,
  allVisibleSelected,
  onSelectAllVisible,
  onClearVisible,
  onClearAll,
  onBulkRemove
}: {
  totalCount: number;
  totalAvailable: number;
  selectedCount: number;
  allVisibleSelected: boolean;
  onSelectAllVisible: () => void;
  onClearVisible: () => void;
  onClearAll: () => void;
  onBulkRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-[var(--muted-foreground)]">
        Showing {totalCount} of {totalAvailable} firewalls. {selectedCount} selected.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={allVisibleSelected ? onClearVisible : onSelectAllVisible}
          disabled={totalCount === 0}
        >
          {allVisibleSelected ? "Clear visible" : "Select all visible"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClearAll}>
          Clear all
        </Button>
        <Button type="button" variant="destructive" size="sm" disabled={selectedCount === 0} onClick={onBulkRemove}>
          Remove selected ({selectedCount})
        </Button>
      </div>
    </div>
  );
}

function FirewallBulkDeleteForm({
  firewalls,
  onCancel,
  onSuccess
}: {
  firewalls: FirewallWithSite[];
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, action, pending] = useActionState(bulkDeleteFirewallsAction, undefined);

  useActionStateToast(state, pending);

  useEffect(() => {
    if (state?.message && !pending) {
      onSuccess();
    }
  }, [state?.message, pending, onSuccess]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="firewallIds" value={firewalls.map((firewall) => firewall.id).join(",")} />
      <input type="hidden" name="firewallNames" value={firewalls.map((firewall) => firewall.name).join("|")} />
      <ul className="max-h-40 list-inside list-disc overflow-auto text-sm text-[var(--muted-foreground)]">
        {firewalls.map((firewall) => (
          <li key={firewall.id}>
            {firewall.name} ({firewall.ipAddress})
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Removing..." : `Remove ${firewalls.length} firewall${firewalls.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </form>
  );
}

function FirewallEditForm({
  firewall,
  sites,
  state,
  testState,
  action,
  testAction,
  pending,
  testPending,
  fmgConfigured,
  onCancel
}: {
  firewall: FirewallWithSite;
  sites: Array<Site & { firewallCount: number }>;
  state?: { error?: string; message?: string };
  testState?: { error?: string; message?: string };
  action: (payload: FormData) => void;
  testAction: (payload: FormData) => void;
  pending: boolean;
  testPending: boolean;
  fmgConfigured?: boolean;
  onCancel: () => void;
}) {
  return (
    <form key={firewall.id} action={action} className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-3">
      <input type="hidden" name="firewallId" value={firewall.id} />
      <div className="space-y-2">
        <Label htmlFor={`modal-siteId-${firewall.id}`}>Site</Label>
        <select
          id={`modal-siteId-${firewall.id}`}
          name="siteId"
          defaultValue={firewall.siteId}
          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
          required
        >
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.siteNumber} - {site.name}
            </option>
          ))}
        </select>
      </div>
      <Field name="name" label="Firewall name" defaultValue={firewall.name} />
      <Field
        name="ipAddress"
        label="IP address"
        defaultValue={firewall.ipAddress}
        pattern={ipv4Pattern}
        title="Enter a valid IPv4 address, for example 10.10.101.1"
      />
      <Field name="model" label="Model" required={false} defaultValue={firewall.model || ""} />
      <Field name="serialNumber" label="Serial number" required={false} defaultValue={firewall.serialNumber || ""} />
      {fmgConfigured ? (
        <div className="space-y-2">
          <Label>FortiManager device</Label>
          <Input value={firewall.fmgDeviceName || "Not synced"} readOnly className="bg-slate-50" />
        </div>
      ) : (
        <Field
          name="apiToken"
          label="API token"
          required={false}
          type="password"
          autoComplete="new-password"
          placeholder={
            firewall.apiTokenEncrypted
              ? "Token on file — leave blank to keep, or paste a new one"
              : "Paste REST API token from FortiGate"
          }
        />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input name="verifyTls" type="checkbox" defaultChecked={firewall.verifyTls} />
        Verify TLS certificate
      </label>
      <div className="flex flex-wrap gap-2 md:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Updating..." : "Update firewall"}
        </Button>
        {fmgConfigured ? (
          <Button
            type="submit"
            formAction={testAction}
            variant="outline"
            disabled={testPending || pending || !firewall.fmgDeviceName}
          >
            {testPending ? "Testing..." : "Test via FortiManager"}
          </Button>
        ) : (
          <Button type="submit" formAction={testAction} variant="outline" disabled={testPending || pending}>
            {testPending ? "Testing..." : "Test API token"}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel edit
        </Button>
      </div>
    </form>
  );
}

function BulkUpdateFirewallsForm({
  state,
  action,
  pending,
  selectedFirewallIds,
  fmgConfigured = false
}: {
  state?: { error?: string; message?: string };
  action: (payload: FormData) => void;
  pending: boolean;
  selectedFirewallIds: number[];
  fmgConfigured?: boolean;
}) {
  return (
    <form action={action} className="rounded-md border border-blue-100 bg-blue-50 p-3">
      {selectedFirewallIds.map((firewallId) => (
        <input key={firewallId} type="hidden" name="firewallIds" value={firewallId} />
      ))}
      <div className="grid gap-3 md:grid-cols-[12rem_1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="bulkTargetField">Bulk field</Label>
          <select
            id="bulkTargetField"
            name="targetField"
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="name">Firewall name</option>
            <option value="model">Model</option>
            <option value="serialNumber">Serial number</option>
            {!fmgConfigured ? <option value="apiToken">API token</option> : null}
            <option value="verifyTls">TLS setting</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bulkFormula">Formula</Label>
          <Input id="bulkFormula" name="formula" placeholder="FW_{siteNumber}_{ipAddress} or true/false for TLS" required />
        </div>
        <Button
          className="self-end"
          type="submit"
          variant="outline"
          disabled={pending || selectedFirewallIds.length === 0}
          onClick={(event) => {
            if (!window.confirm(`Apply this formula to ${selectedFirewallIds.length} selected firewalls?`)) {
              event.preventDefault();
            }
          }}
        >
          {pending ? "Updating..." : "Bulk update"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-blue-900">
        Variables: {"{id}"}, {"{name}"}, {"{ipAddress}"}, {"{siteNumber}"}, {"{siteName}"}, {"{model}"},{" "}
        {"{serialNumber}"}
      </p>
      <p className="mt-1 text-xs text-blue-900">
        {fmgConfigured
          ? "FortiManager handles API access. Bulk updates support name, model, serial, and TLS only."
          : "API token accepts a literal value or formula. TLS accepts true/false, yes/no, on/off, verify/skip."}
      </p>
      <p className="mt-1 text-xs text-blue-900">Bulk updates only apply to selected rows.</p>
    </form>
  );
}

const ADMIN_FIREWALL_COLUMNS: ResizableColumnDef[] = [
  { id: "select", defaultWidth: 72, minWidth: 56 },
  { id: "name", defaultWidth: 120, minWidth: 88 },
  { id: "hostname", defaultWidth: 140, minWidth: 96 },
  { id: "ip", defaultWidth: 120, minWidth: 96 },
  { id: "site", defaultWidth: 160, minWidth: 104 },
  { id: "model", defaultWidth: 140, minWidth: 96 },
  { id: "serial", defaultWidth: 140, minWidth: 96 },
  { id: "token", defaultWidth: 100, minWidth: 80 },
  { id: "tls", defaultWidth: 72, minWidth: 56 },
  { id: "edit", defaultWidth: 88, minWidth: 72 }
];

function FirewallTable({
  firewalls,
  selectedFirewallIds,
  liveHardwareById,
  hardwareLoading,
  fmgConfigured = false,
  onToggleSelect,
  onEdit
}: {
  firewalls: FirewallWithSite[];
  selectedFirewallIds: number[];
  liveHardwareById: Record<number, FirewallLiveHardwareRow>;
  hardwareLoading: boolean;
  fmgConfigured?: boolean;
  onToggleSelect: (firewallId: number) => void;
  onEdit: (firewall: FirewallWithSite) => void;
}) {
  return (
    <ResizableTable
      tableId="admin-firewalls"
      columns={ADMIN_FIREWALL_COLUMNS}
      className="max-h-[50vh] w-full min-w-0 overflow-auto rounded-md border border-[var(--border)] sm:max-h-[65vh]"
    >
      <ResizableTableElement>
        <thead className="bg-slate-100">
          <tr>
            <ResizableTh columnIndex={0} className="p-2">
              Select
            </ResizableTh>
            <ResizableTh columnIndex={1} className="p-2">
              Name
            </ResizableTh>
            <ResizableTh columnIndex={2} className="p-2">
              Hostname
            </ResizableTh>
            <ResizableTh columnIndex={3} className="p-2">
              IP address
            </ResizableTh>
            <ResizableTh columnIndex={4} className="p-2">
              Site
            </ResizableTh>
            <ResizableTh columnIndex={5} className="p-2">
              Model
            </ResizableTh>
            <ResizableTh columnIndex={6} className="p-2">
              Serial number
            </ResizableTh>
            <ResizableTh columnIndex={7} className="p-2">
              {fmgConfigured ? "FMGR device" : "API token"}
            </ResizableTh>
            <ResizableTh columnIndex={8} className="p-2">
              TLS
            </ResizableTh>
            <ResizableTh columnIndex={9} className="p-2">
              Edit
            </ResizableTh>
          </tr>
        </thead>
        <tbody>
          {firewalls.length === 0 ? (
            <tr>
              <td colSpan={10} className="p-4 text-center text-sm text-[var(--muted-foreground)]">
                No firewalls match this search.
              </td>
            </tr>
          ) : null}
          {firewalls.map((firewall) => {
            const live = liveHardwareById[firewall.id];
            const rowLoading = hardwareLoading && selectedFirewallIds.includes(firewall.id);
            const model = live?.model ?? (rowLoading ? "…" : firewall.model || "Unknown");
            const serialNumber = live?.serialNumber ?? (rowLoading ? "…" : firewall.serialNumber || "None");
            const hostname = live?.hostname ?? (rowLoading ? "…" : firewall.hostname || "—");
            const hostnameIsLive = Boolean(live?.liveHostname);
            const modelIsLive = Boolean(live?.liveModel);
            const serialIsLive = Boolean(live?.liveSerialNumber);

            return (
            <tr key={firewall.id} className="border-t border-[var(--border)]">
              <td className="p-2">
                <input
                  type="checkbox"
                  aria-label={`Select firewall ${firewall.name}`}
                  checked={selectedFirewallIds.includes(firewall.id)}
                  onChange={() => onToggleSelect(firewall.id)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                />
              </td>
              <td className={resizableTdClassName("font-semibold")}>{firewall.name}</td>
              <td className={resizableTdClassName()}>
                {hostname}
                {hostnameIsLive ? <span className="ml-1 text-xs text-green-700">(live)</span> : null}
              </td>
              <td className={resizableTdClassName("font-mono")}>{firewall.ipAddress}</td>
              <td className={resizableTdClassName()}>
                {firewall.siteNumber} - {firewall.siteName}
              </td>
              <td className={resizableTdClassName("overflow-hidden break-words whitespace-normal")}>
                {model}
                {modelIsLive ? <span className="ml-1 text-xs text-green-700">(live)</span> : null}
                {live?.apiStatus === "not_configured" ? (
                  <span className="mt-1 block text-xs text-amber-800">
                    {fmgConfigured ? "Not synced via FortiManager" : "No API token"}
                  </span>
                ) : null}
                {live?.apiStatus === "offline" ? (
                  <span className="mt-1 block text-xs text-red-700">API offline — see notification</span>
                ) : null}
              </td>
              <td className={resizableTdClassName("font-mono")}>
                {serialNumber}
                {serialIsLive ? <span className="ml-1 text-xs text-green-700">(live)</span> : null}
              </td>
              <td className={resizableTdClassName()}>
                {fmgConfigured
                  ? firewall.fmgDeviceName || "Not synced"
                  : firewall.apiTokenEncrypted
                    ? "Configured"
                    : "Not set"}
              </td>
              <td className={resizableTdClassName()}>{firewall.verifyTls ? "Verify" : "Skip"}</td>
              <td className={resizableTdClassName("p-2")}>
                <Button type="button" variant="outline" size="sm" onClick={() => onEdit(firewall)}>
                  Edit
                </Button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </ResizableTableElement>
    </ResizableTable>
  );
}

function FirewallPreview({ firewall, onEdit }: { firewall: FirewallWithSite; onEdit: () => void }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {firewall.name} <span className="font-mono text-sm">({firewall.ipAddress})</span>
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">
            {firewall.siteNumber} - {firewall.siteName}
            {firewall.fmgDeviceName ? ` · FMGR: ${firewall.fmgDeviceName}` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  required = true,
  type = "text",
  defaultValue = "",
  pattern,
  title,
  placeholder,
  autoComplete
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
  pattern?: string;
  title?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        pattern={pattern}
        title={title}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
      />
    </div>
  );
}
