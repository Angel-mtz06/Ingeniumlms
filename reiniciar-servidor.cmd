@echo off
rem Reinicia el servidor de la demo: cierra el que esta corriendo y abre start-local.cmd
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'lsm.app' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 2 /nobreak >nul
call "%~dp0start-local.cmd"
