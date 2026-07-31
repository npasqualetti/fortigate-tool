import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OuiManager } from "@/components/admin/oui-manager";
import { AdSettingsTester } from "@/components/admin/ad-settings-tester";
import { RoleGroupManager } from "@/components/admin/role-group-manager";
import { FortiManagerSettingsPanel } from "@/components/admin/fortimanager-settings";
import { FortiManagerDeviceList } from "@/components/admin/fortimanager-device-list";
import { readAdSettingsFromEnvFile } from "@/lib/ad-settings.server";
import { getPublicFortiManagerSettings, readFortiManagerSettingsFromEnvFile } from "@/lib/fortimanager/settings";
import { AuditLogViewer } from "@/components/admin/audit-log-viewer";
import { requireRole } from "@/lib/auth/session";
import { listAllowedOuis, listAuditLogs, listFirewalls, listRoleGroups } from "@/lib/db";
export default async function AdminPage() {
  await requireRole(["network_admin"]);
  const [roleGroups, ouis, firewalls, auditLogs, allAuditLogs, adSettings, fmgEnvDefaults, fmgPublic] = [
    listRoleGroups(),
    listAllowedOuis(),
    listFirewalls(),
    listAuditLogs(7),
    listAuditLogs(1000),
    readAdSettingsFromEnvFile(),
    readFortiManagerSettingsFromEnvFile(),
    getPublicFortiManagerSettings()
  ];
  const syncedDevices = firewalls.filter((firewall) => Boolean(firewall.fmgDeviceName));

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Network Admin Console</h1>
          <p className="text-[var(--muted-foreground)]">
            Control AD group access, OUI rules, FortiManager connection, and audit review.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>FortiManager connection</CardTitle>
          <CardDescription>
            One API key and host for all managed FortiGates. Sync pulls device inventory automatically — no manual
            site or firewall setup required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FortiManagerSettingsPanel
            initialSettings={{
              host: fmgPublic.host || fmgEnvDefaults.host,
              apiKey: fmgPublic.apiKeyStored ? "__ENCRYPTED_FORTIMANAGER_API_KEY__" : fmgEnvDefaults.apiKey,
              verifyTls: fmgPublic.host ? fmgPublic.verifyTls : fmgEnvDefaults.verifyTls,
              adom: fmgPublic.adom || fmgEnvDefaults.adom,
              publicSettings: fmgPublic
            }}
          />
          <FortiManagerDeviceList
            devices={syncedDevices}
            configured={fmgPublic.configured}
            lastSyncedAt={fmgPublic.lastSyncedAt}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Directory connection</CardTitle>
          <CardDescription>
            Detect LDAP settings from this server, test sign-in, then write AD_URL, AD_BASE_DN, and AD_DOMAIN to .env.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdSettingsTester initialSettings={adSettings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Directory group mappings</CardTitle>
          <CardDescription>Only users in these groups can log in and receive platform roles.</CardDescription>
        </CardHeader>
        <CardContent>
          <RoleGroupManager roleGroups={roleGroups} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed MAC OUIs</CardTitle>
          <CardDescription>Telecom and Fuel POE reset actions are blocked unless the learned MAC OUI is listed here.</CardDescription>
        </CardHeader>
        <CardContent>
          <OuiManager ouis={ouis} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent audit events</CardTitle>
          <CardDescription>Login, admin, view, and Fortinet action outcomes.</CardDescription>
        </CardHeader>
        <CardContent>
          <AuditLogViewer previewLogs={auditLogs} allLogs={allAuditLogs} />
        </CardContent>
      </Card>
    </div>
  );
}
