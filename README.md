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

## Agregar MAMÁ a Práctica (una vez por computadora)

MAMÁ no viene en LSM Glosses: su referencia se arma con el dataset de Mendeley (MSLwords1) y se agrega a las
referencias del modelo activo, sin reentrenar. Como `models/` no está en git, **cada quien lo ejecuta una vez**:

1. Descarga el dataset de https://data.mendeley.com/datasets/6rj76z6y3n/1 ("Download All") y guárdalo como
   `datasets/mendeley/6rj76z6y3n-1.zip`.
2. Doble clic en `agregar-mama.cmd` (usa el `.venv` del repo, como `start-local.cmd`). Extrae solo la palabra 58
   (MAMÁ), arma la referencia y guarda un respaldo `.bak` del archivo de referencias.
3. Reinicia el servidor: MAMÁ aparece en Práctica → Personas.

Detalles: `training/add_mendeley_reference.py --gloss MAMA` (por defecto escribe en las referencias del modelo
activo; si no hay videos de Glosses extraídos usa la proporción mano/cabeza medida, 0.6875).
