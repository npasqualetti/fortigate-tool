@echo off
setlocal
cd /d "%~dp0"

echo === BP Fortinet RBAC - first-run setup ===
echo Folder: %CD%
echo.

if not exist .env (
  if not exist .env.example (
    echo [FAIL] .env.example is missing from this folder.
    exit /b 1
  )
  copy /y .env.example .env >nul
  echo [OK] Created .env from .env.example
  echo      Edit AD_URL, AD_BASE_DN, AD_DOMAIN, and FortiManager settings before going live.
) else (
  echo [OK] .env already exists — not overwritten.
)

if not exist data mkdir data
echo [OK] data folder ready for SQLite

if not exist runtime\node.exe (
  echo [FAIL] runtime\node.exe missing — extract the full Windows zip package.
  exit /b 1
)

if not exist server.js (
  echo [FAIL] server.js missing — extract the full Windows zip package.
  exit /b 1
)

echo.
echo Next steps:
echo   1. Edit .env (AD + FortiManager at minimum for production testing)
echo   2. Run verify-deploy.bat
echo   3. Run start.bat
echo   4. Open http://localhost:3000/login
echo.
echo Local test logins (password ChangeMe123!): admin, helpdesk, telecom, fuel
pause
