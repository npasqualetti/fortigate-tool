"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActionState } from "react";
import { useActionStateToast } from "@/hooks/use-action-state-toast";
import {
  beginFortiManagerSyncAction,
  cancelFortiManagerSyncAction,
  processFortiManagerSyncBatchAction,
  saveFortiManagerAction,
  testFortiManagerAction,
  type FortiManagerActionState
} from "@/lib/fortimanager/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PublicSettings = {
  configured: boolean;
  host: string;
  verifyTls: boolean;
  adom: string;
  apiKeyStored: boolean;
  lastSyncedAt: string | null;
};

export function FortiManagerSettingsPanel({
  initialSettings
}: {
  initialSettings: {
    host: string;
    apiKey: string;
    verifyTls: boolean;
    adom: string;
    publicSettings: PublicSettings;
  };
}) {
  const router = useRouter();
  const [host, setHost] = useState(initialSettings.host);
  const [apiKey, setApiKey] = useState(initialSettings.apiKey);
  const [verifyTls, setVerifyTls] = useState(initialSettings.verifyTls);
  const [adom, setAdom] = useState(initialSettings.adom);
  const [testState, testAction, testPending] = useActionState(testFortiManagerAction, undefined);
  const [saveState, saveAction, savePending] = useActionState(saveFortiManagerAction, undefined);
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncPending, setSyncPending] = useState(false);

  useActionStateToast(testState, testPending);
  useActionStateToast(saveState, savePending);

  async function runBatchedSync() {
    if (!initialSettings.publicSettings.configured) {
      return;
    }

    setSyncPending(true);
    setSyncError(null);
    setSyncMessage(null);
    setSyncProgress(null);

    let syncId: string | undefined;
    try {
      const begin = await beginFortiManagerSyncAction();
      if (begin?.error) {
        setSyncError(begin.error);
        return;
      }
      if (!begin?.syncId) {
        setSyncMessage(begin?.message || "No devices to sync.");
        if (begin?.complete) {
          router.refresh();
        }
        return;
      }

      syncId = begin.syncId;
      setSyncProgress({ processed: begin.processed ?? 0, total: begin.total ?? 0 });
      setSyncMessage(begin.message || null);

      let offset = 0;
      let complete = begin.complete ?? false;
      while (!complete) {
        const batch = await processFortiManagerSyncBatchAction(syncId, offset);
        if (batch?.error) {
          setSyncError(batch.error);
          return;
        }
        setSyncProgress({
          processed: batch?.processed ?? offset,
          total: batch?.total ?? begin.total ?? 0
        });
        setSyncMessage(batch?.message || null);
        complete = batch?.complete ?? false;
        offset = batch?.processed ?? offset;
      }

      setSyncMessage(batchMessage(batch) || `Synced ${begin.total ?? 0} FortiGate device(s).`);
      router.refresh();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "FortiManager sync failed.");
      if (syncId) {
        await cancelFortiManagerSyncAction(syncId).catch(() => undefined);
      }
    } finally {
      setSyncPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted-foreground)]">
        All FortiGate operations run through FortiManager over the FGFM tunnel — not direct HTTPS to the FortiGate,
        so FortiGate firewall rules and per-device API tokens are not required. POE reset needs FortiManager proxy
        permission (adom-access all, rpc-permit read-write, Super_User, trusthost for the app server IP). Device import
        runs in batches so large inventories (300+ FortiGates) do not hit server timeouts.
      </p>

      <form action={saveAction} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fmgHost">FortiManager host / IP</Label>
          <Input
            id="fmgHost"
            name="host"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="10.0.0.5 or fmg.example.local"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fmgApiKey">FortiManager API key</Label>
          <Input
            id="fmgApiKey"
            name="apiKey"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={initialSettings.publicSettings.apiKeyStored ? "Encrypted API key stored" : "Paste API key"}
            required={!initialSettings.publicSettings.apiKeyStored}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fmgAdom">ADOM (optional)</Label>
          <Input
            id="fmgAdom"
            name="adom"
            value={adom}
            onChange={(event) => setAdom(event.target.value)}
            placeholder="Leave blank — recommended for most setups"
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input name="verifyTls" type="checkbox" checked={verifyTls} onChange={(event) => setVerifyTls(event.target.checked)} />
            Verify TLS certificate
          </label>
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" formAction={testAction} variant="outline" disabled={testPending || savePending || syncPending}>
            {testPending ? "Testing..." : "Test connection"}
          </Button>
          <Button type="submit" disabled={savePending || testPending || syncPending}>
            {savePending ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </form>

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          disabled={syncPending || !initialSettings.publicSettings.configured}
          onClick={() => void runBatchedSync()}
        >
          {syncPending ? "Syncing..." : "Sync all FortiGate devices"}
        </Button>
        {syncProgress && syncProgress.total > 0 ? (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-[var(--primary)] transition-all"
                style={{ width: `${Math.round((syncProgress.processed / syncProgress.total) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Imported {syncProgress.processed} of {syncProgress.total} device
              {syncProgress.total === 1 ? "" : "s"}
              {syncPending ? "…" : "."}
            </p>
          </div>
        ) : null}
        {syncMessage ? <p className="text-sm text-green-800">{syncMessage}</p> : null}
        {syncError ? <p className="text-sm text-red-800">{syncError}</p> : null}
      </div>

      {initialSettings.publicSettings.lastSyncedAt ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Last sync: {new Date(initialSettings.publicSettings.lastSyncedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

function batchMessage(state: FortiManagerActionState) {
  return state?.message ?? null;
}
