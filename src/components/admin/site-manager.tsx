"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { useActionStateToast, useMessageToast } from "@/hooks/use-action-state-toast";
import { bulkDeleteSitesAction, bulkUpdateSitesAction, updateSiteAction } from "@/lib/admin/actions";
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
import { Textarea } from "@/components/ui/textarea";
import type { Site } from "@/lib/types";

type SiteWithCount = Site & { firewallCount: number };

export function SiteManager({ sites }: { sites: SiteWithCount[] }) {
  const [selectedSite, setSelectedSite] = useState<SiteWithCount | null>(null);
  const [showAllSites, setShowAllSites] = useState(false);
  const visibleSites = sites.slice(0, 5);

  return (
    <div className="min-w-0 space-y-3">
      <SitePreviewTable sites={visibleSites} />
      {sites.length > 0 ? (
        <Dialog open={showAllSites} onOpenChange={setShowAllSites}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              Show all {sites.length} sites
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-6xl">
            <DialogHeader>
              <DialogTitle>All sites</DialogTitle>
              <DialogDescription>Search, edit, remove, or bulk update configured sites.</DialogDescription>
            </DialogHeader>
            <SiteModalContent
              sites={sites}
              selectedSite={selectedSite}
              onEdit={setSelectedSite}
              onCancelEdit={() => setSelectedSite(null)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function SiteModalContent({
  sites,
  selectedSite,
  onEdit,
  onCancelEdit
}: {
  sites: SiteWithCount[];
  selectedSite: SiteWithCount | null;
  onEdit: (site: SiteWithCount) => void;
  onCancelEdit: () => void;
}) {
  const [regexSearch, setRegexSearch] = useState("");
  const [selectedSiteIds, setSelectedSiteIds] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateSiteAction, undefined);
  const [bulkState, bulkAction, bulkPending] = useActionState(bulkUpdateSitesAction, undefined);

  const { filteredSites, regexError } = useMemo(() => {
    if (!regexSearch.trim()) {
      return { filteredSites: sites, regexError: null };
    }

    try {
      const regex = new RegExp(regexSearch.trim(), "i");
      return {
        regexError: null,
        filteredSites: sites.filter((site) =>
          [
            site.id,
            site.siteNumber,
            site.name,
            site.address1,
            site.address2 || "",
            site.city,
            site.state,
            site.postalCode,
            site.notes || "",
            site.firewallCount
          ]
            .join(" ")
            .match(regex)
        )
      };
    } catch (error) {
      return {
        filteredSites: [],
        regexError: error instanceof Error ? error.message : "Invalid regular expression."
      };
    }
  }, [regexSearch, sites]);

  useActionStateToast(updateState, updatePending);
  useActionStateToast(bulkState, bulkPending);
  useMessageToast(null, regexError);

  const filteredSiteIds = filteredSites.map((site) => site.id);
  const selectedIdSet = new Set(selectedSiteIds);
  const allFilteredSelected = filteredSiteIds.length > 0 && filteredSiteIds.every((id) => selectedIdSet.has(id));

  function toggleSiteSelection(siteId: number) {
    setSelectedSiteIds((current) =>
      current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId]
    );
  }

  function selectAllFilteredSites() {
    setSelectedSiteIds((current) => Array.from(new Set([...current, ...filteredSiteIds])));
  }

  function clearFilteredSites() {
    setSelectedSiteIds((current) => current.filter((id) => !filteredSiteIds.includes(id)));
  }

  return (
    <div className="min-w-0 space-y-4">
      <BulkSiteUpdateForm
        state={bulkState}
        action={bulkAction}
        pending={bulkPending}
        selectedSiteIds={selectedSiteIds}
      />
      {selectedSite ? (
        <SiteEditForm
          site={selectedSite}
          state={updateState}
          action={updateAction}
          pending={updatePending}
          onCancel={onCancelEdit}
        />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="siteRegexSearch">Regex search</Label>
        <Input
          id="siteRegexSearch"
          value={regexSearch}
          onChange={(event) => setRegexSearch(event.target.value)}
          placeholder="Main Office|Atlanta|10[0-9]"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted-foreground)]">
          Showing {filteredSites.length} of {sites.length} sites. {selectedSiteIds.length} selected.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={allFilteredSelected ? clearFilteredSites : selectAllFilteredSites}
            disabled={filteredSites.length === 0}
          >
            {allFilteredSelected ? "Clear visible" : "Select all visible"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setSelectedSiteIds([])}>
            Clear all
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={selectedSiteIds.length === 0}
            onClick={() => setBulkDeleteOpen(true)}
          >
            Remove selected ({selectedSiteIds.length})
          </Button>
        </div>
      </div>
      <SiteFullTable
        sites={filteredSites}
        selectedSiteIds={selectedSiteIds}
        onToggleSelect={toggleSiteSelection}
        onEdit={onEdit}
      />

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove selected sites?</DialogTitle>
            <DialogDescription>
              {selectedSiteIds.length
                ? `Remove ${selectedSiteIds.length} selected site${selectedSiteIds.length === 1 ? "" : "s"} and any associated firewalls. This cannot be undone.`
                : null}
            </DialogDescription>
          </DialogHeader>
          {selectedSiteIds.length ? (
            <SiteBulkDeleteForm
              sites={sites.filter((site) => selectedSiteIds.includes(site.id))}
              onCancel={() => setBulkDeleteOpen(false)}
              onSuccess={() => {
                const removedIds = new Set(sites.filter((site) => selectedSiteIds.includes(site.id)).map((site) => site.id));
                setBulkDeleteOpen(false);
                setSelectedSiteIds([]);
                if (selectedSite && removedIds.has(selectedSite.id)) {
                  onCancelEdit();
                }
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SiteBulkDeleteForm({
  sites,
  onCancel,
  onSuccess
}: {
  sites: SiteWithCount[];
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, action, pending] = useActionState(bulkDeleteSitesAction, undefined);
  const totalFirewalls = sites.reduce((sum, site) => sum + site.firewallCount, 0);

  useActionStateToast(state, pending);

  useEffect(() => {
    if (state?.message && !pending) {
      onSuccess();
    }
  }, [state?.message, pending, onSuccess]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="siteIds" value={sites.map((site) => site.id).join(",")} />
      <input type="hidden" name="siteNumbers" value={sites.map((site) => site.siteNumber).join("|")} />
      <ul className="max-h-40 list-inside list-disc overflow-auto text-sm text-[var(--muted-foreground)]">
        {sites.map((site) => (
          <li key={site.id}>
            {site.siteNumber} - {site.name}
            {site.firewallCount > 0 ? ` (${site.firewallCount} firewall${site.firewallCount === 1 ? "" : "s"})` : ""}
          </li>
        ))}
      </ul>
      {totalFirewalls > 0 ? (
        <p className="text-sm text-amber-900">
          {totalFirewalls} associated firewall{totalFirewalls === 1 ? "" : "s"} will also be removed.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Removing..." : `Remove ${sites.length} site${sites.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </form>
  );
}

function BulkSiteUpdateForm({
  state,
  action,
  pending,
  selectedSiteIds
}: {
  state?: { error?: string; message?: string };
  action: (payload: FormData) => void;
  pending: boolean;
  selectedSiteIds: number[];
}) {
  return (
    <form action={action} className="rounded-md border border-blue-100 bg-blue-50 p-3">
      {selectedSiteIds.map((siteId) => (
        <input key={siteId} type="hidden" name="siteIds" value={siteId} />
      ))}
      <div className="grid gap-3 md:grid-cols-[12rem_1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="siteBulkTargetField">Bulk field</Label>
          <select
            id="siteBulkTargetField"
            name="targetField"
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="siteNumber">Site number</option>
            <option value="name">Site name</option>
            <option value="address1">Address 1</option>
            <option value="address2">Address 2</option>
            <option value="city">City</option>
            <option value="state">State</option>
            <option value="postalCode">Postal code</option>
            <option value="notes">Notes</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="siteBulkFormula">Formula</Label>
          <Input id="siteBulkFormula" name="formula" placeholder="Site {siteNumber} - {city}" required />
        </div>
        <Button
          className="self-end"
          type="submit"
          variant="outline"
          disabled={pending || selectedSiteIds.length === 0}
          onClick={(event) => {
            if (!window.confirm(`Apply this formula to ${selectedSiteIds.length} selected sites?`)) {
              event.preventDefault();
            }
          }}
        >
          {pending ? "Updating..." : "Bulk update"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-blue-900">
        Variables: {"{id}"}, {"{siteNumber}"}, {"{name}"}, {"{address1}"}, {"{address2}"}, {"{city}"},{" "}
        {"{state}"}, {"{postalCode}"}, {"{notes}"}, {"{firewallCount}"}
      </p>
      <p className="mt-1 text-xs text-blue-900">Bulk updates only apply to selected rows.</p>
    </form>
  );
}

function SiteEditForm({
  site,
  state,
  action,
  pending,
  onCancel
}: {
  site: SiteWithCount;
  state?: { error?: string; message?: string };
  action: (payload: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <form key={site.id} action={action} className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-2">
      <input type="hidden" name="siteId" value={site.id} />
      <SiteField name="siteNumber" label="Site number" defaultValue={site.siteNumber} />
      <SiteField name="name" label="Site name" defaultValue={site.name} />
      <SiteField name="address1" label="Address 1" defaultValue={site.address1} />
      <SiteField name="address2" label="Address 2" required={false} defaultValue={site.address2 || ""} />
      <SiteField name="city" label="City" defaultValue={site.city} />
      <SiteField name="state" label="State" defaultValue={site.state} />
      <SiteField name="postalCode" label="Postal code" defaultValue={site.postalCode} />
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={site.notes || ""} />
      </div>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Updating..." : "Update site"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel edit
        </Button>
      </div>
    </form>
  );
}

const SITE_PREVIEW_COLUMNS: ResizableColumnDef[] = [
  { id: "site", defaultWidth: 96, minWidth: 72 },
  { id: "name", defaultWidth: 160, minWidth: 96 },
  { id: "address", defaultWidth: 200, minWidth: 120 },
  { id: "firewalls", defaultWidth: 96, minWidth: 72 }
];

const SITE_FULL_COLUMNS: ResizableColumnDef[] = [
  { id: "select", defaultWidth: 52, minWidth: 48 },
  { id: "siteNumber", defaultWidth: 112, minWidth: 88 },
  { id: "name", defaultWidth: 128, minWidth: 96 },
  { id: "address1", defaultWidth: 132, minWidth: 96 },
  { id: "address2", defaultWidth: 112, minWidth: 88 },
  { id: "city", defaultWidth: 100, minWidth: 80 },
  { id: "state", defaultWidth: 64, minWidth: 52 },
  { id: "postal", defaultWidth: 108, minWidth: 88 },
  { id: "notes", defaultWidth: 120, minWidth: 88 },
  { id: "firewalls", defaultWidth: 92, minWidth: 72 },
  { id: "edit", defaultWidth: 72, minWidth: 64 }
];

function SitePreviewTable({ sites }: { sites: SiteWithCount[] }) {
  return (
    <ResizableTable
      tableId="admin-sites-preview"
      columns={SITE_PREVIEW_COLUMNS}
      className="max-h-80 w-full min-w-0 overflow-auto rounded-md border border-[var(--border)]"
    >
      <ResizableTableElement>
        <thead className="bg-slate-100">
          <tr>
            <ResizableTh columnIndex={0} className="p-2">
              Site
            </ResizableTh>
            <ResizableTh columnIndex={1} className="p-2">
              Name
            </ResizableTh>
            <ResizableTh columnIndex={2} className="p-2">
              Address
            </ResizableTh>
            <ResizableTh columnIndex={3} className="p-2">
              Firewalls
            </ResizableTh>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id} className="border-t border-[var(--border)]">
              <td className={resizableTdClassName("p-2 font-mono")}>{site.siteNumber}</td>
              <td className={resizableTdClassName("p-2")}>{site.name}</td>
              <td className={resizableTdClassName("p-2")}>
                {site.city}, {site.state}
              </td>
              <td className={resizableTdClassName("p-2")}>{site.firewallCount}</td>
            </tr>
          ))}
        </tbody>
      </ResizableTableElement>
    </ResizableTable>
  );
}

function SiteFullTable({
  sites,
  selectedSiteIds,
  onToggleSelect,
  onEdit
}: {
  sites: SiteWithCount[];
  selectedSiteIds: number[];
  onToggleSelect: (siteId: number) => void;
  onEdit: (site: SiteWithCount) => void;
}) {
  return (
    <ResizableTable
      tableId="admin-sites-full"
      columns={SITE_FULL_COLUMNS}
      className="max-h-[50vh] w-full min-w-0 overflow-auto rounded-md border border-[var(--border)] sm:max-h-[65vh]"
    >
      <ResizableTableElement>
        <thead className="bg-slate-100">
          <tr>
            <ResizableTh columnIndex={0} className="p-2">
              Select
            </ResizableTh>
            <ResizableTh columnIndex={1} className="p-2">
              Site number
            </ResizableTh>
            <ResizableTh columnIndex={2} className="p-2">
              Name
            </ResizableTh>
            <ResizableTh columnIndex={3} className="p-2">
              Address 1
            </ResizableTh>
            <ResizableTh columnIndex={4} className="p-2">
              Address 2
            </ResizableTh>
            <ResizableTh columnIndex={5} className="p-2">
              City
            </ResizableTh>
            <ResizableTh columnIndex={6} className="p-2">
              State
            </ResizableTh>
            <ResizableTh columnIndex={7} className="p-2">
              Postal code
            </ResizableTh>
            <ResizableTh columnIndex={8} className="p-2">
              Notes
            </ResizableTh>
            <ResizableTh columnIndex={9} className="p-2">
              Firewalls
            </ResizableTh>
            <ResizableTh columnIndex={10} className="p-2">
              Edit
            </ResizableTh>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id} className="border-t border-[var(--border)]">
              <td className="p-2">
                <input
                  type="checkbox"
                  aria-label={`Select site ${site.siteNumber}`}
                  checked={selectedSiteIds.includes(site.id)}
                  onChange={() => onToggleSelect(site.id)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                />
              </td>
              <td className={resizableTdClassName("font-mono")}>{site.siteNumber}</td>
              <td className={resizableTdClassName()}>{site.name}</td>
              <td className={resizableTdClassName()}>{site.address1}</td>
              <td className={resizableTdClassName()}>{site.address2 || "None"}</td>
              <td className={resizableTdClassName()}>{site.city}</td>
              <td className={resizableTdClassName()}>{site.state}</td>
              <td className={resizableTdClassName()}>{site.postalCode}</td>
              <td className={resizableTdClassName()}>{site.notes || "None"}</td>
              <td className={resizableTdClassName()}>{site.firewallCount}</td>
              <td className={resizableTdClassName("p-2")}>
                <Button type="button" variant="outline" size="sm" onClick={() => onEdit(site)}>
                  Edit
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </ResizableTableElement>
    </ResizableTable>
  );
}

function SiteField({
  name,
  label,
  defaultValue,
  required = true
}: {
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} required={required} />
    </div>
  );
}
