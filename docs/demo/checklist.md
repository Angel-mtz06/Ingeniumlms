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
- [ ] Entre señas en Traducción: pausa breve; al terminar la oración, manos al reposo ~1.5 s.
- [ ] **Formar la oración antes de cambiar de pestaña** (si no, las señas pendientes se descartan; la app avisa).
- [ ] Si aparece "Se reinició la conexión: vuelve a calibrar", recalibrar (20 s).

## Plan B
- Sin guantes → solo cámara (todo funciona; solo se pierde la retroalimentación de flexión fina).
- Sin internet → oraciones con plantillas.
- Laptop falla → segunda laptop con el repo clonado y probado (hacer esta copia antes del evento).
