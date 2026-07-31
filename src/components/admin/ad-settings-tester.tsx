"use client";

import { useEffect, useState, useActionState, useTransition } from "react";
import { useActionStateToast, useMessageToast } from "@/hooks/use-action-state-toast";
import {
  detectAdSettingsAction,
  saveAdSettingsAction,
  testAdSettingsAction,
  type AdSettingsActionState
} from "@/lib/admin/actions";
import type { AdSettings } from "@/lib/ad-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdSettingsTester({ initialSettings }: { initialSettings: AdSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [testUsername, setTestUsername] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);
  const [detectState, setDetectState] = useState<AdSettingsActionState>();
  const [detectPending, startDetect] = useTransition();
  const [testState, testAction, testPending] = useActionState(testAdSettingsAction, undefined);
  const [saveState, saveAction, savePending] = useActionState(saveAdSettingsAction, undefined);

  useEffect(() => {
    const detected = detectState?.detected;
    if (!detected) {
      return;
    }

    setSettings((current) => ({
      ...current,
      ...detected,
      adUsernameAttribute: detected.adUsernameAttribute || current.adUsernameAttribute,
      adGroupAttribute: detected.adGroupAttribute || current.adGroupAttribute
    }));
  }, [detectState?.detected]);

  function updateField<K extends keyof AdSettings>(key: K, value: AdSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function handleDetect() {
    startDetect(async () => {
      const result = await detectAdSettingsAction();
      setDetectState(result);
    });
  }

  useActionStateToast(testState, testPending);
  useActionStateToast(saveState, savePending);
  useMessageToast(detectPending ? null : detectState?.message, detectPending ? null : detectState?.error);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={handleDetect} disabled={detectPending}>
          {detectPending ? "Detecting..." : "Detect from this server"}
        </Button>
        <p className="self-center text-xs text-[var(--muted-foreground)]">
          On a domain-joined Windows host, reads USERDNSDOMAIN, LOGONSERVER, and USERDOMAIN.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="LDAP URL" id="adUrl" value={settings.adUrl} onChange={(value) => updateField("adUrl", value)} />
        <Field label="AD domain (short)" id="adDomain" value={settings.adDomain} onChange={(value) => updateField("adDomain", value)} />
        <Field label="Base DN" id="adBaseDn" value={settings.adBaseDn} onChange={(value) => updateField("adBaseDn", value)} />
        <Field
          label="Username attribute"
          id="adUsernameAttribute"
          value={settings.adUsernameAttribute}
          onChange={(value) => updateField("adUsernameAttribute", value)}
        />
        <Field
          label="Group attribute"
          id="adGroupAttribute"
          value={settings.adGroupAttribute}
          onChange={(value) => updateField("adGroupAttribute", value)}
        />
      </div>

      <div className="rounded-md border border-[var(--border)] bg-slate-50 p-3">
        <p className="mb-3 text-sm font-medium">Test LDAP sign-in</p>
        <form action={testAction} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <AdSettingsFields settings={settings} />
          <div className="space-y-2">
            <Label htmlFor="testUsername">Test username</Label>
            <Input
              id="testUsername"
              name="testUsername"
              value={testUsername}
              onChange={(event) => setTestUsername(event.target.value)}
              placeholder="jsmith"
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="testPassword">Test password</Label>
            <Input
              id="testPassword"
              name="testPassword"
              type="password"
              value={testPassword}
              onChange={(event) => setTestPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button className="self-end" type="submit" disabled={testPending}>
            {testPending ? "Testing..." : "Test sign-in"}
          </Button>
        </form>
        {testState?.testResult ? (
          <div className="mt-3 text-sm text-green-800">
            <p>
              Authenticated as {testState.testResult.displayName} with {testState.testResult.groupCount} group
              {testState.testResult.groupCount === 1 ? "" : "s"}.
            </p>
            {testState.testResult.sampleGroups.length ? (
              <p className="mt-1 font-mono text-xs text-green-900">
                {testState.testResult.sampleGroups.join(" | ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <form action={saveAction} className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
        <AdSettingsFields settings={settings} />
        <label className="flex items-start gap-2 text-sm text-amber-950">
          <input
            name="confirmSave"
            type="checkbox"
            checked={confirmSave}
            onChange={(event) => setConfirmSave(event.target.checked)}
            className="mt-1"
          />
          Write these AD settings to the local <span className="font-mono">.env</span> file on this server.
        </label>
        <Button type="submit" disabled={savePending || !confirmSave}>
          {savePending ? "Saving..." : "Save AD settings to .env"}
        </Button>
      </form>

    </div>
  );
}

function AdSettingsFields({ settings }: { settings: AdSettings }) {
  return (
    <>
      <input type="hidden" name="adUrl" value={settings.adUrl} />
      <input type="hidden" name="adBaseDn" value={settings.adBaseDn} />
      <input type="hidden" name="adDomain" value={settings.adDomain} />
      <input type="hidden" name="adUsernameAttribute" value={settings.adUsernameAttribute} />
      <input type="hidden" name="adGroupAttribute" value={settings.adGroupAttribute} />
    </>
  );
}

function Field({
  label,
  id,
  value,
  onChange
}: {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
