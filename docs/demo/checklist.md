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

## Contexto de glosas (si el contexto elige mal)
- En Interpretación la seña anterior ayuda a elegir entre las candidatas del modelo (tras HOLA se prefiere YO, COMO
  o AMIGO a BOMBEROS). Las señas elegidas así dicen "por contexto"; al formar la oración, las que el LLM (o, sin
  internet, el modelo de bigramas) cambió dicen "corregida por contexto" bajo "Señas usadas".
- Nunca cambia una seña con probabilidad ≥ 70 % ni elige una alternativa < 5 %, ni una seña confirmada a mano.
  En `logs\lsm.log`: `contexto top1 A->B previa=X` y `oración corregida por contexto ... cambios=`.
- Ajustar el peso: `LSM_CONTEXT_WEIGHT=<0–3>` en `.env` (por defecto 0.5; más alto = más contexto) y reiniciar el
  servidor. **Desactivar todo el contexto: `LSM_CONTEXT_WEIGHT=0`** (vuelve al top-1 del clasificador; al arrancar
  imprime "contexto de glosas: desactivado").
- Solo quitar las candidatas del LLM (sigue el reordenamiento en vivo): `LSM_CONTEXT_LLM=0`.
- El LLM por defecto es `gpt-4o` (`SENTENCES_MODEL=gpt-4o-mini` en `.env` para volver al anterior).
- Para enseñarle frases nuevas: agregar oraciones en glosas a `server/lsm/data/corpus_glosas.txt` (una por línea,
  solo glosas del vocabulario y `<NOMBRE>`) y reiniciar el servidor; `pytest server/tests/test_context.py` valida
  que todas existan.

## Interpretación: tema, validar cada seña y deletreo
- **Tema de la conversación** (Todo, Saludos, Salud, Emergencias): antes de empezar, elegir el tema de la demo.
  Las señas del tema ganan los empates dentro de las 5 candidatas (nunca cambia una seña con ≥ 70 %). Fuerza del
  empujón: `LSM_TOPIC_BOOST=<1–20>` en `.env` (por defecto 3; 1 = sin efecto).
- **Validar cada seña** (activado por defecto): tras cada seña aparecen hasta 3 candidatas; tocar la correcta o
  "Ninguna" (teclas 1, 2, 3 y X). Mientras falte validar, la app no manda cuadros ni forma la oración ("Elige la
  palabra para seguir"). "Aceptar todas las sugeridas" valida de un clic; "Formar oración" se habilita con todo
  validado. Apagado, la app forma la oración sola como antes.
- **Deletrear** (tecla D) para nombres: letra por letra con el alfabeto manual (el mismo reconocedor de Alfabeto);
  sostener cada letra ~0.6 s; para repetir una letra, mover la mano entre las dos; "⌫ Borrar letra" quita la
  última; bajar la mano 1 s termina la palabra, que entra ya validada ("A·N·G·E·L", etiqueta "deletreo"). Evitar
  mover mucho la muñeca entre letras: un movimiento grande se analiza como letra con movimiento y pausa el
  reconocimiento ~2–3 s.

## Ensamble de semillas (opcional, NO activado)
- `models/classifier_v2e.pt` promedia las probabilidades de classifier_v2 (semilla 1) y sus gemelos de semilla 0 y 2
  (`logs/model_v2/augnone_s{0,1,2}.pt`, mismas 122 clases en el mismo orden). Usa las referencias y el catálogo de
  classifier_v2 (`paths.base_model`: `<base>e` = ensamble de `<base>`).
- Medido con `training/ensemble_eval.py` (test = persona g02, 121 señas y 146 NINGUNA): exactitud 82.6 % → 82.6 %
  (igual), top-3 92.6 % → 95.0 % (+2.5), NINGUNA colada 30.8 % → 31.5 %; val (g03): exactitud 94.2 → 95.8, top-3
  98.3 → 99.2. ~31 ms por seña en vez de ~10 ms. Ayuda sobre todo a que la seña correcta aparezca entre las 3
  candidatas de "Validar cada seña"; no mejora el top-1.
- Activarlo: `LSM_MODEL=classifier_v2e` en `.env` (o `classifier_v2e` en `models/ACTIVE_MODEL`) y reiniciar el
  servidor; al arrancar imprime "modelo activo: classifier_v2e". Volver: quitar la línea o poner `classifier_v2`.
