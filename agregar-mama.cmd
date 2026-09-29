@echo off
rem Agrega la seña MAMÁ a Práctica (doble clic). Solo hace falta una vez por computadora.
rem Usa el .venv de esta carpeta, igual que start-local.cmd. Ver README, sección "Agregar MAMÁ".
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "LSM_ROOT=%CD%"
set "PYTHONIOENCODING=utf-8"
set "PY=%CD%\.venv\Scripts\python.exe"
set "ZIP=%CD%\datasets\mendeley\6rj76z6y3n-1.zip"

if not exist "%PY%" (
  echo No encuentro .venv. Crealo primero ^(ver README, "Instalacion"^).
  pause & exit /b 1
)
if not exist "%ZIP%" (
  echo Falta el dataset de Mendeley ^(MSLwords1^):
  echo   1. Descargalo de https://data.mendeley.com/datasets/6rj76z6y3n/1  ^("Download All"^)
  echo   2. Guardalo como  %ZIP%
  echo   3. Vuelve a abrir este archivo.
  pause & exit /b 1
)
if not exist "models\mediapipe\hand_landmarker.task" (
  echo == Descargando los modelos de MediaPipe...
  "%PY%" training\download_models.py || (pause & exit /b 1)
)

echo == 1/2 Extrayendo MAMA ^(palabra 58^) del dataset de Mendeley...
"%PY%" training\extract_mendeley.py --words 58 || (pause & exit /b 1)
echo == 2/2 Agregando la referencia de MAMA a las referencias del modelo activo...
"%PY%" training\add_mendeley_reference.py --gloss MAMA || (pause & exit /b 1)

echo.
echo Listo. Reinicia el servidor ^(cierra su ventana y abre start-local.cmd^): MAMA aparece en Practica ^> Personas.
pause
