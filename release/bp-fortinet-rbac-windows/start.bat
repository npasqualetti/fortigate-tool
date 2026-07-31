@echo off
setlocal

cd /d "%~dp0"

set NODE_ENV=production
set HOSTNAME=0.0.0.0
if "%PORT%"=="" set PORT=3000

echo Starting BP Fortinet RBAC on http://localhost:%PORT%
echo Press Ctrl+C to stop the server.

"%~dp0runtime\node.exe" "%~dp0server.js"

pause
