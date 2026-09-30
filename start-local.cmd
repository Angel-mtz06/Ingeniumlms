@echo off
rem Arranca la demo LSM (doble clic). Usa el .venv de esta carpeta, sin Git Bash.
rem Ctrl+C o cerrar esta ventana detiene el servidor.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "LSM_ROOT=%CD%"
set "PYTHONIOENCODING=utf-8"
if not defined HOST set "HOST=127.0.0.1"
if not defined PORT set "PORT=8000"

if not exist ".venv\Scripts\python.exe" (
  echo No encuentro .venv. Crealo con:
  echo   py -3.12 -m venv .venv
  echo   .venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  echo   .venv\Scripts\python -m pip install -e ".[server]"
  pause
  exit /b 1
)

rem Compila la web si falta o si web\src cambio despues de la ultima compilacion (requiere npm install previo)
set "REBUILD="
if not exist "web\dist\index.html" set "REBUILD=1"
if not defined REBUILD for /f %%i in ('powershell -NoProfile -Command "$d=(Get-Item web\dist\index.html).LastWriteTime; if (Get-ChildItem web\src,web\index.html -Recurse -File | Where-Object { $_.LastWriteTime -gt $d } | Select-Object -First 1) { '1' }"') do set "REBUILD=%%i"
if defined REBUILD (
  if exist "web\node_modules" (
    echo == Compilando la web...
    pushd web
    call npm run build
    popd
  ) else (
    echo AVISO: no hay web\dist ni web\node_modules. Ejecuta: cd web ^&^& npm install ^&^& npm run build
  )
)

rem Abre el navegador cuando el servidor responda (hasta 90 s)
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://%HOST%:%PORT%/api/health | Out-Null; Start-Process http://%HOST%:%PORT%; break}catch{Start-Sleep 1}}"

echo == Servidor en http://%HOST%:%PORT% (Ctrl+C para detenerlo)
cd server
"..\.venv\Scripts\python.exe" -m lsm.app
if errorlevel 1 pause
