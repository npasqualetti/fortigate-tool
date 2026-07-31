"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { FortinetCableTestResult } from "@/lib/fortinet/client";

const TOAST_DURATION_MS = 3000;

export type ActionToastState = { error?: string; message?: string } | undefined;

function notifyOnce(key: string, lastKey: MutableRefObject<string | null>, notify: () => void) {
  if (lastKey.current === key) {
    return;
  }
  lastKey.current = key;
  notify();
}

export function showSuccessToast(message: string) {
  toast.success(message, { duration: TOAST_DURATION_MS });
}

export function showErrorToast(message: string) {
  toast.error(message, { duration: TOAST_DURATION_MS });
}

export function showInfoToast(message: string) {
  toast.message(message, { duration: TOAST_DURATION_MS });
}

/** Shows success/error toasts when a useActionState result changes (not while pending). */
export function useActionStateToast(state: ActionToastState, pending?: boolean) {
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (pending) {
      return;
    }

    const key = state?.error ? `e:${state.error}` : state?.message ? `m:${state.message}` : null;
    if (!key) {
      return;
    }

    if (state?.error) {
      notifyOnce(key, lastKey, () => showErrorToast(state.error!));
    } else if (state?.message) {
      notifyOnce(key, lastKey, () => showSuccessToast(state.message!));
    }
  }, [state, pending]);
}

/** Toast FortiGate live-hardware errors (e.g. after refresh in the firewall table). */
export function useFirewallLiveErrorToasts(
  firewalls: Array<{ id: number; name: string; ipAddress: string }>,
  liveHardwareById: Record<number, { apiStatus?: string; error?: string } | undefined>
) {
  const lastKeys = useRef<Record<number, string>>({});

  useEffect(() => {
    for (const firewall of firewalls) {
      const live = liveHardwareById[firewall.id];
      if (!live) {
        continue;
      }

      if (live.apiStatus === "offline" && live.error) {
        const key = live.error;
        if (lastKeys.current[firewall.id] === key) {
          continue;
        }
        lastKeys.current[firewall.id] = key;
        showErrorToast(shortFortinetToastMessage(firewall.name, firewall.ipAddress, live.error));
      } else if (live.apiStatus === "online") {
        delete lastKeys.current[firewall.id];
      }
    }
  }, [firewalls, liveHardwareById]);
}

function shortFortinetToastMessage(name: string, ipAddress: string, error: string) {
  const summary = error.includes("401")
    ? `${name} (${ipAddress}): API token rejected — use Test API token, then re-save if needed.`
    : `${name} (${ipAddress}): ${error.split(". ")[0]}.`;
  return summary.length > 220 ? `${summary.slice(0, 217)}...` : summary;
}

/** Toast per-interface cable test outcomes after a bulk test completes. */
export function useCableTestResultToasts(results: FortinetCableTestResult[] | undefined, pending?: boolean) {
  const lastBatchKey = useRef<string | null>(null);

  useEffect(() => {
    if (pending || !results?.length) {
      return;
    }

    const batchKey = results
      .map((result) => `${result.interfaceName}:${result.status}:${result.error ?? ""}:${result.summary ?? ""}`)
      .join("|");
    if (lastBatchKey.current === batchKey) {
      return;
    }
    lastBatchKey.current = batchKey;

    for (const result of results) {
      if (result.error) {
        showErrorToast(shortCableTestToastMessage(result.interfaceName, result.error));
      } else if (result.status === "pass") {
        showSuccessToast(
          result.summary
            ? `${result.interfaceName}: ${result.summary}`
            : `${result.interfaceName}: cable test passed`
        );
      }
    }
  }, [results, pending]);
}

function shortCableTestToastMessage(interfaceName: string, error: string) {
  const summary = error.includes("404")
    ? `${interfaceName}: cable test not available on this FortiOS build (API 404).`
    : `${interfaceName}: ${error.split(". ")[0]}.`;
  return summary.length > 220 ? `${summary.slice(0, 217)}...` : summary;
}

/** Toast when a string message/error is set (e.g. local state). */
export function useMessageToast(message: string | null | undefined, error: string | null | undefined) {
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const key = error ? `e:${error}` : message ? `m:${message}` : null;
    if (!key) {
      return;
    }

    if (error) {
      notifyOnce(key, lastKey, () => showErrorToast(error));
    } else if (message) {
      notifyOnce(key, lastKey, () => showSuccessToast(message));
    }
  }, [message, error]);
}
