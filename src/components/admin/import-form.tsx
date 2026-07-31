"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { showErrorToast, showSuccessToast } from "@/hooks/use-action-state-toast";
import { importSitesAction } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ImportForm() {
  const [state, action, pending] = useActionState(importSitesAction, undefined);
  const lastToastKey = useRef<string | null>(null);

  useEffect(() => {
    if (pending) {
      return;
    }

    if (state?.message) {
      const key = `m:${state.message}`;
      if (lastToastKey.current !== key) {
        lastToastKey.current = key;
        showSuccessToast(state.message);
      }
      return;
    }

    if (state?.errors?.length) {
      const key = `e:${state.errors.join("|")}`;
      if (lastToastKey.current !== key) {
        lastToastKey.current = key;
        showErrorToast(state.errors.join(" "));
      }
    }
  }, [state, pending]);

  const exampleCsv =
    "siteNumber,name,address1,address2,city,state,postalCode,firewallName,ipAddress,model,serialNumber\n" +
    "101,Main Office,123 Main St,Suite 200,Atlanta,GA,30301,FGT-101,10.10.101.1,FortiGate 100F,FGT123456";

  return (
    <section className="min-w-0 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">CSV import</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          Paste site and firewall rows from a CSV export, then validate and import them.
        </p>
      </div>
      <form action={action} className="min-w-0 space-y-3">
      <Textarea
        name="csv"
        placeholder={exampleCsv}
        className="min-h-40 font-mono text-xs"
        required
      />
      <div className="min-w-0 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        <p className="font-semibold">Example site row</p>
        <pre className="mt-2 max-w-full overflow-x-auto break-all font-mono whitespace-pre-wrap">{exampleCsv}</pre>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Importing..." : "Validate and import"}
      </Button>
      </form>
    </section>
  );
}
