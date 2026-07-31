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

set FAIL=0

if not exist runtime\node.exe (
  echo [FAIL] runtime\node.exe missing
  set FAIL=1
) else (
  echo [OK] Bundled Node runtime present
)

if not exist server.js (
  echo [FAIL] server.js not found
  set FAIL=1
) else (
  echo [OK] Standalone server present
)

if not exist .next\static\chunks (
  echo [FAIL] .next\static\chunks missing
  set FAIL=1
) else (
  echo [OK] Static assets present
)

if not exist node_modules\better-sqlite3\build\Release\better_sqlite3.node (
  echo [FAIL] Windows better-sqlite3 native module missing
  set FAIL=1
) else (
  echo [OK] better-sqlite3 Windows binary present
)

findstr /m /c:"FortiManager connection" .next\static\chunks\*.js >nul 2>&1
if errorlevel 1 (
  echo [WARN] FortiManager admin UI marker not found in client bundles
) else (
  echo [OK] FortiManager admin UI present
)

findstr /m /c:"DHCP / ARP devices" .next\static\chunks\*.js >nul 2>&1
if errorlevel 1 (
  echo [WARN] POE reset workspace marker not found in client bundles
) else (
  echo [OK] POE reset workspace UI present
)

findstr /m /c:"Verify TLS certificate for LDAPS" .next\static\chunks\*.js >nul 2>&1
if errorlevel 1 (
  echo [WARN] AD TLS settings UI marker not found
) else (
  echo [OK] AD LDAPS TLS option present
)

if not exist .env (
  echo [WARN] .env missing — run setup-first-run.bat before start.bat
) else (
  echo [OK] .env present
)

echo.
if %FAIL%==1 (
  echo Deploy check FAILED. Re-extract the full zip package.
  exit /b 1
)

echo Deploy check passed. Run start.bat, then open http://localhost:3000/login
exit /b 0
