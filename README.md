# Ingenium LSM

Aplicación que **evalúa y traduce Lengua de Señas Mexicana (LSM)** en tiempo real. Proyecto para INDIVISA INGENIUM 2026 (Universidad La Salle Oaxaca).

- **Práctica:** eliges una seña, la haces frente a la cámara y recibes un puntaje con consejos en español (configuración, ubicación, orientación, movimiento y contactos).
- **Traducción:** reconoce seña por seña y forma oraciones y párrafos en español con IA (OpenAI, con plantillas de respaldo sin internet).
- **Guantes:** dos guantes con ESP32, 6 IMU y sensores Hall cada uno, conectados por Web Serial, para una retroalimentación más fina de los dedos.

## Arquitectura

```
Navegador (React + MediaPipe en GPU)  ──WebSocket──►  Servidor FastAPI (Python)
  cámara → manos, pose y cara                          normalización → segmentación
  guantes por Web Serial                               clasificador (Transformer, PyTorch)
                                                       evaluador por parámetros + frases con IA
```

- `server/lsm/`: servidor, normalización, segmentador, evaluador y frases.
- `training/`: extracción de puntos, dataset, entrenamiento y referencias.
- `web/`: interfaz (Inicio, Calibración, Práctica, Traducción, Grabar y Diagnóstico).
- `docs/`: diseño, planes y documentos de la demo (`docs/demo/`).

## Qué no está en el repositorio

`datasets/`, `models/` y `.env` (claves) **no se suben**. Para correr la app se necesitan:

- `models/classifier_v1.pt` y `models/references.json` (pídelos al equipo o regenéralos con `training/`).
- Los modelos de MediaPipe: `python training/download_models.py`.
- Opcional: `.env` en la raíz con `OPENAI_API_KEY=...` para las frases con IA.

## Instalación (Windows con Git Bash)

```bash
python -m venv .venv && source .venv/Scripts/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e ".[server]"
python training/download_models.py
cd web && npm install && npm run build && cd ..
```

## Uso

- Doble clic en `start.cmd` (compila la web si hace falta, arranca el servidor y abre `http://127.0.0.1:8000`).
- `bash tools/check.sh`: chequeo previo a la demo.
- `bash tools/retrain.sh --dry-run | --activate | --rollback`: reentrenar con las grabaciones del equipo (pantalla Grabar).

Pruebas: `python -m pytest -q` y `cd web && npx vitest run`.
