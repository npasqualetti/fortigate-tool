"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { showErrorToast, showSuccessToast } from "@/hooks/use-action-state-toast";
import {
  beginFortiManagerSyncAction,
  cancelFortiManagerSyncAction,
  processFortiManagerSyncBatchAction,
  testAndSaveFortiManagerConnection,
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

type SyncPhase = "idle" | "discovering" | "importing" | "complete" | "error";

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
  const [configured, setConfigured] = useState(initialSettings.publicSettings.configured);
  const [testState, setTestState] = useState<FortiManagerActionState>();
  const [testPending, startTest] = useTransition();
  const [syncPhase, setSyncPhase] = useState<SyncPhase>("idle");
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  const [syncStatusText, setSyncStatusText] = useState<string | null>(null);

  const syncPending = syncPhase === "discovering" || syncPhase === "importing";

  function handleTestAndSave() {
    setTestState(undefined);
    startTest(async () => {
      try {
        const result = await testAndSaveFortiManagerConnection({
          host,
          apiKey,
          verifyTls,
          adom
        });
        setTestState(result);
        if (result?.error) {
          showErrorToast(result.error);
          return;
        }
        if (result?.message) {
          setConfigured(true);
          showSuccessToast(result.message);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "FortiManager test failed.";
        setTestState({ error: message });
        showErrorToast(message);
      }
    });
  }

  async function runBatchedSync() {
    if (!configured) {
      showErrorToast("Test and save the FortiManager connection before syncing devices.");
      return;
    }

    setSyncPhase("discovering");
    setSyncStatusText("Querying FortiManager inventory…");
    setSyncProgress(null);

    let syncId: string | undefined;
    try {
      const begin = await beginFortiManagerSyncAction();
      if (begin?.error) {
        setSyncPhase("error");
        setSyncStatusText(begin.error);
        showErrorToast(begin.error);
        return;
      }

      if (!begin?.syncId) {
        const message = begin?.message || "No devices to sync.";
        setSyncPhase("complete");
        setSyncStatusText(message);
        showSuccessToast(message);
        router.refresh();
        return;
      }

      syncId = begin.syncId;
      const total = begin.total ?? 0;
      setSyncPhase("importing");
      setSyncProgress({ processed: begin.processed ?? 0, total });
      setSyncStatusText(`Importing devices… 0 of ${total}`);

      let offset = 0;
      let complete = begin.complete ?? false;
      let lastMessage = begin.message || null;

      while (!complete) {
        const batch = await processFortiManagerSyncBatchAction(syncId, offset);
        if (batch?.error) {
          setSyncPhase("error");
          setSyncStatusText(batch.error);
          showErrorToast(batch.error);
          return;
        }

        const processed = batch?.processed ?? offset;
        setSyncProgress({ processed, total: batch?.total ?? total });
        setSyncStatusText(`Importing devices… ${processed} of ${batch?.total ?? total}`);
        lastMessage = batch?.message || lastMessage;
        complete = batch?.complete ?? false;
        offset = processed;
      }

      const doneMessage = lastMessage || `Synced ${total} FortiGate device(s) from FortiManager.`;
      setSyncPhase("complete");
      setSyncStatusText(doneMessage);
      showSuccessToast(doneMessage);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "FortiManager sync failed.";
      setSyncPhase("error");
      setSyncStatusText(message);
      showErrorToast(message);
      if (syncId) {
        await cancelFortiManagerSyncAction(syncId).catch(() => undefined);
      }
    }
  }

  const syncPercent =
    syncProgress && syncProgress.total > 0
      ? Math.round((syncProgress.processed / syncProgress.total) * 100)
      : syncPhase === "discovering"
        ? null
        : 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted-foreground)]">
        All FortiGate operations run through FortiManager over the FGFM tunnel — not direct HTTPS to the FortiGate,
        so FortiGate firewall rules and per-device API tokens are not required. POE reset needs FortiManager proxy
        permission (adom-access all, rpc-permit read-write, Super_User, trusthost for the app server IP). Device import
        runs in batches so large inventories (300+ FortiGates) do not hit server timeouts.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fmgHost">FortiManager host / IP</Label>
          <Input
            id="fmgHost"
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
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={initialSettings.publicSettings.apiKeyStored ? "Encrypted API key stored" : "Paste API key"}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fmgAdom">ADOM (optional)</Label>
          <Input
            id="fmgAdom"
            value={adom}
            onChange={(event) => setAdom(event.target.value)}
            placeholder="Leave blank — recommended for most setups"
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={verifyTls} onChange={(event) => setVerifyTls(event.target.checked)} />
            Verify TLS certificate
          </label>
        </div>
        <div className="md:col-span-2 space-y-3">
          <Button type="button" disabled={testPending || syncPending} onClick={handleTestAndSave}>
            {testPending ? (
              <span className="flex items-center gap-2">
                <Spinner />
                Testing & saving…
              </span>
            ) : (
              "Test connection & save"
            )}
          </Button>
          <p className="text-xs text-[var(--muted-foreground)]">
            A successful test saves these settings automatically. Results appear below and as a notification.
          </p>
          {testPending ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              Testing FortiManager connection and write proxy…
            </div>
          ) : null}
          {testState?.message ? (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900" role="status">
              {testState.message}
            </div>
          ) : null}
          {testState?.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
              {testState.error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-[var(--border)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={syncPending || !configured} onClick={() => void runBatchedSync()}>
            {syncPhase === "discovering" ? (
              <span className="flex items-center gap-2">
                <Spinner />
                Discovering…
              </span>
            ) : syncPhase === "importing" && syncProgress ? (
              <span className="flex items-center gap-2">
                <Spinner />
                Syncing {syncProgress.processed}/{syncProgress.total}
              </span>
            ) : (
              "Sync all FortiGate devices"
            )}
          </Button>
          {!configured ? (
            <p className="text-sm text-[var(--muted-foreground)]">Test and save the connection above before syncing.</p>
          ) : null}
        </div>

        {syncPending || syncPhase === "complete" || syncPhase === "error" ? (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              {syncPhase === "discovering" ? (
                <div className="h-full w-2/5 animate-pulse rounded-full bg-[var(--primary)]" />
              ) : (
                <div
                  className="h-full bg-[var(--primary)] transition-all duration-300"
                  style={{ width: `${syncPercent ?? 0}%` }}
                />
              )}
            </div>
            {syncStatusText ? (
              <p
                className={`text-sm ${
                  syncPhase === "error" ? "text-red-800" : syncPhase === "complete" ? "text-green-800" : "text-[var(--muted-foreground)]"
                }`}
              >
                {syncStatusText}
                {syncPhase === "importing" && syncPercent !== null ? ` (${syncPercent}%)` : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {initialSettings.publicSettings.lastSyncedAt ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Last sync: {new Date(initialSettings.publicSettings.lastSyncedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
