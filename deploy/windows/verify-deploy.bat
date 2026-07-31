@echo off
setlocal
cd /d "%~dp0"

echo === BP Fortinet RBAC deploy check ===
echo Folder: %CD%
echo.

if exist BUILD_INFO.txt (
  echo BUILD_INFO.txt:
  type BUILD_INFO.txt
  echo.
) else (
  echo [WARN] BUILD_INFO.txt missing — this may be an old package.
  echo.
)

if not exist server.js (
  echo [FAIL] server.js not found in this folder.
  exit /b 1
)

if not exist .next\static\chunks (
  echo [FAIL] .next\static\chunks missing — static assets were not deployed.
  exit /b 1
)

findstr /m /c:"Find hosts" .next\static\chunks\*.js >nul 2>&1
if errorlevel 1 (
  echo [FAIL] New firewall workspace UI not found in static bundles.
  echo        You likely have an old build or an incomplete copy of .next\static
  exit /b 1
) else (
  echo [OK] Firewall workspace UI present in static bundles.
)

findstr /m /c:"refreshFirewallWorkspaceAction" .next\server\chunks\ssr\*.js >nul 2>&1
if errorlevel 1 (
  echo [WARN] Server bundle marker not found; server files may be stale.
) else (
  echo [OK] Firewall workspace server actions present.
)

echo.
echo If the browser still shows the old UI:
echo   1. Stop every running copy (Task Manager: node.exe, or end scheduled task).
echo   2. Start from THIS folder using start.bat.
echo   3. Hard refresh the browser (Ctrl+F5).
exit /b 0
