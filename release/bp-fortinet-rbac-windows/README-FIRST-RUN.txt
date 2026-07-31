BP Fortinet RBAC - Windows First Run

1. Extract this folder to a permanent location, for example:
   C:\BP-Fortinet-RBAC

2. Open .env and update the Active Directory values for your domain:
   AD_URL
   AD_BASE_DN
   AD_DOMAIN

3. Double-click start.bat.

4. Open a browser and go to:
   http://localhost:3000/login

5. First login:
   Username: admin
   Password: ChangeMe123!

6. The app will force the admin password to be changed after first login.

Upgrading an existing install:
1. Stop the app (close start.bat window, or Task Manager: end node.exe for this app).
2. Extract the new zip over the same folder.
3. Keep your existing .env and data\ folder (do NOT replace .env with .env.example).
4. Run verify-deploy.bat — it should report [OK] for the new UI.
5. Run start.bat from the same folder.

Optional:
- To start the app after every reboot, right-click install-startup-task.bat and choose "Run as administrator".
- The SQLite database is created automatically in the data folder on first run.
- Do not delete .env after the first run. It contains the encryption key used for stored firewall API tokens.
- Copy .env.example to .env only on first install.
