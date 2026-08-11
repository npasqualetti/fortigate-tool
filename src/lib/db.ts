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

  const localUserColumns = database.prepare("PRAGMA table_info(local_users)").all() as Array<{ name: string }>;
  if (!localUserColumns.some((column) => column.name === "role")) {
    database.exec(`
      ALTER TABLE local_users
      ADD COLUMN role TEXT NOT NULL DEFAULT 'network_admin'
      CHECK (role IN ('network_admin', 'telecom', 'fuel', 'help_desk'));
    `);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS fortimanager_sync_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS asset_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firewall_id INTEGER NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
      mac_address TEXT NOT NULL,
      ip_address TEXT,
      interface_name TEXT,
      switch_id TEXT,
      switch_port TEXT,
      device_name TEXT,
      oui TEXT,
      sync_source TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE (firewall_id, mac_address)
    );

    CREATE TABLE IF NOT EXISTS asset_sync_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS asset_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_full_sync_at TEXT,
      last_full_sync_by TEXT,
      last_full_sync_devices INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_asset_identities_last_seen ON asset_identities(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_asset_identities_mac ON asset_identities(mac_address);
    CREATE INDEX IF NOT EXISTS idx_asset_identities_ip ON asset_identities(ip_address);
    CREATE INDEX IF NOT EXISTS idx_asset_identities_switch_port ON asset_identities(switch_port);
    CREATE INDEX IF NOT EXISTS idx_asset_identities_firewall_last_seen ON asset_identities(firewall_id, last_seen_at DESC);
  `);

  database.prepare("INSERT OR IGNORE INTO asset_sync_state (id) VALUES (1)").run();
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

  seedLocalUsers(database);
}

function seedLocalUsers(database: Database.Database) {
  const defaultPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "ChangeMe123!";
  const insert = database.prepare(
    `INSERT INTO local_users (username, display_name, password_hash, must_change_password, role)
     VALUES (@username, @displayName, @passwordHash, @mustChangePassword, @role)`
  );
  const exists = database.prepare("SELECT id FROM local_users WHERE lower(username) = lower(?)");

  const users: Array<{
    username: string;
    displayName: string;
    role: AppRole;
    mustChangePassword: number;
    password: string;
  }> = [
    {
      username: process.env.BOOTSTRAP_ADMIN_USERNAME || "admin",
      displayName: "Bootstrap Admin",
      role: "network_admin",
      mustChangePassword: 1,
      password: defaultPassword
    },
    {
      username: "helpdesk",
      displayName: "Help Desk Test User",
      role: "help_desk",
      mustChangePassword: 0,
      password: defaultPassword
    },
    {
      username: "telecom",
      displayName: "Telecom Test User",
      role: "telecom",
      mustChangePassword: 0,
      password: defaultPassword
    },
    {
      username: "fuel",
      displayName: "Fuel Test User",
      role: "fuel",
      mustChangePassword: 0,
      password: defaultPassword
    }
  ];

  for (const user of users) {
    if (exists.get(user.username)) {
      continue;
    }
    insert.run({
      username: user.username,
      displayName: user.displayName,
      passwordHash: hashPassword(user.password),
      mustChangePassword: user.mustChangePassword,
      role: user.role
    });
  }
}

export function getLocalUserByUsername(username: string): LocalUser | null {
  const row = connection()
    .prepare(
      `SELECT id, username, display_name as displayName, password_hash as passwordHash, role,
        must_change_password as mustChangePassword, disabled
       FROM local_users
       WHERE lower(username) = lower(?)`
    )
    .get(username) as
    | (Omit<LocalUser, "mustChangePassword" | "disabled"> & { mustChangePassword: number; disabled: number })
    | undefined;

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

export function listFirewalls(): Firewall[] {
  const rows = connection()
    .prepare(
      `SELECT f.id, f.site_id as siteId, f.name, f.ip_address as ipAddress, f.hostname, f.model, f.serial_number as serialNumber,
        f.fmg_device_name as fmgDeviceName, f.adom, f.vdom, f.api_token_encrypted as apiTokenEncrypted, f.verify_tls as verifyTls
       FROM firewalls f
       ORDER BY f.name`
    )
    .all() as DbFirewallRow[];

  return rows.map((row) => ({ ...row, verifyTls: Boolean(row.verifyTls) }));
}

export function getFirewall(id: number): Firewall | null {
  const row = connection()
    .prepare(
      `SELECT f.id, f.site_id as siteId, f.name, f.ip_address as ipAddress, f.hostname, f.model, f.serial_number as serialNumber,
        f.fmg_device_name as fmgDeviceName, f.adom, f.vdom, f.api_token_encrypted as apiTokenEncrypted, f.verify_tls as verifyTls
       FROM firewalls f
       WHERE f.id = ?`
    )
    .get(id) as DbFirewallRow | undefined;
  return row ? { ...row, verifyTls: Boolean(row.verifyTls) } : null;
}

export function getFirewallByFmgDeviceName(fmgDeviceName: string) {
  const row = connection()
    .prepare(
      `SELECT f.id, f.site_id as siteId, f.name, f.ip_address as ipAddress, f.hostname, f.model, f.serial_number as serialNumber,
        f.fmg_device_name as fmgDeviceName, f.adom, f.vdom, f.api_token_encrypted as apiTokenEncrypted, f.verify_tls as verifyTls
       FROM firewalls f
       WHERE f.fmg_device_name = ?`
    )
    .get(fmgDeviceName) as DbFirewallRow | undefined;
  return row ? { ...row, verifyTls: Boolean(row.verifyTls) } : null;
}

export function getFirewallBySerial(serialNumber: string) {
  const row = connection()
    .prepare(
      `SELECT f.id, f.site_id as siteId, f.name, f.ip_address as ipAddress, f.hostname, f.model, f.serial_number as serialNumber,
        f.fmg_device_name as fmgDeviceName, f.adom, f.vdom, f.api_token_encrypted as apiTokenEncrypted, f.verify_tls as verifyTls
       FROM firewalls f
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

/** Internal placeholder site required by the firewalls.site_id foreign key. Not shown in the UI. */
export function ensureDefaultFirewallSite() {
  const legacy = siteByNumber("0000");
  if (legacy) {
    return legacy;
  }

  const existing = siteByNumber("__managed__");
  if (existing) {
    return existing;
  }

  upsertSite({
    siteNumber: "__managed__",
    name: "Managed FortiGates",
    address1: "Internal",
    address2: null,
    city: "Internal",
    state: "NA",
    postalCode: "00000",
    notes: "Auto-created holder for FortiManager-synced firewalls."
  });
  return siteByNumber("__managed__")!;
}

/** @deprecated Use ensureDefaultFirewallSite */
export function ensureUnassignedSite() {
  return ensureDefaultFirewallSite();
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

type AssetIdentityUpsertInput = {
  macAddress: string;
  ipAddress: string | null;
  interfaceName: string | null;
  switchId: string | null;
  switchPort: string | null;
  deviceName: string | null;
  oui: string | null;
  syncSource: string;
};

export function upsertAssetIdentities(firewallId: number, rows: AssetIdentityUpsertInput[]) {
  if (rows.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();
  const statement = connection().prepare(
    `INSERT INTO asset_identities (
      firewall_id, mac_address, ip_address, interface_name, switch_id, switch_port,
      device_name, oui, sync_source, first_seen_at, last_seen_at
    ) VALUES (
      @firewallId, @macAddress, @ipAddress, @interfaceName, @switchId, @switchPort,
      @deviceName, @oui, @syncSource, @now, @now
    )
    ON CONFLICT(firewall_id, mac_address) DO UPDATE SET
      ip_address = CASE
        WHEN excluded.ip_address IS NOT NULL AND excluded.ip_address != '' THEN excluded.ip_address
        ELSE asset_identities.ip_address
      END,
      interface_name = excluded.interface_name,
      switch_id = COALESCE(excluded.switch_id, asset_identities.switch_id),
      switch_port = COALESCE(excluded.switch_port, asset_identities.switch_port),
      device_name = COALESCE(excluded.device_name, asset_identities.device_name),
      oui = COALESCE(excluded.oui, asset_identities.oui),
      sync_source = excluded.sync_source,
      last_seen_at = excluded.last_seen_at`
  );

  const runBatch = connection().transaction((batch: AssetIdentityUpsertInput[]) => {
    for (const row of batch) {
      statement.run({
        firewallId,
        macAddress: row.macAddress,
        ipAddress: row.ipAddress,
        interfaceName: row.interfaceName,
        switchId: row.switchId,
        switchPort: row.switchPort,
        deviceName: row.deviceName,
        oui: row.oui,
        syncSource: row.syncSource,
        now
      });
    }
  });

  for (let offset = 0; offset < rows.length; offset += 500) {
    runBatch(rows.slice(offset, offset + 500));
  }

  return rows.length;
}

export function pruneAssetIdentities(retentionDays: number) {
  return connection()
    .prepare("DELETE FROM asset_identities WHERE last_seen_at < datetime('now', ?)")
    .run(`-${retentionDays} days`);
}

export function searchAssetIdentities(input: {
  query?: string;
  firewallId?: number;
  siteId?: number;
  status?: "active" | "stale" | "all";
  retentionDays: number;
  staleDays: number;
  page: number;
  pageSize: number;
}) {
  const conditions = ["a.last_seen_at >= datetime('now', ?)"];
  const params: Array<string | number> = [`-${input.retentionDays} days`];

  if (input.firewallId) {
    conditions.push("a.firewall_id = ?");
    params.push(input.firewallId);
  }
  if (input.siteId) {
    conditions.push("f.site_id = ?");
    params.push(input.siteId);
  }
  if (input.status === "active") {
    conditions.push("a.last_seen_at >= datetime('now', ?)");
    params.push(`-${input.staleDays} days`);
  } else if (input.status === "stale") {
    conditions.push("a.last_seen_at < datetime('now', ?)");
    params.push(`-${input.staleDays} days`);
  }

  const query = input.query?.trim();
  if (query) {
    const sanitized = query.replace(/[%_]/g, "");
    const like = `%${sanitized}%`;
    conditions.push(
      `(a.mac_address LIKE ? COLLATE NOCASE OR IFNULL(a.ip_address, '') LIKE ? OR IFNULL(a.ip_address, '') = ? OR IFNULL(a.device_name, '') LIKE ? COLLATE NOCASE OR IFNULL(a.switch_port, '') LIKE ? COLLATE NOCASE OR IFNULL(a.interface_name, '') LIKE ? COLLATE NOCASE OR IFNULL(s.site_number, '') LIKE ? OR IFNULL(s.name, '') LIKE ? COLLATE NOCASE OR IFNULL(f.name, '') LIKE ? COLLATE NOCASE)`
    );
    params.push(like, like, sanitized, like, like, like, like, like, like);
  }

  const whereClause = conditions.join(" AND ");
  const countRow = connection()
    .prepare(
      `SELECT COUNT(*) as count
       FROM asset_identities a
       JOIN firewalls f ON f.id = a.firewall_id
       JOIN sites s ON s.id = f.site_id
       WHERE ${whereClause}`
    )
    .get(...params) as { count: number };

  const safePage = Math.max(1, input.page);
  const safePageSize = Math.min(Math.max(input.pageSize, 1), 100);
  const offset = (safePage - 1) * safePageSize;

  const rows = connection()
    .prepare(
      `SELECT
        a.id,
        a.firewall_id as firewallId,
        f.name as firewallName,
        f.ip_address as firewallIp,
        s.site_number as siteNumber,
        s.name as siteName,
        s.city as siteCity,
        s.state as siteState,
        a.mac_address as macAddress,
        a.ip_address as ipAddress,
        a.interface_name as interfaceName,
        a.switch_id as switchId,
        a.switch_port as switchPort,
        a.device_name as deviceName,
        a.oui,
        a.sync_source as syncSource,
        a.first_seen_at as firstSeenAt,
        a.last_seen_at as lastSeenAt,
        CASE WHEN a.last_seen_at >= datetime('now', ?) THEN 'active' ELSE 'stale' END as status
       FROM asset_identities a
       JOIN firewalls f ON f.id = a.firewall_id
       JOIN sites s ON s.id = f.site_id
       WHERE ${whereClause}
       ORDER BY a.last_seen_at DESC, a.mac_address ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, `-${input.staleDays} days`, safePageSize, offset) as import("@/lib/assets/types").AssetIdentityRecord[];

  return {
    items: rows,
    total: countRow.count,
    page: safePage,
    pageSize: safePageSize
  };
}

export function getAssetInventoryStats(retentionDays: number, staleDays: number) {
  pruneAssetIdentities(retentionDays);
  const counts = connection()
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN last_seen_at >= datetime('now', ?) THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN last_seen_at < datetime('now', ?) THEN 1 ELSE 0 END) as stale
       FROM asset_identities
       WHERE last_seen_at >= datetime('now', ?)`
    )
    .get(`-${staleDays} days`, `-${staleDays} days`, `-${retentionDays} days`) as {
    total: number;
    active: number | null;
    stale: number | null;
  };

  const syncState = connection()
    .prepare(
      `SELECT last_full_sync_at as lastFullSyncAt, last_full_sync_by as lastFullSyncBy, last_full_sync_devices as lastFullSyncDevices
       FROM asset_sync_state WHERE id = 1`
    )
    .get() as
    | {
        lastFullSyncAt: string | null;
        lastFullSyncBy: string | null;
        lastFullSyncDevices: number;
      }
    | undefined;

  return {
    total: counts.total || 0,
    active: counts.active || 0,
    stale: counts.stale || 0,
    lastFullSyncAt: syncState?.lastFullSyncAt || null,
    lastFullSyncBy: syncState?.lastFullSyncBy || null,
    lastFullSyncDevices: syncState?.lastFullSyncDevices || 0
  };
}

export function markAssetFullSyncComplete(username: string, ingested: number) {
  connection()
    .prepare(
      `UPDATE asset_sync_state
       SET last_full_sync_at = CURRENT_TIMESTAMP,
           last_full_sync_by = @username,
           last_full_sync_devices = @ingested,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`
    )
    .run({ username, ingested });
}

export function saveAssetSyncSession(input: { id: string; username: string; payloadJson: string }) {
  pruneAssetSyncSessions();
  connection()
    .prepare(
      `INSERT INTO asset_sync_sessions (id, username, payload_json)
       VALUES (@id, @username, @payloadJson)`
    )
    .run(input);
}

export function getAssetSyncSessionRow(id: string) {
  return connection()
    .prepare(
      `SELECT id, username, payload_json as payloadJson, created_at as createdAt
       FROM asset_sync_sessions WHERE id = ?`
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

export function updateAssetSyncSession(id: string, payloadJson: string) {
  connection()
    .prepare("UPDATE asset_sync_sessions SET payload_json = ? WHERE id = ?")
    .run(payloadJson, id);
}

export function deleteAssetSyncSession(id: string) {
  connection().prepare("DELETE FROM asset_sync_sessions WHERE id = ?").run(id);
}

export function pruneAssetSyncSessions(maxAgeHours = 6) {
  connection()
    .prepare("DELETE FROM asset_sync_sessions WHERE created_at < datetime('now', ?)")
    .run(`-${maxAgeHours} hours`);
}
