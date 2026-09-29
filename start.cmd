@echo off
rem Arranca la demo LSM (doble clic). Llama a tools/start.sh con Git Bash.
rem Ctrl+C o cerrar esta ventana detiene el servidor.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo No encuentro Git Bash. Instala Git para Windows o ejecuta tools/start.sh desde Git Bash.
  pause
  exit /b 1
)
"%GITBASH%" tools/start.sh %*
if errorlevel 1 pause
