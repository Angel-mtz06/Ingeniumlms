# Arquitectura del sistema — Intérprete y evaluador de LSM

INDIVISA INGENIUM 2026 · Universidad La Salle Oaxaca

Sistema que **evalúa y traduce Lengua de Señas Mexicana (LSM)** en tiempo real combinando **visión por computadora**,
**guantes instrumentados inalámbricos** e **inteligencia artificial**. Da retroalimentación correctiva de cada seña
(Práctica), convierte secuencias de señas en oraciones en español (Interpretación) y enseña el alfabeto manual
(Alfabeto).

> **Principio de diseño.** El video nunca sale de la laptop: el navegador extrae **puntos clave** (keypoints) y solo
> esas coordenadas se procesan. Todo funciona **sin internet**; la única función que lo aprovecha es la redacción
> natural de oraciones, con respaldo local.

---

## 1. Diagrama de flujo

```mermaid
flowchart TD
    %% ---------- Captura ----------
    subgraph CAP["① Captura"]
        CAM["📷 Cámara web<br/>960×540 · 7–30 fps"]
        GR["🧤 Guante derecho · ESP32<br/>6 IMU MPU-6050 + TCA9548A<br/>sensores Hall SS49E"]
        GL["🧤 Guante izquierdo · ESP32<br/>mismos sensores"]
    end

    %% ---------- Red local ----------
    subgraph NET["② Red WiFi local (sin internet) · SSID «LSM-Guantes»"]
        AP(["Punto de acceso<br/>ESP32 derecho · 192.168.4.1"])
    end

    GR -- "WebSocket :81<br/>D,R,seq,t,ángulos,Hall · 50 Hz" --> AP
    GL -- "WiFi (estación 192.168.4.3)<br/>WebSocket :81 · 50 Hz" --> AP
    AP -- "WiFi" --> LAP

    %% ---------- Laptop ----------
    subgraph LAP["③ Laptop (todo local)"]
        direction TB
        subgraph NAV["Navegador · React + TypeScript"]
            MP["MediaPipe Tasks Vision (GPU)<br/>manos 2×21 · pose · cara"]
            GW["Lectura de guantes<br/>WebSocket a cada ESP32"]
            PAY["Cuadro = keypoints + lecturas<br/>de guantes + marca de tiempo"]
            ABC["Alfabeto<br/>k-NN de letras en el navegador"]
        end
        subgraph SRV["Servidor local · Python FastAPI · 127.0.0.1:8000"]
            NORM["1 · Normalización<br/>unidades de ancho de cabeza"]
            CAL["Calibración de guantes<br/>abierta / puño → grados"]
            SEG{"2 · Segmentación<br/>¿terminó la seña?"}
            CLF["3 · Clasificador Transformer<br/>122 clases (121 señas + NINGUNA)"]
            MODE{"Modo"}
            EVAL["4a · Evaluador<br/>5 parámetros LSM + dedos"]
            SENT["4b · Generador de oraciones"]
        end
    end

    CAM --> MP --> PAY
    GW --> PAY
    MP --> ABC
    PAY -- "WebSocket local /ws" --> NORM
    PAY -.-> CAL
    CAL -.-> EVAL
    NORM --> SEG
    SEG -- "no: sigue acumulando" --> NORM
    SEG -- "sí" --> CLF --> MODE
    MODE -- "Práctica" --> EVAL
    MODE -- "Interpretación" --> SENT

    %% ---------- IA de lenguaje ----------
    SENT --> NETQ{"¿Hay internet?"}
    NETQ -- "sí" --> LLM["OpenAI GPT-4o-mini<br/>gramática LSM → español"]
    NETQ -- "no" --> TPL["Plantillas locales"]

    %% ---------- Salida ----------
    subgraph OUT["④ Retroalimentación al usuario"]
        R1["Puntaje 0–100 · consejos en español<br/>estado de cada dedo"]
        R2["Glosas reconocidas → oración y párrafo<br/>(texto y voz)"]
        R3["Letra reconocida · corrección de forma"]
    end
    EVAL --> R1
    LLM --> R2
    TPL --> R2
    ABC --> R3
```

La misma figura como imagen para diapositivas: [`arquitectura-flujo.svg`](arquitectura-flujo.svg) (vectorial) y [`arquitectura-flujo.png`](arquitectura-flujo.png).

---

## 2. Topología de red (WiFi sin internet)

Los guantes **no dependen de la red del evento**: el ESP32 del guante derecho crea su propia red.

| Elemento | Rol | Dirección |
|---|---|---|
| ESP32 guante **derecho** | **Punto de acceso** (SoftAP, WPA2) · SSID `LSM-Guantes` · servidor WebSocket en el puerto 81 | `192.168.4.1` |
| ESP32 guante **izquierdo** | Estación conectada a `LSM-Guantes` · servidor WebSocket en el puerto 81 | `192.168.4.3` (fija) |
| Laptop | Se conecta a `LSM-Guantes` por WiFi | `192.168.4.x` (DHCP) |
| Navegador ↔ servidor | Comunicación **interna** de la laptop | `127.0.0.1:8000` |

**Internet durante la demo.** Al unirse a `LSM-Guantes` la laptop no tiene salida a internet por WiFi. Opciones:

1. **Sin internet** (válido): todo funciona; las oraciones se redactan con **plantillas locales** (más simples).
2. **Internet por otra vía**: celular por **USB (anclaje de red)** o **cable Ethernet**. Windows usa esa conexión para
   internet y el WiFi solo para los guantes (si hiciera falta, dar menor prioridad —métrica— a la interfaz WiFi).

**Alternativa por cable:** los mismos guantes pueden conectarse por **USB (Web Serial)** con el mismo protocolo; es
el modo más robusto y sirve de plan B si hay interferencia WiFi en el evento.

---

## 3. Capas del sistema

### ① Captura
- **Cámara web**: 960×540; el sistema se adapta a la tasa real de cuadros (probado de 7 a 30 fps).
- **Guantes (×2)**, cada uno con: **ESP32**, **6 IMU MPU-6050** (pulgar, índice, medio, anular, meñique y dorso)
  multiplexadas por I²C con **TCA9548A**, y **sensores Hall SS49E** con imanes de neodimio para detectar contacto
  entre dedos. Frecuencia de envío: ~50 Hz.

### ② Comunicación
| Tramo | Medio | Formato |
|---|---|---|
| Guantes → navegador | WiFi local, WebSocket (puerto 81) — o USB como respaldo | Texto: `ID,<L\|R>,fw,imus,halls` y `D,<L\|R>,seq,t_ms,pitch/roll×6,giroscopio,Hall…,estado` |
| Navegador → servidor | WebSocket local `/ws` | JSON por cuadro: keypoints (1 decimal) + última lectura de cada guante + marca de tiempo |
| Servidor → navegador | WebSocket local `/ws` | JSON: `evaluation`, `sign`, `sentence`, `live` (dedos en vivo), avisos |
| Servidor → OpenAI | HTTPS (solo si hay internet) | Glosas + contexto → oración |

Controles: identificación del guante (`ID?`), detección de lecturas congeladas (sin número de secuencia nuevo),
reconexión automática y descarte de cuadros si la red se satura.

### ③ Procesamiento (laptop)

**Navegador (React 18 + TypeScript + Vite):**
- **MediaPipe Tasks Vision 0.10.14** en GPU: manos (2×21 puntos 3D) cada cuadro, pose corporal cada 2 y malla facial
  (22 puntos de referencia) cada 3.
- **Alfabeto**: clasificador **k-NN** de 27 letras que corre en el navegador, con las poses del cartel oficial SEP y
  detección de movimiento para J, K, Ñ, Q, X, Z.
- Interfaz accesible (contraste AA, objetivos ≥ 44 px, lector de pantalla) con diseño «Liquid Glass».

**Servidor (Python 3.12 + FastAPI + PyTorch en CPU)**, una sesión por conexión:
1. **Normalización** — coordenadas en **unidades de ancho de cabeza** (ancla: nariz y mejillas; respaldo: orejas):
   independiente de la distancia a la cámara y la resolución. Mano 0 = derecha de la persona = guante derecho.
2. **Segmentación** — detecta inicio y fin de cada seña (reposo, quietud o duración máxima); umbrales en segundos,
   ajustados a los fps reales.
3. **Clasificador** — **Transformer** (128 dimensiones, 3 capas, 4 cabezas de atención). Entrada: la seña
   remuestreada a 16 instantes × 150 rasgos (forma local de cada mano, posición de la muñeca, **flexión por dedo**,
   velocidades). Salida: **122 clases** (121 señas + **NINGUNA**, que descarta movimientos que no son seña).
4. **a) Evaluador (Práctica)** — compara contra **referencias** construidas con varias personas señantes en los
   **5 parámetros formacionales de la LSM**: configuración de la mano, ubicación, orientación de la palma,
   movimiento (alineación temporal DTW) y contactos. Las diferencias se miden en **puntuaciones z** respecto a la
   variación natural entre señantes → **calificación 0–100**, **consejos en español** y **estado de cada dedo**.
   Con guantes calibrados, **fusiona** su flexión (más precisa) con la estimada por la cámara.
   **b) Generador de oraciones (Interpretación)** — un modelo de lenguaje (**OpenAI GPT-4o-mini**) recibe la
   secuencia de glosas con reglas gramaticales de la LSM (tiempo al inicio, tema-comentario, sin artículos, verbos
   sin conjugar) y devuelve español natural, manteniendo el contexto del párrafo. **Respaldo**: plantillas locales
   si no hay internet o la respuesta tarda más de 5 s.

### ④ Retroalimentación
- **Práctica**: medidor de porcentaje sobre la cámara, primer consejo visible, detalle por parámetro y diagrama de
  la mano con el estado de cada dedo.
- **Interpretación**: glosas corregibles, oración y párrafo en español, lectura en voz alta.
- **Alfabeto**: letra reconocida y corrección de la forma de la mano.

---

## 4. Modelos y datos

| Modelo | Datos de entrenamiento | Resultado con personas nunca vistas |
|---|---|---|
| Señas (`classifier_v2`) | LSM Glosses (Zenodo, CC BY 4.0): 121 señas, 12 personas (2 expertas). Aumentación que simula webcam de laptop (7.5–15 fps, vista desde abajo, pérdida de manos) y clase NINGUNA a partir de transiciones | **82.6 %** al primer intento · **92.6 %** entre las 3 primeras · ~80 % en condiciones simuladas de webcam |
| Letras | Alfabeto LSM (Zenodo, CC BY 4.0): 27 letras, 20 personas + poses del cartel SEP | **88 %** por letra |
| Referencias de Práctica | Personas de LSM Glosses + MAMÁ (dataset Mendeley MSLwords1) | 122 señas |

Proceso fuera de línea: extracción de keypoints con MediaPipe → normalización y rasgos → entrenamiento en PyTorch con
**validación por persona** (las personas de prueba nunca se ven al entrenar) → construcción de referencias.

---

## 5. Tecnologías

| Capa | Tecnologías |
|---|---|
| Hardware | ESP32 · MPU-6050 · TCA9548A · SS49E · imanes de neodimio · WiFi 2.4 GHz (SoftAP) |
| Firmware | Arduino/ESP-IDF (PlatformIO) · WebSocket en el ESP32 |
| Cliente | React 18 · TypeScript · Vite · MediaPipe Tasks Vision · WebSocket · Web Serial (respaldo) · Vitest |
| Servidor | Python 3.12 · FastAPI · Uvicorn · NumPy · PyTorch · Pytest |
| IA de lenguaje | OpenAI API (GPT-4o-mini) con respaldo por plantillas |

---

## 6. Estado de implementación

| Componente | Estado |
|---|---|
| Visión, normalización, segmentación, clasificador, evaluador, oraciones | ✅ Implementado y probado (≈200 pruebas de servidor, ≈160 de interfaz) |
| Interfaz (Práctica, Interpretación, Alfabeto, Calibración, Grabar, Diagnóstico) | ✅ Implementado |
| Guantes por **USB** (Web Serial, protocolo, calibración, fusión) | ✅ Lado de la app implementado y probado con simulador |
| Guantes por **WiFi** | 🔧 Diseñado (este documento). Falta: lectura por WebSocket en la app (mismo protocolo, solo cambia el transporte) y firmware del ESP32 |
| Firmware del ESP32 | 🔧 Pendiente de definir el cableado final |

---

## 7. Conjuntos de datos y su uso

| Conjunto de datos | Contenido | Uso en el proyecto | Licencia |
|---|---|---|---|
| **Mexican Sign Language Glosses** (Navarrete López et al., 2026) | 121 señas dinámicas (salud, emergencias y expresiones de cortesía), 12 personas (2 expertas), video MP4 | Entrenamiento del **clasificador de señas** y **referencias de Práctica** | CC BY 4.0 |
| **Mexican Sign Language Alphabet — static signs** (Morfín, 2023) | 21 letras estáticas, 20 personas, ~280 mil imágenes | Entrenamiento del **clasificador de letras** (Alfabeto) | CC BY 4.0 |
| **Mexican Sign Language Alphabet — dynamic signs** (Navarrete-López & Lopez-Nava, 2025) | J, K, Ñ, Q, X, Z; 20 personas, video frontal y de perfil | Letras con movimiento del **clasificador de letras** | CC BY 4.0 |
| **Mexican sign language dataset** (Espejel et al., 2023) | 249 palabras en secuencias de imágenes | Solo la referencia de **MAMÁ** en Práctica (el resto se descartó: en esas imágenes MediaPipe casi no detecta la mano activa) | CC BY 4.0 |
| **Google – Isolated Sign Language Recognition** (Chow et al., 2023) | ~94 mil secuencias de 250 señas de ASL, 21 personas sordas, keypoints de MediaPipe | Descargado y convertido para **transferencia de aprendizaje** (preentrenar con ASL y ajustar con LSM): **trabajo futuro**, no forma parte del modelo actual | Reglas de la competencia de Kaggle |
| **Abecedario de la lengua de señas mexicana** (SEP, 2024) | Cartel oficial con la forma de cada letra | Poses de referencia de M, N, Ñ, C y K en Alfabeto y foto de guía en la interfaz | Recurso público de la SEP (se cita la fuente; no se atribuye otra licencia) |

## 8. Referencias (APA 7)

Chow, A., Cameron, G., Georg, M., Sherwood, M., Culliton, P., Sepah, S., Dane, S., & Starner, T. (2023).
*Google – Isolated Sign Language Recognition* [Conjunto de datos y competencia]. Kaggle.
https://www.kaggle.com/competitions/asl-signs

Espejel, J., Dominguez, L. Y., Cervantes, J., & Cervantes, J. (2023). *Mexican sign language dataset* (Versión 1)
[Conjunto de datos]. Mendeley Data. https://doi.org/10.17632/6rj76z6y3n.1

Lugaresi, C., Tang, J., Nash, H., McClanahan, C., Uboweja, E., Hays, M., Zhang, F., Chang, C.-L., Yong, M. G.,
Lee, J., Chang, W.-T., Hua, W., Georg, M., & Grundmann, M. (2019). *MediaPipe: A framework for building perception
pipelines*. arXiv. https://doi.org/10.48550/arXiv.1906.08172

Morfín, R. (2023). *Mexican Sign Language Alphabet (static signs only)* [Conjunto de datos]. Zenodo.
https://doi.org/10.5281/zenodo.10067509

Navarrete-López, J. A., & Lopez-Nava, I. H. (2025). *Mexican Sign Language Alphabet (dynamic signs only)*
[Conjunto de datos]. Zenodo. https://doi.org/10.5281/zenodo.14689869

Navarrete López, J. A., Sainos-Vizuett, M., & Lopez-Nava, I. H. (2026). *Mexican Sign Language Glosses (Dynamic
Signs)* [Conjunto de datos]. Zenodo. https://doi.org/10.5281/zenodo.18330565

OpenAI. (2024). *GPT-4o mini* [Modelo de lenguaje]. https://platform.openai.com/docs/models

Secretaría de Educación Pública. (2024). *Abecedario de la lengua de señas mexicana* [Cartel]. Nueva Escuela
Mexicana. https://nuevaescuelamexicana.sep.gob.mx/contenido/recurso/34697/

Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, Ł., & Polosukhin, I. (2017).
Attention is all you need. En *Advances in Neural Information Processing Systems 30* (pp. 5998–6008).

Zhang, F., Bazarevsky, V., Vakunov, A., Tkachenka, A., Sung, G., Chang, C.-L., & Grundmann, M. (2020).
*MediaPipe Hands: On-device real-time hand tracking*. arXiv. https://doi.org/10.48550/arXiv.2006.10214
