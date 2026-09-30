# Lista de verificación antes de la demo

## La noche anterior / 1 h antes
- [ ] `git status` limpio y último modelo activo correcto (Diagnóstico muestra el modelo).
- [ ] `npm run build` hecho después del último cambio de la web (o usar `start.cmd`, que lo detecta).
- [ ] `D:\Ingenium\.env` con `OPENAI_API_KEY` (Diagnóstico: "frases con IA"; si dice "plantillas", revisar red/clave).
- [ ] Laptop conectada a la corriente, modo de energía "Máximo rendimiento", notificaciones apagadas.
- [ ] Guantes cargados/alimentados, cables USB probados, ESP32 identificados (L y R).
- [ ] Ensayo completo del guion (`guion.md`) al menos una vez en el lugar real (luz real).

## 10 min antes
- [ ] Cerrar Teams/Zoom/cualquier app que use la cámara.
- [ ] Arrancar con `start.cmd` → se abre `http://127.0.0.1:8000` en Edge.
- [ ] `bash tools/check.sh` todo en ✓.
- [ ] **Diagnóstico:** MediaPipe en **GPU** (si dice CPU, cerrar pestañas y recargar), FPS ≥ 20, servidor conectado, modelo cargado.
- [ ] Luz de frente al señante, fondo liso detrás, encuadre de cintura a cabeza.
- [ ] **Calibrar guantes** (después del último reinicio del servidor).
- [ ] Probar una seña en Práctica y una oración corta en Traducción.

## Durante
- [ ] Entre señas en Traducción: se pueden bajar las manos un momento; al terminar la oración, manos al reposo
  ~3.5 s (la app muestra "Formando oración en 3 s… sube las manos para seguir"; subir las manos cancela la
  cuenta). La pausa se ajusta con `LSM_PAUSE_S=<segundos>` en `.env` (por defecto 3.5; rango válido 1.5–10) y
  reiniciando el servidor. "Formar oración ahora" la forma sin esperar.
- [ ] **Formar la oración antes de cambiar de pestaña** (si no, las señas pendientes se descartan; la app avisa).
- [ ] Si aparece "Se reinició la conexión: vuelve a calibrar", recalibrar (20 s).

## Plan B
- Sin guantes → solo cámara (todo funciona; solo se pierde la retroalimentación de flexión fina).
- Sin internet → oraciones con plantillas.
- Laptop falla → segunda laptop con el repo clonado y probado (hacer esta copia antes del evento).

## Si "tarda en validar" o reconoce mal
- El servidor escribe `D:\Ingenium\logs\lsm.log` (rotativo, 5 MB × 3; no guarda el texto de las oraciones).
- Cada seña: `segmento ... seg=<s> motivo=reposo|quietud|max_len fps=<n> top3=... total=... top_y_min/top_y_fin`.
  Si en Práctica sale `motivo=max_len` (tras ~5 s) en vez de `reposo`, la app no está viendo las manos en reposo.
- Cada ~5 s: `resumen fps=<n> manos=<%> activos=<%> top_y_med=<y> top_y_p90=<y> rest_y=3.50 estado=...`.
  Con las manos quietas en el escritorio, `activos` debería ser ~0 %. Si es alto y `top_y_p90` queda justo
  por debajo de `rest_y` (p. ej. 3.2), las manos en reposo cuentan como seña: subir el umbral con
  `LSM_REST_Y=<top_y_p90 + 0.3>` en `.env` (o en el entorno) y reiniciar el servidor. Por defecto 3.5; rango válido 1–8.
  Solo afecta la segmentación en vivo, no al modelo. Alternativa sin tocar nada: bajar las manos al regazo.
- FPS de la cámara: el servidor ajusta sus umbrales a la tasa real (`fps=` en el registro); a 15 fps la
  evaluación llega ~0.27 s después de bajar las manos.
