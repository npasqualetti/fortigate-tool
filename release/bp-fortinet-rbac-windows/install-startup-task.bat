@echo off
setlocal

cd /d "%~dp0"

schtasks /Create /TN "BP Fortinet RBAC" /SC ONSTART /RL HIGHEST /TR "\"%~dp0start.bat\"" /F

echo.
echo Installed startup task: BP Fortinet RBAC
echo The app will start automatically after Windows starts.
echo You can also run start.bat manually.
pause
