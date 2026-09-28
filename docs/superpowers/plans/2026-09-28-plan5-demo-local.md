# Plan 5 (parte local): arranque, reentrenamiento con grabaciones propias y demo

> Para agentes: ejecutar tarea por tarea con TDD donde haya lógica. Commits con pathspec explícito. Todo en D:. Entorno: `source D:/Ingenium/tools/env.sh`. No leer `D:/Ingenium/.env`. Para pruebas del servidor exportar `SENTENCES_PROVIDER=none`.

**Objetivo:** que el equipo arranque todo con un comando, que las grabaciones propias (pantalla Grabar → `datasets/own`) se conviertan en un modelo nuevo con un solo script (incluida la clase NINGUNA para rechazar movimientos que no son seña), y que exista un guion y una lista de verificación de la demo.

**Contexto:** `POST /api/recordings` guarda `datasets/own/<persona>_<GLOSA>_<toma>.npz` + fila en `datasets/own/index_own.csv` (dataset=own). Las tomas de seña duran ~3 s (≤90 cuadros); las de NINGUNA 10 s (≤300 cuadros). `training/build_dataset.py` ya lee `own`; `training/train.py --out <nombre>` entrena (~30 min CPU con 150 épocas); `training/build_references.py` regenera `models/references.json`. El servidor (`server/lsm/app.py:153`) y `training/replay.py:29` tienen `classifier_v1.pt` fijo. `splits.split_of` manda a train a toda persona que no sea m02/g02/m03/g03.

---

### Task 1: Modelo activo configurable

- `server/lsm/paths.py`: función `active_model_path()` → lee `models/ACTIVE_MODEL` (una línea con el nombre, p. ej. `classifier_v2`); si no existe, `classifier_v1`. Variable de entorno `LSM_MODEL` tiene prioridad. Validar el nombre (`^[A-Za-z0-9_-]{1,64}$`) y que el `.pt` exista; si no, caer a `classifier_v1` con aviso en log.
- `app.py::main` y `training/replay.py` usan `active_model_path()`. `/api/health` agrega `"model": "<nombre>"` y la pantalla Diagnóstico lo muestra (web/src/lib/health.ts + Diagnostics; aditivo).
- Pruebas pytest (tmp_path con MODELS parcheado) y vitest para parseHealth.

### Task 2: Clase NINGUNA (rechazo de no-señas)

- `training/build_dataset.py`: las muestras `own` con glosa `NINGUNA` (largas, hasta 300 cuadros) se trocean en ventanas de 45, 60 y 90 cuadros con paso 30 (cada ventana es una muestra con `sample_id` `<id>_w<k>`), guardadas en `norm/`. Resto igual. Lógica de troceo en función pura testeable (`training/windows.py` o `lsm/windows.py`).
- Splits de grabaciones propias: además de la regla por persona, para `dataset == "own"` usar la toma: toma % 5 == 0 → `val` (para medir las glosas propias); el resto `train`. Documentarlo. Prueba.
- `training/build_references.py`: excluir `NINGUNA`.
- `server/lsm/session.py::_segment`: si top-1 es `NINGUNA` → en Traducción no agregar a `pending` ni emitir `sign` (descartar en silencio; opcional log debug); en Práctica el campo `recognized` sigue igual (la UI ya lo muestra) — no cambiar la evaluación. Si `NINGUNA` aparece en top-2/3 dejarlo (la UI de corrección no debe ofrecerla: filtrar `NINGUNA` de las alternativas en `web/src/components/GlossChips.tsx` o en el servidor antes de emitir `top3` — elegir servidor, más simple). Pruebas pytest con un clasificador falso.
- `/api/vocab`: no listar `NINGUNA` en el catálogo (filtrar en app.py). Prueba.
- Web: la pantalla Grabar ya soporta NINGUNA; no tocar salvo que falte algo.

### Task 3: Script de reentrenamiento

- `tools/retrain.sh` (bash, Git Bash): `source env.sh` → `python training/build_dataset.py` → `python training/train.py --out classifier_v<N+1> --epochs ${EPOCHS:-150}` (N = mayor versión existente en models/) → imprimir comparación contra el modelo activo: val/test/top-3/macro-F1 del report JSON, y exactitud en las muestras `own` de val si hay → `python training/build_references.py` (antes, copiar `references.json` a `references_<fecha>.json` de respaldo) → preguntar NO: activar solo si `--activate` se pasó, escribiendo `models/ACTIVE_MODEL`. Mensajes en español. Salir con error claro si no hay grabaciones propias nuevas o si falta algo.
- `train.py`: si no existe, agregar al reporte `own_val_acc` (exactitud en muestras own del split val) y `n_own_train`. Mantener compatibilidad con el reporte existente.
- `tools/retrain.sh --dry-run` (sin entrenar: solo build_dataset y conteos por glosa propia) para revisar que las grabaciones llegaron.
- Probar el script de punta a punta con `EPOCHS=2` y unas grabaciones sintéticas: generar 3 personas × 2 glosas × 5 tomas + 1 NINGUNA con `training/replay.py`/datos existentes copiados a un `LSM_ROOT` temporal en D: (NO ensuciar `datasets/own` real ni `models/` real: usa `LSM_ROOT=D:/Ingenium/tools/tmp/lsm_e2e` con enlaces/copias mínimas y bórralo al final). Documentar el tiempo real por época.

### Task 4: Arranque con un comando + chequeo previo

- `tools/start.sh` y `start.cmd` en la raíz del repo (doble clic en Windows; llama a Git Bash `"C:\Program Files\Git\bin\bash.exe"` o al python del venv directamente — elegir lo más robusto y documentarlo): si `web/dist` falta o es más viejo que `web/src` → `npm run build`; si faltan `web/public/mediapipe` o los `.task` → mensaje claro de cómo generarlos; luego `python -m lsm.app` (HOST 127.0.0.1, PORT 8000) y abrir `http://127.0.0.1:8000` en Edge.
- `tools/check.sh` (preflight de demo): servidor responde `/api/health` con classifier true, references > 0, model, llm (true/false con aviso "frases con plantillas"); `web/dist/index.html` existe; assets de MediaPipe responden 200; espacio libre en D:; imprime ✓/✗ por punto en español.
- Probar ambos (arrancar, chequear, detener).

### Task 5: Documentos de demo (los escribe el controlador)

- `docs/demo/checklist.md`: lista previa a la demo (cámara, luz, GPU en Diagnóstico, calibrar tras el último reinicio, formar oración antes de cambiar de pestaña, respaldo sin internet = plantillas, plan B sin guantes).
- `docs/demo/guion.md`: guion de 3–5 min (Práctica con una seña y retroalimentación → Traducción palabra a palabra → oración → párrafo), qué decir en cada paso.
- `docs/demo/grabaciones.md`: lista de palabras propias a grabar (fuera de las 121) y protocolo de grabación (personas, tomas, luz, encuadre, NINGUNA).
