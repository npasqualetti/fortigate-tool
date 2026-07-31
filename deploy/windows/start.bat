@echo off
setlocal

cd /d "%~dp0"

if not exist runtime\node.exe (
  echo Missing runtime\node.exe. Re-extract the full Windows package.
  pause
  exit /b 1
)

if not exist .env (
  echo .env not found. Run setup-first-run.bat first.
  pause
  exit /b 1
)

set NODE_ENV=production
set HOSTNAME=0.0.0.0
if "%PORT%"=="" set PORT=3000

echo Starting BP Fortinet RBAC on http://localhost:%PORT%
echo LAN access: http://%COMPUTERNAME%:%PORT%  (if firewall allows)
echo Press Ctrl+C to stop the server.

"%~dp0runtime\node.exe" "%~dp0server.js"

pause
