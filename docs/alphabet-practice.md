# Práctica del alfabeto: estado y verificación

Se conservó la entrada y los dos modos iniciados en `AlphabetPractice.tsx`. Alfabeto está dentro de Práctica. La galería anterior permanece en el repositorio, sin pestaña principal.

## Reconocimiento existente

- El modelo activo local `models/ACTIVE_MODEL` es `classifier_v2`: Transformer PyTorch de 122 clases (121 glosas y NINGUNA). **No contiene letras**; no se reemplazó ni modificó.
- Se reutiliza `web/src/data/alphabet_classifier.json`: 27 centroides, clases A–Z y Ñ, y desviación estándar de 71 características. Coinciden con las medias por clase de `models/letters.npz` (8,100 muestras, 300 por clase; diferencia máxima comprobada para A < 0.000005).
- Entrada: 21 landmarks en píxeles del pipeline existente. Se resta muñeca, divide por distancia muñeca–MCP9, añade cinco flexiones / 180 y normal de palma (MCP5 × MCP17). Se comprobó esta representación contra `letters.npz`. No se utiliza la escala por puntas inventada en la implementación incompleta.
- Distancia cuadrática media estandarizada; rechazo si supera 0.9. Confianza relativa softmax con temperatura 0.03, umbral 0.65. **No es una probabilidad calibrada**, no existe informe de validación independiente de ese export ni procedencia verificable del dataset en el checkout.
- Coincidencia con las propias muestras de origen: 64.17%, que NO representa exactitud de prueba ni precisión con webcam. Especial confusión entre D, R, U y V. Todas las predicciones se presentan como experimentales.
- Validación de pose habilitada para A B C D E F G H I L M N O P R S T U V W Y. Son clases disponibles, no una garantía de reconocimiento correcto.
- J K Ñ Q X Z tienen flechas de movimiento en la referencia SEP: pueden seleccionarse y consultarse, pero **no se aprueban automáticamente** con este modelo estático. En secuencial se continúa con Siguiente. No se simula soporte temporal.

## Interacción y recursos

Fotografías LSM de SEP, con créditos y enlace al cartel completo, almacenadas localmente (ver `web/public/alphabet/SOURCE.md`). Se retiraron las instrucciones de dedos no verificadas. Se conservan diseño oscuro y landmarks sobre cámara.

Un solo `useCamera`, `useVision` y modelo de alfabeto importado. La vista de video solicita/libera el stream; cambiar de letra/modo conserva esa vista. Las solicitudes pendientes se serializan. Salir al catálogo o Inicio detiene tracks; ir a otra pantalla con cámara permite reutilizar el único stream. MediaPipe permanece cargado y su loop se cancela sin video. Se limpian listeners, intervalos y timeout de avance.

El hold requiere observaciones nuevas durante 800 ms; error, mano ausente, confianza baja, intervalo >250 ms o pestaña oculta reinician el intento. Solo después se muestra Correcto, con avance secuencial tras 600 ms. Cambiar objetivo/modo o salir cancela avances pendientes. Letra libre permite repetir.

## Pruebas

- `cd web; npm run build; npm test`: compilación y 94 pruebas (incluyen seis del clasificador/hold).
- Python en este checkout: establecer PYTHONPATH con `training` y `server` de la raíz actual; luego `.venv/Scripts/python.exe -m pytest -q`. 195 passed, 1 skipped, 2 deselected. Algunas pruebas existentes fijan `D:/Ingenium/training`, por eso requieren PYTHONPATH fuera de ese equipo.
- `web/scripts/check-alphabet.mjs`: Chrome headless, cámara simulada, carga real de MediaPipe, navegación, selección, único stream, salida y reentrada, sin excepciones. Requiere Playwright opcional en `web/node_modules/.browsercheck` y Vite en puerto 5173.
- La misma prueba verifica con landmarks controlados el hold, su reinicio, avance A→B, validación libre de M y bloqueo de aprobación estática de J.
- Prueba adicional de MediaPipe real (CPU) sobre video generado con las fotografías SEP A–F: detectó una mano en las seis. Clasificó A, B y F con confianza relativa >0.65; D quedó por debajo del umbral; confundió C con O y E con F (esta última bajo umbral). Confirma la conexión del pipeline y sus limitaciones, no precisión con personas.
- La cámara física y la precisión con personas/signantes reales requieren una sesión manual. No se presentan las pruebas simuladas como verificación física ni como validación lingüística del modelo.

## Retroalimentación correctiva

Flujo separado de la UI: `CaptureMonitor` / `captureFeedback` (captura) → `handShape` (medidas) → `analyzePose` (errores) → `describeIssue` / `poseFeedback` (un mensaje). La pantalla solo muestra el resultado `{correct, type, issue, message}`.

- **Captura primero**: sin mano, dos manos, landmarks fuera de la imagen, palma < 22 px, cambio neto > 0.15 palmas por landmark o muñeca > 0.5 palmas en 300 ms. Mientras haya un problema de captura no se analizan dedos.
- **Medidas** (`lib/handShape.ts`, invariantes a posición, escala y mano izquierda/derecha): flexión por dedo (ángulo muñeca→MCP vs MCP→punta), flexión del pulgar, posición del pulgar a lo ancho de la palma, distancia pulgar–índice, separación entre dedos vecinos extendidos, |z| de la normal de la palma (de frente / de lado) e inclinación en la imagen.
- **Referencia**: percentiles 2.5–97.5 y mediana de las 180 muestras de cada letra en `alphabet_samples.json`. Un error requiere quedar fuera del rango y a una distancia mínima de la mediana. Prioridad: orientación → dedos → pulgar → separación; se muestra un solo mensaje, estabilizado 400 ms.
- **Correcto** = el clasificador ve la letra y no hay un error grande muy fuera de rango (en las propias muestras esto bloquea ~3 %). Sin ninguna medida fuera de rango se muestra el mensaje general, nunca una instrucción inventada.
- **Letras con movimiento**: pose inicial (J→I, Ñ→N, Z→D, Q y X con su pose) mantenida 0.6 s antes de la cuenta; si se pierde durante la cuenta, se vuelve a la pose inicial. Después: pocos cuadros de cámara, pausa, mano perdida, fuera del cuadro, forma perdida (con el dedo), sin movimiento, poco amplio, demasiado rápido (< 10 cuadros con desplazamiento: mínimo para observar la trayectoria, no una velocidad de la LSM), cortado por la ventana, al revés, incompleto (coincide con el principio de la trayectoria) o dirección incorrecta.
- **Libre**: letra estable, top 3 de confianza relativa y solo retroalimentación de captura.

Limitaciones: sin la lateralidad de MediaPipe no se distingue palma de dorso (solo de frente / de lado); U/V y otras letras se solapan en separación dentro de los datos, así que no siempre hay una corrección medible; las trayectorias son aproximaciones de las flechas del cartel SEP, no secuencias de referencia; no se detecta "demasiado lento" porque la trayectoria se remuestrea por distancia. Nada de esto se ha validado con personas signantes.

## Verificación contra la letra objetivo (M, N, R, U, V)

El filtro del clasificador (confianza ≥ 0.65 y distancia ≤ radio) rechazaba casi siempre R, U y V aunque las eligiera como más probables. Con letra objetivo, `targetMatches` acepta si la mano es compatible con ella: kNN (muestra de la objetivo ≤ 3× su radio, ≤ 2× la mejor otra letra, ≥ 50 % de votos) o geometría (objetivo entre las 2 más votadas, ≤ 4× radio, ninguna medida fuera de rango y la rival más votada descartada por alguna medida). Nueva medida `fingerOrder` (orden índice→medio a lo ancho de la palma: R cruzados, U juntos, V separados). Parámetros elegidos con filas de validación de `letters.npz` (180–240) y medidos en las de prueba (240–300):

| Letra | Antes | Ahora | Acepta la vecina |
|---|---|---|---|
| M | 58 % | 68 % | N 7 % |
| N | 78 % | 90 % | (Ñ = misma pose) |
| R | 10 % | 57 % | U 15 % |
| U | 17 % | 38 % | R 17 % |
| V | 25 % | 73 % | U 15 % |
| Promedio 22 letras estáticas | 61 % | 77 % | |

La confirmación ya no se reinicia por un cuadro ruidoso: un desacuerdo ≤ 300 ms solo la pausa.

## Movimiento en vivo

Sin cuenta regresiva ni ventana fija (`LiveMotion`): pose inicial sostenida 0.5 s → «¡Listo!» → el movimiento empieza cuando la punta o la muñeca se desplazan > 0.15 palmas → avance del recorrido en vivo → termina cuando la mano queda quieta 0.45 s (o a los 4 s) → resultado 2.5 s y vuelve a empezar solo. Pausas cortas (0.3 s) no cortan el movimiento; una J de 3 s se acepta.

## Pantalla

Mismo lenguaje que Práctica de señas: medidor en la esquina de la cámara (`ScoreGauge`), una sugerencia debajo (`practice-note`), dedos en vivo marcados en `HandDiagram` (derivados de las mismas medidas) y pasos del movimiento.
