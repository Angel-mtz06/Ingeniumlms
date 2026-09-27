# Diseño: Sistema de evaluación e interpretación de LSM con guantes sensorizados

**Evento:** INDIVISA INGENIUM 2026, Universidad La Salle Oaxaca (29 sep 10:00 → 30 sep 15:00, 24 h)
**Equipo:** 6 integrantes (roles asignados por el líder)
**Fecha del diseño:** 27 de septiembre de 2026
**Estado:** aprobado por secciones en conversación; pendiente de revisión final del documento

---

## 1. Objetivo y alcance

### 1.1 Reto oficial
Crear un dispositivo mecatrónico con sensores que trabaje junto a una aplicación de visión artificial para **evaluar la correcta ejecución de una seña de la Lengua de Señas Mexicana (LSM) y dar retroalimentación en tiempo real**. La solución debe integrar hardware y software; los componentes llegan sueltos y se ensamblan en el evento.

### 1.2 Nuestra propuesta
1. **Modo Práctica** (cumple el reto): el usuario elige una seña, la ejecuta y recibe una calificación por parámetro de la LSM con correcciones concretas.
2. **Modo Traducción** (diferenciador): reconoce señas de forma continua y genera **oraciones y párrafos en español** gramaticalmente correctos.

### 1.3 Principios
- **La cámara es el sensor principal de reconocimiento.** Los guantes mejoran la precisión de la retroalimentación (flexión de dedos, contactos, orientación) y no son necesarios para reconocer.
- **Todo funciona sin guantes** (modo solo cámara), para que cualquiera pueda usar la versión web.
- **La demo nunca depende de un único punto de falla** (ver §9).

### 1.4 Fuera de alcance (v1)
- Deletreo con alfabeto dactilológico (segundo modelo; solo si sobra tiempo).
- Traducción continua sin segmentar, entrenada de extremo a extremo (el dataset LSM Prensa existe, pero no es viable en 3 días).
- App móvil nativa.

---

## 2. Datasets (verificados el 26–27 sep 2026)

Todo se guarda en `D:\Ingenium\datasets\` (el disco C: no tiene espacio).

### 2.1 Mendeley "Mexican Sign Language dataset" — base de vocabulario general
- **Fuente:** https://data.mendeley.com/datasets/6rj76z6y3n/1 · licencia **CC BY 4.0** · descargado (1.8 GB, 31 417 archivos).
- **249 palabras** en 15 categorías: saludos, tiempo, días, meses, útiles escolares, familia, casa, adjetivos, cocina, ropa, cuerpo, vehículos, lugares, pronombres, verbos, profesiones, estados de México (incluye **OAXACA**, **SORDO** y **LENGUA DE SEÑAS**). Lista completa en `datasets/mendeley_verify/classes.txt`.
- **2 447 muestras, ~10 por palabra** (una por persona, 11 personas).
- **Solo 9–15 fotogramas JPG por muestra** (640×480), no el video completo.
- Estructura: `MSLwords1/<id_palabra>/<persona><id_palabra>/<archivo>.jpg`. **La numeración de los fotogramas es inconsistente** (empieza en `000` o en `001`); ordenar por nombre, sin asumir el índice inicial.

**Verificación con MediaPipe (3 muestras, 37 cuadros):**

| Aspecto | Resultado | Implicación |
|---|---|---|
| Mano activa | ✅ 36/37 cuadros | El reconocimiento de la forma y el movimiento de la mano es viable |
| Mano en reposo | ⚠️ se pierde con frecuencia | Aceptable: no participa en la seña |
| Etiqueta izquierda/derecha | ⚠️ poco confiable | Asignar cada mano por su posición, no por la etiqueta |
| Cuerpo (pose) | ❌ 9–12/37 cuadros | **Caras pixeladas**; hace falta otra referencia corporal (§4.2) |
| Rostro | ❌ pixelado | No aporta rasgos no manuales |

### 2.2 "Mexican Sign Language Glosses (Dynamic Signs)" — alta calidad, complemento
- **Fuente:** https://zenodo.org/records/18330565 · **CC BY 4.0** · descargado (`lsm_glosses.7z`, 2.55 GB).
- **119 glosas**, 10–12 videos cada una (1 415 videos). 12 personas: **una intérprete profesional (sujeto 0) y una persona sorda (sujeto 11)**, más 10 personas no expertas.
- Video **1920×1080, caras visibles**, fondo verde, buena iluminación. FPS variable (25/30/60) y duración de 1 a 6 s, con tiempo muerto al inicio y al final.
- Vocabulario de salud, emergencias y cortesía, pero **cubre huecos clave de Mendeley**: HOLA, IR, TENER, NECESITAR, GUSTAR, ESTAR, AHORA, ANTES, PRÓXIMO, DÓNDE, CÓMO, CUÁNTO, SÍ, NO, YO, MI, SU, ÉL, GRACIAS, POR_FAVOR, AMIGO, CASA, COMIDA, NOCHE, TARDE, NO_ENTENDER, NO_PODER…
- Artículo de referencia: 82% de exactitud con personas no vistas (1D ResNet): https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2026.1794923/full

**Verificación con MediaPipe (3 videos, 36 cuadros):** pose ✅ 36/36; manos ✅ 33/36 (los faltantes son cuadros en reposo).

### 2.3 Descartados o solo de apoyo
- **MSL-150** (https://zenodo.org/records/17783312): 1 persona real por seña (las 799 muestras restantes son variaciones sintéticas). El repositorio de GitHub (clonado, 363 MB) solo trae 5 clases. **No descargamos el paquete de 4.2 GB.** Conservamos su lista de 149 términos.
- **LSM Prensa** (lenguaje continuo, sin glosas): fuera de alcance.
- **Alfabeto LSM** (Data in Brief 2026): fuera de alcance v1.

### 2.4 Unificación de vocabulario
- Una tabla `vocab.csv` define la **glosa canónica en español** (`ESCUELA`, `YO`, `IR`…), la categoría y el origen (`mendeley:036`, `glosses:IR`, `propio`).
- Las palabras presentes en ambos datasets (p. ej. AYUDA, YO, ÉL, DÍA, GRACIAS, POR_FAVOR, NOS_VEMOS, SORDO, LSM, CASA, CARRO, EDIFICIO, BOMBEROS, POLICÍA, BRAZO, CABEZA, ROSTRO, COMIDA, BONITO, BAÑO, DOCTOR, HOSPITAL) **se fusionan y llegan a ~22 personas por palabra**.
- Vocabulario total aproximado: 249 + 119 − ~22 compartidas ≈ **~345 glosas**.

### 2.5 Grabaciones propias (indispensables)
- **40–60 palabras núcleo** para la demo, **15–20 repeticiones** por persona del equipo, más ~5 min de "ninguna seña" (transiciones y reposo).
- Palabras que no están en ningún dataset y deben grabarse: HOY, AYER, MAÑANA (tiempo), QUERER, TRABAJAR, ESTUDIAR, NOMBRE, más las que defina el guion.
- Se graban **con la misma app web** (misma cámara y mismo MediaPipe que en la demo).
- Única fuente de **rasgos no manuales** (los datasets no aportan expresión facial utilizable de forma consistente).

### 2.6 Conclusión sobre la calidad
- **LSM Glosses:** excelente calidad técnica y lingüística (intérprete + persona sorda). Es la mejor fuente de **referencias para el modo Práctica**.
- **Mendeley:** calidad aceptable para reconocer la mano, pobre para ubicar el cuerpo. Es la única fuente de **vocabulario general**.
- **Limitación honesta:** ningún dataset supera ~12 personas por palabra (~22 en las compartidas). Se espera **~75–85% de exactitud con personas nuevas** sobre vocabulario amplio; las grabaciones propias elevan la confiabilidad de las palabras núcleo en la demo.

---

## 3. Arquitectura

### 3.1 Vista general (híbrida: la misma app en la laptop y en el VPS)

```
NAVEGADOR (usuario)                                  SERVIDOR PYTHON (laptop o VPS)
┌──────────────────────────────────┐                 ┌─────────────────────────────────┐
│ Cámara → MediaPipe Tasks (JS)    │  landmarks +    │ features   (normalización única) │
│ Guantes L/R → Web Serial (USB)   │ ─ lectura guante►│ segmenter  (inicio/fin de seña) │
│ UI: Práctica / Traducción        │   (WebSocket)   │ classifier (PyTorch)            │
│ Voz: speechSynthesis             │ ◄───────────────│ evaluator  (cámara + guantes)   │
└──────────────────────────────────┘   resultados    │ sentences  (LLM + plantillas)   │
                                                     └─────────────────────────────────┘
```

- **No se sube video**, solo landmarks (privacidad y ancho de banda).
- **La normalización vive solo en el servidor**: el navegador manda landmarks crudos, así el entrenamiento y la inferencia usan el mismo código.
- **Guantes por Web Serial** (Edge o Chrome de escritorio): el hardware se conecta a la laptop donde está abierta la página, sin importar dónde corra el servidor.
- **Demo final: servidor local en la laptop.** El VPS es para acceso público.

### 3.2 Estructura del repositorio (`D:\Ingenium`)

```
D:\Ingenium\
├── firmware/      ESP32 (PlatformIO, Arduino): lectura IMU + Hall, protocolo serie, modo simulado
├── web/           React + Vite + TypeScript: cámara, MediaPipe, Web Serial, UI
├── server/        FastAPI + WebSocket
│   ├── features/     normalización y ángulos de dedos
│   ├── segmenter/    detección de inicio y fin de seña
│   ├── classifier/   modelo e inferencia
│   ├── evaluator/    referencias, puntajes y mensajes
│   ├── sentences/    glosas → español (proveedor configurable)
│   └── glove/        parser del protocolo, calibración, guante simulado
├── training/      extracción de landmarks, dataset unificado, entrenamiento, métricas
├── docs/          especificaciones, esquema de instrumentación, artículo APA
├── datasets/      (no se versiona) datos crudos y procesados
└── tools/         (no se versiona) Python 3.12, cachés, utilidades
```

**Todo se instala en D:** (entorno de Python, cachés de pip/npm, modelos de torch). Python 3.12 va aparte en `D:\Ingenium\tools` porque el Python 3.14 del sistema no tiene MediaPipe.

### 3.3 Flujo de un cuadro
1. El navegador obtiene los landmarks (manos, pose, cara) a ~30 fps.
2. Adjunta **la lectura más reciente de cada guante** y envía un solo mensaje por WebSocket.
3. El servidor normaliza, actualiza el buffer y el segmentador decide si hay una seña en curso o terminada.
4. En **Práctica**: el evaluador compara contra la referencia de la seña elegida y responde ~15 veces por segundo con el estado de cada dedo, más un resumen al terminar.
5. En **Traducción**: al terminar una seña se clasifica (top-3 + confianza). Tras una pausa de ~1.5 s se genera la oración.

---

## 4. Modelo de IA

### 4.1 Extracción (offline, Python + MediaPipe Tasks)
Se extraen landmarks por cuadro de ambos datasets y se guardan como `.npz` por muestra:
- **Manos:** 21 puntos × 2 (x, y, z).
- **Pose superior:** ~9 puntos (hombros, codos, muñecas, nariz, orejas).
- **Cara:** ~20 puntos (cejas y boca), solo LSM Glosses y grabaciones propias.
- **LSM Glosses:** se remuestrea a 30 fps y se recortan los tramos quietos al inicio y al final.

### 4.2 Normalización (módulo `features`, compartido entre entrenamiento e inferencia)
- **Referencia corporal = la cabeza** (centro y ancho), para que las tres fuentes (Mendeley, LSM Glosses y la cámara en vivo) usen la misma medida. Prioridad por cuadro:
  1. Malla facial: punta de la nariz + distancia entre mejillas (puntos 234 y 454).
  2. Pose: nariz + distancia entre orejas (visibilidad > 0.5).
  3. **Bloque pixelado de la cara** (Mendeley): región color piel sobre fondo y ropa negros, medida en los cuadros de reposo; ancho × factor calibrado.
  Los cuadros sin referencia toman la mediana de la muestra (cámara fija, persona casi inmóvil).
- **Forma de la mano** en coordenadas propias (origen en la muñeca, escala por la palma) + **ángulo de flexión por dedo**. El evaluador usa esos mismos ángulos.
- **Asignación de manos por posición** (lado de la imagen respecto al centro corporal), no por la etiqueta de MediaPipe.
- **Largo fijo: 16 cuadros**. Es el mínimo común, porque Mendeley solo tiene 9–15 fotogramas por muestra.
- Si una mano no aparece: ceros + indicador de ausencia.

### 4.3 Clasificador
- **Transformer pequeño** (~1–2 M parámetros), con una 1D-ResNet como alternativa (la usada en el artículo de LSM Glosses).
- Salida: top-3 + confianza, más la clase **`NINGUNA`** (transiciones y reposo, de grabaciones propias).
- **Aumentación de datos:** rotación, escala, desplazamiento, cambio de velocidad, pérdida de cuadros, ruido, espejo (con intercambio de manos).
- **Umbral de confianza ~0.6:** por debajo, la UI ofrece las 3 opciones más probables.
- Entrenamiento: menos de 1 h en CPU, o minutos en Colab.

### 4.4 Ajuste fino y evaluación
- Ajuste fino con las grabaciones propias de las palabras núcleo.
- **Evaluación con personas no vistas** (se dejan 2 fuera, o leave-one-subject-out en LSM Glosses): exactitud, top-3, F1 y matriz de confusión. Son las figuras del artículo APA.

### 4.5 Segmentador (modo Traducción)
Heurística: velocidad de las muñecas + altura de las manos respecto a la cadera o el reposo.
- La seña **inicia** cuando la mano sube y se mueve.
- La seña **termina** tras ~300 ms de quietud o al volver al reposo.
- Una **pausa de ~1.5 s** con las manos abajo cierra la oración.

---

## 5. Evaluador y retroalimentación (modo Práctica)

### 5.1 Referencias por seña (precalculadas)
A partir de todas las personas de los datasets (se prioriza a la intérprete y a la persona sorda de LSM Glosses cuando existan):

| Parámetro LSM | Referencia | Comparación |
|---|---|---|
| **Configuración** | Ángulo por dedo en la **fase de sostén** (cuadros de menor movimiento) | Diferencia por dedo |
| **Ubicación** | Posición de la mano respecto a la cara y los hombros | Distancia normalizada |
| **Movimiento** | Trayectoria media de la mano dominante | DTW |
| **Orientación** | Normal de la palma | Diferencia angular |
| **Rasgos no manuales** | Solo en señas con grabación propia | Opcional |

**Tolerancia estadística:** el puntaje (0–100) mide la distancia en relación con la **variación natural entre signantes** (desviación típica por parámetro). Un parámetro donde las personas varían mucho se califica de forma flexible; uno donde todas coinciden, de forma estricta.

### 5.2 Fusión cámara + guantes

| Dato | Con guante | Sin guante |
|---|---|---|
| Flexión por dedo | **Guante** (la cámara falla con oclusiones) | Cámara |
| Contacto pulgar-dedo | **Sensor Hall** | Distancia entre puntas de dedos |
| Orientación de la palma | **IMU del dorso** | Cámara |
| Ubicación y movimiento | Cámara (+ giroscopio para suavizar) | Cámara |

**Equivalencia guante ↔ dataset:** en la calibración (mano abierta y puño), la cámara y el guante miden al mismo tiempo. Con eso se ajusta una transformación lineal por dedo, de grados del guante a grados de la cámara (la escala del dataset).

### 5.3 Mensajes
- **En vivo (~15 Hz):** mano dibujada con cada dedo en verde, amarillo o rojo.
- **Resumen al terminar:** 4 puntajes + **solo las 1–2 correcciones más importantes**.
- **Mensajes por plantilla** (instantáneos, deterministas, sin internet). Ejemplos: *"Mano derecha: dobla más el índice (40° de ~90°)"*, *"Sube la mano a la altura de la barbilla"*, *"El pulgar debe tocar el dedo medio"*.
- **Si no se puede evaluar, se avisa** en lugar de calificar: *"No veo tu mano derecha: acércate o mejora la luz"*.

---

## 6. Generación de oraciones (modo Traducción)

- **Entrada:** secuencia de glosas confirmadas (p. ej. `AYER / YO / DOCTOR / IR`) + oraciones previas (contexto).
- **Proveedor:** **OpenAI** (llave existente), configurable en `.env` (`SENTENCES_PROVIDER=openai|anthropic`). Modelo rápido para baja latencia.
- **Prompt:** reglas de gramática LSM (tiempo al inicio, orden tema-comentario, sin artículos ni conjugación, pronombres por señalamiento) y la instrucción de **no inventar contenido** que no esté en las glosas.
- **Párrafo:** las oraciones se acumulan manteniendo la coherencia (pronombres y concordancia de género).
- **Respaldo sin LLM:** plantillas por reglas (tiempo + sujeto + verbo + complemento), si no hay internet o la API falla.
- La API key **nunca** llega al navegador.

---

## 7. Hardware y firmware

### 7.1 Componentes (por guante; 2 guantes)
- 1 × ESP32 (se recomienda ESP32-S3 por USB nativo y más ADC; el clásico también funciona).
- 1 × TCA9548A (multiplexor I2C).
- 6 × MPU-6050: dorso + 1 por dedo.
- 7–8 × SS49E (Hall) + imanes de 5×3 mm N35.
- Opcional recomendado: motor vibrador o LEDs WS2812 para retroalimentación háptica o visual en la mano.

### 7.2 Cableado

```
ESP32 ── I2C 400 kHz ──► TCA9548A
                          ├─ canal 0: dorso (0x68, AD0→GND) + pulgar (0x69, AD0→3V3)
                          ├─ canal 1: índice (0x68) + medio (0x69)
                          └─ canal 2: anular (0x68) + meñique (0x69)
ESP32 ── ADC directos ──► SS49E ×7–8
```
- **Todo se alimenta desde el pin 3V3**, nunca desde 5V/VIN: el SS49E a 5 V puede sacar ~4.2 V y dañar el ADC del ESP32.
- **Sin WiFi**, así que el ADC2 también es utilizable:
  - ESP32 clásico: ~12 pines analógicos seguros (32, 33, 34, 35, 36, 39, 4, 13, 14, 25, 26, 27).
  - ESP32-S3: ~18.
- Consumo estimado ~300 mA por guante, dentro de la capacidad del regulador de 3.3 V.
- Separar los imanes para que ningún Hall capte el imán del dedo vecino. El MPU-6050 no tiene magnetómetro, así que no le afectan.

### 7.3 Firmware
- Lectura a 100 Hz, envío a 50 Hz. **Filtro complementario** por IMU → pitch y roll (sin yaw, que deriva sin magnetómetro).
- Hall: promedio de 4 lecturas.
- Identidad del guante (`L`/`R`) definida al compilar.
- **Robustez:** fallo por sensor aislado con bits de estado y reintento cada 2 s; watchdog; LED de estado (fijo = OK, parpadeo = falla).
- **Modo simulado** (opción de compilación): genera datos realistas sin sensores, para desarrollar el software antes del evento.

### 7.4 Protocolo serie (USB, texto por líneas)

```
→ ID?
← ID,R,fw=1.0,imus=6,halls=8
← D,<L|R>,<seq>,<t_ms>,p0,r0,...,p5,r5,gx,gy,gz,h0,...,h7,<status_bits>
```
- Velocidad: 921600 baudios en el ESP32 clásico; con USB nativo (S3) la velocidad es indiferente.
- `seq` permite detectar pérdidas; `status_bits` indica qué IMU responde.
- La flexión por dedo (diferencia dedo − dorso) y la calibración se calculan en el **servidor**.

---

## 8. Interfaz

- **Tecnología:** React + Vite + TypeScript; FastAPI sirve la app compilada.
- **VPS:** HTTPS obligatorio (cámara y Web Serial requieren un contexto seguro), con **Caddy** y certificado automático. **Pendiente:** dominio o subdominio.
- **Pantallas:**
  - **Inicio:** modos, estado de dispositivos, botón "Conectar guantes".
  - **Calibración:** 3 poses guiadas, progreso por dedo.
  - **Práctica:** catálogo por temas → referencia animada (esqueleto, cámara lenta) → cámara con landmarks → mano con colores → tarjeta de puntajes.
  - **Traducción:** cámara → etiquetas editables (top-3) → oración y párrafo grandes, con voz y copiar.
  - **Diagnóstico:** cada sensor de cada guante en vivo.
- **Barra de estado permanente:** cámara, guante L y R (con sensores caídos), servidor y latencia.
- **Accesibilidad:** todo es visual primero (usuarios sordos); la voz es para la persona oyente. Texto grande, alto contraste, español.
- **Celular:** solo cámara (Web Serial no existe en móviles); el panel de guantes se oculta.
- **Proceso de diseño visual** (según `CLAUDE.md`): `awesome-design` → `design-taste-frontend` → `web-design-guidelines` → `playwright-cli` (Edge, escritorio y móvil).

---

## 9. Robustez y plan B de la demo

| Falla | Comportamiento |
|---|---|
| Un guante o un sensor | Aviso en la UI; el resto sigue funcionando; sin guantes → solo cámara |
| Internet / API del LLM | Oraciones por plantillas |
| VPS | La demo corre en el servidor local (el principal) |
| Seña mal reconocida | El usuario toca la etiqueta y elige entre las top-3 |
| Mano no visible | Mensaje de guía en lugar de un puntaje falso |

---

## 10. Pruebas

- **pytest:** normalización (incluye asignación de manos y referencias de respaldo), segmentador, evaluador con datos sintéticos, parser del protocolo, calibración, oraciones de respaldo.
- **Métricas del modelo** con personas no vistas + matriz de confusión.
- **Grabar y reproducir:** la app guarda sesiones completas (landmarks + guantes) y el servidor las reproduce. Sirve como prueba de regresión del guion de la demo sin cámara ni hardware.
- **Guante simulado** (firmware y Python) para probar todo antes del evento.
- **Pantalla de diagnóstico** para verificar el hardware en segundos.

---

## 11. Plan de trabajo

### 11.1 Paquetes (asignación a cargo del líder)
- **A. Hardware (2):** armado, soldadura, firmware, esquema de instrumentación.
- **B. IA y datos (1):** extracción, entrenamiento, grabaciones, métricas.
- **C. Servidor (1):** WebSocket, evaluador, oraciones, despliegue.
- **D. Interfaz (1):** pantallas, cámara, Web Serial.
- **E. Documentación y demo (1):** artículo APA, presentación, guion, video del 2º corte.

Todos graban las palabras núcleo (~30 min por persona).

### 11.2 Antes del evento
| Día | Entregables |
|---|---|
| Dom 27 | Entorno en D:, extracción de landmarks (ambos datasets), esqueleto de servidor y app con cámara, firmware simulado, módulo de oraciones |
| Lun 28 | Modelo v1 + métricas, herramienta de grabación, **grabación de palabras núcleo**, ajuste fino, pantallas de Práctica y Traducción, VPS con HTTPS |
| Mar 29 (mañana) | Congelar versión, lista de verificación, todo cargado en la laptop de la demo |

⚠️ **Confirmar con los organizadores:** ¿se permite probar el firmware antes del evento con un sensor en protoboard (sin soldar) y desarmarlo después?

### 11.3 Durante las 24 h
| Horario | Actividad |
|---|---|
| D1 10:00–14:00 | Soldadura y armado de guantes (R y luego L); integración con datos reales; metodología |
| 14:00–19:00 | Pruebas por sensor, sujeción de cables; calibración y evaluador con guante; preparar el 1er corte |
| **19:00–20:00** | **1er corte (15%)**: metodología, roles, app real como maqueta, esquema de instrumentación |
| 20:00–04:00 | Robustez física (alivio de tensión, estuche); integración completa; borrador APA |
| 04:00–06:00 | Grabar y editar el video del 2º corte |
| **D2 06:00–07:00** | **2º corte (25%)**: video con sensores funcionando + UI |
| 07:00–11:00 | Ensayos del guion, correcciones; artículo y presentación finales |
| 11:00 | **Congelar versión** |
| **12:00–15:00** | **Evaluación final (60%)** |

### 11.4 Guion de la demo (progresión)
1. **Palabra** en Práctica, con calificación y correcciones (con guantes).
2. **Oración** en Traducción (p. ej. *"Hola, yo soy sordo. Necesito ir al doctor."*).
3. **Párrafo** de 2–3 oraciones de distintos temas, leído en voz alta.

---

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Pocas personas por palabra (~10–22) | Aumentación + grabaciones propias + top-3 editable |
| Mendeley sin pose (caras pixeladas) | Referencia de respaldo (pose propagada o bloque de la cara) + aumentación de posición y escala |
| Diferencias entre MediaPipe JS y Python | Normalización única en el servidor; ajuste fino con datos capturados por la app |
| Hardware armado hasta el evento | Firmware y guante simulados; pantalla de diagnóstico |
| Calificación injusta por diferencias de mano | Calibración por usuario + tolerancia basada en la variación entre signantes |
| Disco C: lleno | Todo en `D:\Ingenium`, con cachés redirigidas |

---

## 13. Pendientes

- Dominio o subdominio para el VPS (HTTPS).
- Lista final de 40–60 palabras núcleo y guion de la demo.
- Confirmar con los organizadores las pruebas de hardware previas al evento.
- ¿Motor vibrador o LEDs en el guante? (opcional)
- Asignación de roles (líder).
