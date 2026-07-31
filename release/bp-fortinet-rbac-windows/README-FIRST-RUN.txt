BP Fortinet RBAC - Windows test deployment
============================================

Requirements
------------
- Windows Server 2019+ or Windows 10/11 (x64)
- No separate Node.js install required (bundled runtime\node.exe)
- Outbound access to FortiManager / FortiGate management IPs on your LAN
- For AD login: domain-joined server recommended (Admin can auto-detect LDAP settings)

First install
-------------
1. Copy bp-fortinet-rbac-windows.zip to the Windows server and extract to a permanent
   folder, for example:
     C:\BP-Fortinet-RBAC

2. Double-click setup-first-run.bat
   - Creates .env from .env.example if .env does not exist
   - Creates the data\ folder for SQLite

3. Edit .env in Notepad:
   - APP_SECRET and APP_ENCRYPTION_KEY — use long random values (keep .env backed up)
   - AD_URL, AD_BASE_DN, AD_DOMAIN — your domain LDAP settings
   - AD_VERIFY_TLS=false — if LDAPS test fails with "unable to get issuer certificate"
   - FORTIMANAGER_HOST and FORTIMANAGER_API_KEY — your FortiManager connection

4. Run verify-deploy.bat — all checks should pass.

5. Double-click start.bat
   - Listens on http://0.0.0.0:3000 (all interfaces)
   - Local browser: http://localhost:3000/login

6. First login options:
   Local test accounts (password: ChangeMe123!):
     admin      — Network Admin (must change password on first login)
     helpdesk   — Help Desk (can pick Telecom or Fuel OUI policy on POE reset)
     telecom    — Telecom POE reset
     fuel       — Fuel POE reset

   Or sign in with Active Directory after AD settings are configured in Admin.

Admin checklist (after login as admin)
--------------------------------------
1. Admin → Active Directory connection
   - Detect from this server (if domain-joined)
   - Test sign-in with a domain user
   - Save AD settings to .env
   - Restart start.bat after saving AD settings

2. Admin → FortiManager connection
   - Test connection & save
   - Sync devices (batched import for large fleets)

3. Admin → AD group mappings — map AD groups to roles
4. Admin → Allowed MAC OUIs — Telecom and Fuel lists for POE reset

Upgrading an existing install
-----------------------------
1. Stop the app (close start.bat, or Task Manager: end node.exe for this folder)
2. Extract the new zip OVER the same folder
3. Keep your existing .env and data\ folder — do NOT replace .env
4. Run verify-deploy.bat
5. Run start.bat

Optional
--------
- install-startup-task.bat (Run as administrator) — start on Windows boot
- Change PORT before start.bat:  set PORT=8080 && start.bat
- Firewall rule: allow inbound TCP on PORT if users on other PCs need access

Troubleshooting
---------------
- Blank / unstyled page: run verify-deploy.bat; ensure .next\static exists; Ctrl+F5
- LDAP certificate errors: set AD_VERIFY_TLS=false in .env and restart
- FortiManager TLS errors: set FORTIMANAGER_VERIFY_TLS=false in .env or Admin UI
- Do not delete .env — it holds APP_ENCRYPTION_KEY for stored API keys
