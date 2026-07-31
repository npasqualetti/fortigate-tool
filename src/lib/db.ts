import "server-only";

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/auth/password";
import { normalizeOui } from "@/lib/mac";
import { APP_ROLES, type AllowedOui, type AppRole, type AuditEvent, type Firewall, type LocalUser, type RoleGroup, type Site } from "@/lib/types";

const dbPath = process.env.SQLITE_PATH || "./data/app.db";
let db: Database.Database | null = null;

type DbFirewallRow = Omit<Firewall, "verifyTls"> & {
  verifyTls: number;
  siteNumber: string;
  siteName: string;
};

function connection() {
  if (db) {
    return db;
  }

  const resolvedPath = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedDefaults(db);
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS role_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK (role IN ('network_admin', 'telecom', 'fuel', 'help_desk')),
      group_dn TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS allowed_ouis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_role TEXT NOT NULL CHECK (team_role IN ('telecom', 'fuel')),
      oui TEXT NOT NULL,
      vendor TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (team_role, oui)
    );

    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address1 TEXT NOT NULL,
      address2 TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS firewalls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL UNIQUE,
      model TEXT,
      serial_number TEXT,
      hostname TEXT,
      api_token_encrypted TEXT,
      verify_tls INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('success', 'denied', 'error')),
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS local_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fortimanager_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      verify_tls INTEGER NOT NULL DEFAULT 1,
      adom TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const firewallColumns = database.prepare("PRAGMA table_info(firewalls)").all() as Array<{ name: string }>;
  if (!firewallColumns.some((column) => column.name === "hostname")) {
    database.exec("ALTER TABLE firewalls ADD COLUMN hostname TEXT");
  }
  if (!firewallColumns.some((column) => column.name === "fmg_device_name")) {
    database.exec("ALTER TABLE firewalls ADD COLUMN fmg_device_name TEXT");
  }
  if (!firewallColumns.some((column) => column.name === "adom")) {
    database.exec("ALTER TABLE firewalls ADD COLUMN adom TEXT");
  }
  if (!firewallColumns.some((column) => column.name === "vdom")) {
    database.exec("ALTER TABLE firewalls ADD COLUMN vdom TEXT NOT NULL DEFAULT 'root'");
  }
  database.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS firewalls_fmg_device_name_unique ON firewalls(fmg_device_name) WHERE fmg_device_name IS NOT NULL"
  );

  database.exec(`
    CREATE TABLE IF NOT EXISTS fortimanager_sync_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedDefaults(database: Database.Database) {
  const count = database.prepare("SELECT COUNT(*) as count FROM role_groups").get() as { count: number };
  if (count.count === 0) {
    const insert = database.prepare(
      "INSERT INTO role_groups (role, group_dn, description) VALUES (@role, @groupDn, @description)"
    );
    for (const role of APP_ROLES) {
      insert.run({
        role,
        groupDn: `CN=Fortinet-${role.replace("_", "-")},OU=Groups,DC=example,DC=local`,
        description: "Replace this placeholder with the approved Active Directory group DN."
      });
    }
  }

  const localUserCount = database.prepare("SELECT COUNT(*) as count FROM local_users").get() as { count: number };
  if (localUserCount.count === 0) {
    database
      .prepare(
        `INSERT INTO local_users (username, display_name, password_hash, must_change_password)
         VALUES (@username, @displayName, @passwordHash, 1)`
      )
      .run({
        username: process.env.BOOTSTRAP_ADMIN_USERNAME || "admin",
        displayName: "Bootstrap Admin",
        passwordHash: hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD || "ChangeMe123!")
      });
  }
}

export function getLocalUserByUsername(username: string): LocalUser | null {
  const row = connection()
    .prepare(
      `SELECT id, username, display_name as displayName, password_hash as passwordHash,
        must_change_password as mustChangePassword, disabled
       FROM local_users
       WHERE lower(username) = lower(?)`
    )
    .get(username) as (Omit<LocalUser, "mustChangePassword" | "disabled"> & { mustChangePassword: number; disabled: number }) | undefined;

  return row
    ? {
        ...row,
        mustChangePassword: Boolean(row.mustChangePassword),
        disabled: Boolean(row.disabled)
      }
    : null;
}

export function updateLocalUserPassword(username: string, password: string) {
  return connection()
    .prepare(
      `UPDATE local_users
       SET password_hash = @passwordHash, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
       WHERE lower(username) = lower(@username)`
    )
    .run({ username, passwordHash: hashPassword(password) });
}

export function listRoleGroups(): RoleGroup[] {
  return connection()
    .prepare("SELECT id, role, group_dn as groupDn, description FROM role_groups ORDER BY role, group_dn")
    .all() as RoleGroup[];
}

export function upsertRoleGroup(input: { role: AppRole; groupDn: string; description?: string }) {
  return connection()
    .prepare(
      `INSERT INTO role_groups (role, group_dn, description)
       VALUES (@role, @groupDn, @description)
       ON CONFLICT(group_dn) DO UPDATE SET role = excluded.role, description = excluded.description`
    )
    .run({ role: input.role, groupDn: input.groupDn.trim(), description: input.description || null });
}

export function updateRoleGroup(input: { id: number; role: AppRole; groupDn: string; description?: string }) {
  return connection()
    .prepare(
      `UPDATE role_groups
       SET role = @role, group_dn = @groupDn, description = @description
       WHERE id = @id`
    )
    .run({
      id: input.id,
      role: input.role,
      groupDn: input.groupDn.trim(),
      description: input.description || null
    });
}

export function deleteRoleGroup(id: number) {
  return connection().prepare(`DELETE FROM role_groups WHERE id = ?`).run(id);
}

export function rolesForGroups(groupDns: string[]): AppRole[] {
  if (groupDns.length === 0) {
    return [];
  }
  const normalized = new Set(groupDns.map((group) => group.toLowerCase()));
  return listRoleGroups()
    .filter((mapping) => normalized.has(mapping.groupDn.toLowerCase()))
    .map((mapping) => mapping.role)
    .filter((role, index, roles) => roles.indexOf(role) === index);
}

export function listAllowedOuis(teamRole?: "telecom" | "fuel"): AllowedOui[] {
  const sql = teamRole
    ? "SELECT id, team_role as teamRole, oui, vendor FROM allowed_ouis WHERE team_role = ? ORDER BY team_role, oui"
    : "SELECT id, team_role as teamRole, oui, vendor FROM allowed_ouis ORDER BY team_role, oui";
  return (teamRole ? connection().prepare(sql).all(teamRole) : connection().prepare(sql).all()) as AllowedOui[];
}

export function addAllowedOui(input: { teamRole: "telecom" | "fuel"; oui: string; vendor?: string }) {
  return connection()
    .prepare(
      `INSERT INTO allowed_ouis (team_role, oui, vendor)
       VALUES (@teamRole, @oui, @vendor)
       ON CONFLICT(team_role, oui) DO UPDATE SET vendor = excluded.vendor`
    )
    .run({ teamRole: input.teamRole, oui: normalizeOui(input.oui), vendor: input.vendor || null });
}

export function updateAllowedOui(input: { id: number; teamRole: "telecom" | "fuel"; oui: string; vendor?: string }) {
  return connection()
    .prepare(
      `UPDATE allowed_ouis
       SET team_role = @teamRole, oui = @oui, vendor = @vendor
       WHERE id = @id`
    )
    .run({
      id: input.id,
      teamRole: input.teamRole,
      oui: normalizeOui(input.oui),
      vendor: input.vendor || null
    });
}

export function deleteAllowedOui(id: number) {
  return connection().prepare(`DELETE FROM allowed_ouis WHERE id = ?`).run(id);
}

export function listSites(): Array<Site & { firewallCount: number }> {
  return connection()
    .prepare(
      `SELECT s.id, s.site_number as siteNumber, s.name, s.address1, s.address2, s.city, s.state,
        s.postal_code as postalCode, s.notes, COUNT(f.id) as firewallCount
       FROM sites s
       LEFT JOIN firewalls f ON f.site_id = s.id
       GROUP BY s.id
       ORDER BY s.site_number`
    )
    .all() as Array<Site & { firewallCount: number }>;
}

export function upsertSite(input: Omit<Site, "id">) {
  return connection()
    .prepare(
      `INSERT INTO sites (site_number, name, address1, address2, city, state, postal_code, notes)
       VALUES (@siteNumber, @name, @address1, @address2, @city, @state, @postalCode, @notes)
       ON CONFLICT(site_number) DO UPDATE SET
        name = excluded.name,
        address1 = excluded.address1,
        address2 = excluded.address2,
        city = excluded.city,
        state = excluded.state,
        postal_code = excluded.postal_code,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP`
    )
    .run(input);
}

export function updateSite(input: Site) {
  return connection()
    .prepare(
      `UPDATE sites SET
        site_number = @siteNumber,
        name = @name,
        address1 = @address1,
        address2 = @address2,
        city = @city,
        state = @state,
        postal_code = @postalCode,
        notes = @notes,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = @id`
    )
    .run(input);
}

export function deleteSite(id: number) {
  return connection().prepare("DELETE FROM sites WHERE id = ?").run(id);
}

export function updateSiteTextField(
  id: number,
  field: "siteNumber" | "name" | "address1" | "address2" | "city" | "state" | "postalCode" | "notes",
  value: string | null
) {
  const columnByField: Record<typeof field, string> = {
    siteNumber: "site_number",
    name: "name",
    address1: "address1",
    address2: "address2",
    city: "city",
    state: "state",
    postalCode: "postal_code",
    notes: "notes"
  };

  return connection()
    .prepare(`UPDATE sites SET ${columnByField[field]} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(value, id);
}

export function listFirewalls(): Array<Firewall & { siteNumber: string; siteName: string }> {
  const rows = connection()
    .prepare(
      `SELECT f.id, f.site_id as siteId, f.name, f.ip_address as ipAddress, f.hostname, f.model, f.serial_number as serialNumber,
        f.fmg_device_name as fmgDeviceName, f.adom, f.vdom, f.api_token_encrypted as apiTokenEncrypted, f.verify_tls as verifyTls,
        s.site_number as siteNumber, s.name as siteName
       FROM firewalls f
       INNER JOIN sites s ON s.id = f.site_id
       ORDER BY s.site_number, f.name`
    )
    .all() as DbFirewallRow[];

  return rows.map((row) => ({ ...row, verifyTls: Boolean(row.verifyTls) }));
}

export function getFirewall(id: number): (Firewall & { siteNumber: string; siteName: string }) | null {
  const row = connection()
    .prepare(
      `SELECT f.id, f.site_id as siteId, f.name, f.ip_address as ipAddress, f.hostname, f.model, f.serial_number as serialNumber,
        f.fmg_device_name as fmgDeviceName, f.adom, f.vdom, f.api_token_encrypted as apiTokenEncrypted, f.verify_tls as verifyTls,
        s.site_number as siteNumber, s.name as siteName
       FROM firewalls f
       INNER JOIN sites s ON s.id = f.site_id
       WHERE f.id = ?`
    )
    .get(id) as DbFirewallRow | undefined;
  return row ? { ...row, verifyTls: Boolean(row.verifyTls) } : null;
}

export function getFirewallByFmgDeviceName(fmgDeviceName: string) {
  const row = connection()
    .prepare(
      `SELECT f.id, f.site_id as siteId, f.name, f.ip_address as ipAddress, f.hostname, f.model, f.serial_number as serialNumber,
        f.fmg_device_name as fmgDeviceName, f.adom, f.vdom, f.api_token_encrypted as apiTokenEncrypted, f.verify_tls as verifyTls,
        s.site_number as siteNumber, s.name as siteName
       FROM firewalls f
       INNER JOIN sites s ON s.id = f.site_id
       WHERE f.fmg_device_name = ?`
    )
    .get(fmgDeviceName) as DbFirewallRow | undefined;
  return row ? { ...row, verifyTls: Boolean(row.verifyTls) } : null;
}

export function getFirewallBySerial(serialNumber: string) {
  const row = connection()
    .prepare(
      `SELECT f.id, f.site_id as siteId, f.name, f.ip_address as ipAddress, f.hostname, f.model, f.serial_number as serialNumber,
        f.fmg_device_name as fmgDeviceName, f.adom, f.vdom, f.api_token_encrypted as apiTokenEncrypted, f.verify_tls as verifyTls,
        s.site_number as siteNumber, s.name as siteName
       FROM firewalls f
       INNER JOIN sites s ON s.id = f.site_id
       WHERE f.serial_number = ?`
    )
    .get(serialNumber) as DbFirewallRow | undefined;
  return row ? { ...row, verifyTls: Boolean(row.verifyTls) } : null;
}

export function upsertFirewall(input: Omit<Firewall, "id"> & { id?: number }) {
  if (input.id) {
    return connection()
      .prepare(
        `UPDATE firewalls SET
          site_id = @siteId,
          name = @name,
          ip_address = @ipAddress,
          model = @model,
          serial_number = @serialNumber,
          hostname = @hostname,
          fmg_device_name = @fmgDeviceName,
          adom = @adom,
          vdom = @vdom,
          api_token_encrypted = COALESCE(@apiTokenEncrypted, api_token_encrypted),
          verify_tls = @verifyTls,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`
      )
      .run({ ...input, verifyTls: input.verifyTls ? 1 : 0 });
  }

  return connection()
    .prepare(
      `INSERT INTO firewalls (site_id, name, ip_address, model, serial_number, hostname, fmg_device_name, adom, vdom, api_token_encrypted, verify_tls)
       VALUES (@siteId, @name, @ipAddress, @model, @serialNumber, @hostname, @fmgDeviceName, @adom, @vdom, @apiTokenEncrypted, @verifyTls)
       ON CONFLICT(ip_address) DO UPDATE SET
        site_id = excluded.site_id,
        name = excluded.name,
        model = excluded.model,
        serial_number = excluded.serial_number,
        hostname = excluded.hostname,
        fmg_device_name = COALESCE(excluded.fmg_device_name, firewalls.fmg_device_name),
        adom = COALESCE(excluded.adom, firewalls.adom),
        vdom = COALESCE(excluded.vdom, firewalls.vdom),
        api_token_encrypted = COALESCE(excluded.api_token_encrypted, firewalls.api_token_encrypted),
        verify_tls = excluded.verify_tls,
        updated_at = CURRENT_TIMESTAMP`
    )
    .run({ ...input, verifyTls: input.verifyTls ? 1 : 0 });
}

export function ensureUnassignedSite() {
  const existing = siteByNumber("0000");
  if (existing) {
    return existing;
  }
  upsertSite({
    siteNumber: "0000",
    name: "Unassigned FortiManager Devices",
    address1: "Not assigned",
    address2: null,
    city: "Not assigned",
    state: "NA",
    postalCode: "00000",
    notes: "Auto-created for FortiManager discovered devices until mapped to a real site."
  });
  return siteByNumber("0000")!;
}

export function upsertFirewallFromDiscovery(input: {
  siteId: number;
  name: string;
  ipAddress: string;
  hostname: string | null;
  model: string | null;
  serialNumber: string | null;
  fmgDeviceName: string;
  adom: string | null;
  verifyTls: boolean;
}) {
  const existing =
    getFirewallByFmgDeviceName(input.fmgDeviceName) ||
    (input.serialNumber ? getFirewallBySerial(input.serialNumber) : null);

  upsertFirewall({
    id: existing?.id,
    siteId: existing?.siteId ?? input.siteId,
    name: input.name,
    ipAddress: input.ipAddress,
    hostname: input.hostname,
    model: input.model,
    serialNumber: input.serialNumber,
    fmgDeviceName: input.fmgDeviceName,
    adom: input.adom,
    vdom: existing?.vdom ?? "root",
    apiTokenEncrypted: existing?.apiTokenEncrypted ?? null,
    verifyTls: input.verifyTls
  });
}

export function readFortiManagerSettingsRow() {
  const row = connection()
    .prepare(
      `SELECT host, api_key_encrypted as apiKeyEncrypted, verify_tls as verifyTls, adom, last_synced_at as lastSyncedAt
       FROM fortimanager_settings
       WHERE id = 1`
    )
    .get() as
    | {
        host: string;
        apiKeyEncrypted: string;
        verifyTls: number;
        adom: string;
        lastSyncedAt: string | null;
      }
    | undefined;
  return row
    ? {
        ...row,
        verifyTls: Boolean(row.verifyTls)
      }
    : null;
}

export function saveFortiManagerSettingsRow(input: {
  host: string;
  apiKeyEncrypted: string;
  verifyTls: boolean;
  adom: string;
}) {
  connection()
    .prepare(
      `INSERT INTO fortimanager_settings (id, host, api_key_encrypted, verify_tls, adom, updated_at)
       VALUES (1, @host, @apiKeyEncrypted, @verifyTls, @adom, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         host = excluded.host,
         api_key_encrypted = excluded.api_key_encrypted,
         verify_tls = excluded.verify_tls,
         adom = excluded.adom,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run({
      host: input.host,
      apiKeyEncrypted: input.apiKeyEncrypted,
      verifyTls: input.verifyTls ? 1 : 0,
      adom: input.adom
    });
}

export function markFortiManagerSyncedAt() {
  connection()
    .prepare("UPDATE fortimanager_settings SET last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
    .run();
}

export function deleteFirewall(id: number) {
  return connection().prepare("DELETE FROM firewalls WHERE id = ?").run(id);
}

export function updateFirewallTextField(
  id: number,
  field: "name" | "model" | "serialNumber" | "hostname",
  value: string | null
) {
  const columnByField: Record<"name" | "model" | "serialNumber" | "hostname", string> = {
    name: "name",
    model: "model",
    serialNumber: "serial_number",
    hostname: "hostname"
  };

  return connection()
    .prepare(`UPDATE firewalls SET ${columnByField[field]} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(value, id);
}

export function updateFirewallApiToken(id: number, apiTokenEncrypted: string | null) {
  return connection()
    .prepare("UPDATE firewalls SET api_token_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(apiTokenEncrypted, id);
}

export function updateFirewallTls(id: number, verifyTls: boolean) {
  return connection()
    .prepare("UPDATE firewalls SET verify_tls = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(verifyTls ? 1 : 0, id);
}

export function writeAudit(event: Omit<AuditEvent, "id" | "createdAt">) {
  pruneAuditLogs();
  return connection()
    .prepare(
      `INSERT INTO audit_logs (username, action, target_type, target_id, status, details)
       VALUES (@username, @action, @targetType, @targetId, @status, @details)`
    )
    .run(event);
}

export function pruneAuditLogs(retentionDays = 30) {
  return connection()
    .prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', ?)")
    .run(`-${retentionDays} days`);
}

export function listAuditLogs(limit = 100, retentionDays = 30): AuditEvent[] {
  pruneAuditLogs(retentionDays);
  return connection()
    .prepare(
      `SELECT id, username, action, target_type as targetType, target_id as targetId, status, details, created_at as createdAt
       FROM audit_logs
       WHERE created_at >= datetime('now', ?)
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(`-${retentionDays} days`, limit) as AuditEvent[];
}

export function saveFortiManagerSyncSession(input: {
  id: string;
  username: string;
  payloadJson: string;
}) {
  pruneFortiManagerSyncSessions();
  connection()
    .prepare(
      `INSERT INTO fortimanager_sync_sessions (id, username, payload_json)
       VALUES (@id, @username, @payloadJson)`
    )
    .run(input);
}

export function getFortiManagerSyncSessionRow(id: string) {
  return connection()
    .prepare(
      `SELECT id, username, payload_json as payloadJson, created_at as createdAt
       FROM fortimanager_sync_sessions
       WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        username: string;
        payloadJson: string;
        createdAt: string;
      }
    | undefined;
}

export function deleteFortiManagerSyncSession(id: string) {
  connection().prepare("DELETE FROM fortimanager_sync_sessions WHERE id = ?").run(id);
}

export function pruneFortiManagerSyncSessions(maxAgeHours = 2) {
  connection()
    .prepare("DELETE FROM fortimanager_sync_sessions WHERE created_at < datetime('now', ?)")
    .run(`-${maxAgeHours} hours`);
}

export function siteByNumber(siteNumber: string): Site | null {
  const row = connection()
    .prepare(
      `SELECT id, site_number as siteNumber, name, address1, address2, city, state, postal_code as postalCode, notes
       FROM sites WHERE site_number = ?`
    )
    .get(siteNumber) as Site | undefined;
  return row || null;
}
