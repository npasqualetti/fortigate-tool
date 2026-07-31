# Fortinet RBAC Website

Internal Next.js application for role-based Fortinet access. Users authenticate with Active Directory, receive roles from admin-managed AD group mappings, and can only perform actions allowed by their team.

## Features

- Next.js App Router with shadcn/ui-style local components.
- LDAP/LDAPS Active Directory login with signed httpOnly sessions.
- SQLite persistence for group mappings, allowed OUIs, sites, firewalls, encrypted API token metadata, and audit logs.
- Network Admin console for AD groups, Telecom/Fuel OUI lists, sites, firewalls, CSV imports, and audit review.
- Telecom and Fuel POE reset workflow gated by MAC OUI allow lists.
- Help Desk read-only firewall overview.
- Offline production runtime: no CDN assets, external scripts, internet APIs, or external runtime dependencies beyond internal AD, SQLite, and Fortinet devices.

## Local Setup

Install dependencies from npm or an internal registry:

```bash
npm install
```

Create local environment settings:

```bash
cp .env.example .env
```

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set `APP_SECRET`, `APP_ENCRYPTION_KEY`, `AD_URL`, `AD_BASE_DN`, and `AD_DOMAIN` in `.env`.
The first database initialization creates a local `admin` bootstrap user using `BOOTSTRAP_ADMIN_PASSWORD`.
Change that temporary password in `.env` before first launch; the app forces the local admin to change it after the initial login.

Then run:

```bash
npm run dev
```

## CSV Import Format

Paste CSV exported from Excel with these headers:

```csv
siteNumber,name,address1,address2,city,state,postalCode,firewallName,ipAddress,model,serialNumber
101,Main Office,1 Main St,,Atlanta,GA,30301,FGT-101,10.0.0.1,FortiGate 100F,FGT123
```

The importer validates required fields, duplicate site numbers, duplicate firewall IPs inside the file, and IP address format before writing records.

## Windows Server Deployment

1. Install Node.js LTS 20.9.0 or newer on the Microsoft server.
2. Copy the project and install packages from your approved npm source or internal registry.
3. Create `.env` with production values. Keep `APP_SECRET` and `APP_ENCRYPTION_KEY` backed up securely because existing encrypted firewall tokens depend on them.
4. Build the app:

```powershell
npm run build
```

1. Start the standalone server:

```powershell
npm run start
```

The `start` script runs:

```powershell
node .next/standalone/server.js
```

1. Run the standalone Next.js server as a Windows service using your preferred service wrapper, such as NSSM or the built-in service tooling your team standardizes on.
2. Optionally place IIS in front of the Node service as a reverse proxy and restrict access to the internal network.
3. Ensure the service account can reach the domain controllers over LDAPS, can write to `SQLITE_PATH`, and can reach the Fortinet management IPs.

## FortiManager (recommended)

FortiGate **7.2.11** devices managed by FortiManager **7.2.11** use a single FortiManager REST API key. The app discovers all managed FortiGates and proxies FortiGate API calls through FortiManager — no per-firewall tokens.

1. On FortiManager, create an API admin user and generate a REST API key (`execute api-user generate-key` or System Settings → REST API Admin).
2. Set in `.env` or **Admin → FortiManager connection**:

```env
FORTIMANAGER_HOST=10.0.0.5
FORTIMANAGER_API_KEY=your-api-key-here
# FORTIMANAGER_ADOM=          # optional ADOM name; leave blank for global device list
# FORTIMANAGER_VERIFY_TLS=true
```

3. In **Admin → FortiManager connection**, click **Test connection**, then **Save settings**, then **Sync all FortiGate devices**.
4. New devices land in site **0000 (Unassigned FortiManager Devices)**. Assign each firewall to the correct site in **Admin → Fortinet devices**.

The API key can also be saved encrypted in the database from the admin UI (overrides `.env` when both are set).

**POE reset and other write actions** require more than read-only API access:

1. On FortiManager go to **System Settings → Administrators** and edit your REST API admin.
2. Set **JSON API Access** to **Read-Write** (not Read only). CLI equivalent: `set rpc-permit read-write`.
3. Assign an **Admin Profile** with read/write device access — **Standard_User** or **Super_User** (not **Restricted_User**, which is read-only on devices).
4. Ensure the admin is allowed for the ADOM where your FortiGate lives (usually **root**), or set `FORTIMANAGER_ADOM=root` in `.env`.
5. Regenerate the API key after changing permissions, update it in the app, and save settings.

Read-only access is enough for device sync, firewall overview, and device finder. POE reset sends a **POST** through FortiManager's `sys/proxy/json` and needs write permission.

## Legacy direct FortiGate API

If you are not using FortiManager, per-firewall REST API tokens still work:


- `FORTINET_API_AUTH=auto` (default): tries `?access_token=` then `Authorization: Bearer` (works on FortiOS 7.2.11 80F and 7.4+ lab units)
- `FORTINET_API_AUTH=query` or `bearer` to force one method only

FortiGate management HTTPS is often on a non-default port (for example **9443**). Set in `.env`:

```env
FORTINET_API_PORT=9443
```

Firewall inventory still stores the device IP only; the port applies to all API calls.

Fortinet monitor endpoints vary by FortiOS and FortiSwitch topology. The app uses these defaults:

- Status: `/api/v2/monitor/system/status`
- Interfaces: `/api/v2/monitor/system/interface/select`
- Learned MAC lookup: `FORTINET_INTERFACE_MAC_PATH` or `/api/v2/monitor/firewall/arp`
- POE reset (FortiSwitch): requires switch device ID and port (`S524DF4K15000024/port5`). Enable `FORTINET_ENABLE_SWITCH_CONTROLLER=true` so device finder lists switch ports, not only DHCP/ARP. Optional override: `FORTINET_POE_RESET_PATH`

If your FortiOS version uses different endpoints, set the environment variables or adjust `src/lib/fortinet/client.ts`.

## Verification

```bash
npm run lint
npm test
npm run build
```

Manual smoke tests:

- Login with an AD user mapped to Network Admin and confirm admin pages load.
- Login with an AD user outside all configured groups and confirm login is rejected.
- Add Telecom and Fuel OUI records, then test allowed and blocked POE reset attempts.
- Login as Help Desk and confirm firewall views are read-only and admin/POE actions are unavailable.

