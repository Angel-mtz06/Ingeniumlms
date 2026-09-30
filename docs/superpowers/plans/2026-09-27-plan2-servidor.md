# Plan 2: Servidor (tiempo real, evaluador, guantes y oraciones) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servidor FastAPI que recibe por WebSocket los landmarks de la cámara y las lecturas de los guantes, segmenta señas, las clasifica, evalúa la ejecución contra referencias del dataset con retroalimentación en español y convierte secuencias de glosas en oraciones.

**Architecture:** Todo el comportamiento vive en clases puras y probables sin red (`LiveNormalizer`, `Segmenter`, `GloveCalibration`, `evaluate`, `SentenceBuilder`, `Session`). `lsm/app.py` solo traduce WebSocket/REST ↔ `Session.handle(msg) -> list[msg]`. Reutiliza `normalize`, `features` y `Classifier` del Plan 1 sin duplicar lógica.

**Tech Stack:** Python 3.12 (venv de `D:\Ingenium`), FastAPI 0.115, uvicorn 0.30, openai 1.51, anthropic 0.36, httpx 0.27 (TestClient), numpy 1.26.4, pytest.

**Spec:** `D:\Ingenium\docs\superpowers\specs\2026-09-27-lsm-ingenium-design.md` (secciones 3, 4.5, 5, 6, 7.4, 9, 10)

## Global Constraints

- Todo en `D:\Ingenium`; cargar `source D:/Ingenium/tools/env.sh` antes de cualquier comando; nunca escribir en `C:`.
- Reutilizar sin copiar: `lsm.normalize`, `lsm.features` (`finger_flexion`, `active_span`, `resample`, `REST_Y`, `T_OUT`), `lsm.anchor.frame_anchor`, `lsm.classifier.infer.Classifier` (Plan 1).
- Slot 0 = lado izquierdo de la imagen = **mano derecha del signante = guante `R`**; slot 1 = guante `L`.
- Unidades espaciales: anchos de cabeza (salida de `normalize`). Ángulos en grados.
- Coordenadas que manda el navegador: **píxeles** del video sin espejo (`x·W, y·H, z·W`), `face` = los 22 puntos `FACE_IDX` en ese orden.
- Protocolo del guante (spec §7.4): `D,<L|R>,<seq>,<t_ms>,p0,r0,…,p5,r5,gx,gy,gz,h0…hN,<status>`; IMU 0 = dorso, 1 = pulgar, 2 = índice, 3 = medio, 4 = anular, 5 = meñique; bit `i` de `status` = IMU `i` responde.
- Retroalimentación en español, por plantillas, máximo 2 correcciones por seña.
- La API key del LLM solo existe en el servidor (variables `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`); nunca se envía al cliente.
- Sin plugins de pytest nuevos: las pruebas asíncronas usan `asyncio.run`.
- Cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Contrato WebSocket (`/ws`, JSON) — lo consume el Plan 3

**Cliente → servidor**

| `type` | Campos | Efecto |
|---|---|---|
| `hello` | `mode: "practice"\|"translate"`, `target: str\|null` | Reinicia la sesión en ese modo |
| `frame` | `w`, `h`, `hands: [[[x,y,z]×21], …≤2]`, `pose: [[x,y,z,v]×33]\|null`, `face: [[x,y,z]×22]\|null`, `gloves: {"L": str\|null, "R": str\|null}` (última línea cruda de cada guante), `t?: number` (opcional, ms monótonos; ver nota) | Procesa un cuadro |
| `calibrate` | `step: "open"\|"fist"\|"done"` | Calibración de guantes |
| `confirm_gloss` | `index: int`, `gloss: str` | Corrige una etiqueta pendiente |
| `remove_gloss` | `index: int` | Borra una etiqueta pendiente |
| `build_sentence` | — | Fuerza la oración con las etiquetas pendientes |
| `reset` | — | Limpia buffers y párrafo |

Nota (aditiva, 2026-09-28): `frame.t` es la marca de tiempo en ms del cuadro (la misma, monótona, que se pasa
a MediaPipe). El servidor estima los FPS con la media móvil de los dt de los últimos 30 cuadros (acotada a
5–60 fps; huecos > 1 s, repetidos y valores no numéricos se ignoran) y escala los umbrales del segmentador,
que están calibrados a 30 fps (`rate = fps/30`: cuadros × rate, velocidades por cuadro ÷ rate). Sin `t`
se asume 30 fps y todo se comporta como antes. Un `t` inválido no es error: se ignora.
La racha de reposo exige el mismo lapso que 6 cuadros a 30 fps (a 15 fps, 4 cuadros). La altura de reposo
del segmentador en vivo se puede ajustar con la variable de entorno `LSM_REST_Y` (por defecto 3.5 = `REST_Y`;
no afecta a los rasgos del modelo). Registro de diagnóstico en `logs/lsm.log` (ver `docs/demo/checklist.md`).

**Servidor → cliente**

| `type` | Campos |
|---|---|
| `ready` | `mode`, `target`, `has_reference: bool` |
| `live` | `fingers: [[s×5],[s×5]]` (−1 sin uso, 0 bien, 1 regular, 2 mal), `hands: [bool,bool]`, `segment: "idle"\|"active"` |
| `evaluation` | `target`, `recognized: [[gloss,p]…]`, `scores: {configuracion, ubicacion, movimiento, orientacion}`, `total`, `tips: [str]`, `fingers`, `evaluable: bool` — `false` si una mano que la seña requiere no se vio (el puntaje no es comparable; mostrar el consejo) o si no hay referencia; sin referencia llegan `scores: {}`, `total: 0`, `fingers: []` |
| `sign` | `index`, `gloss`, `top3: [[gloss,p]…]`, `confident: bool` |
| `pending` | `glosses: [str]` (también responde a `build_sentence` sin glosas pendientes, con `glosses: []`) |
| `sentence` | `glosses`, `text`, `paragraph`, `source: "llm"\|"template"` |
| `calibration` | `step`, `status` o `sides: {"L": bool, "R": bool}` |
| `warning` | `code`, `message` |
| `error` | `message` |
| `pausing` | `remaining: number\|null` (s, 1 decimal), `total: number` (s) — ver nota de pausa |

Nota (aditiva, 2026-09-28, pausa de oración): en Traducción la oración se forma tras `LSM_PAUSE_S` segundos
(por defecto **3.5**, rango 1.5–10; antes 45 cuadros ≈ 1.5 s) con las manos en reposo, medidos desde que la mano
bajó, si hubo al menos una seña desde la última oración. Mientras hay glosas pendientes y las manos están en
reposo, el servidor emite `pausing` cada ~0.5 s con los segundos que faltan (`remaining`) y la pausa total
(`total`). Si la persona sube las manos antes de terminar, emite `{"type":"pausing","remaining":null}` (sin
`total`) para cancelar el aviso. Cuando llega `sentence` no se emite cancelación: la oración reemplaza al aviso.

## Estructura de archivos

```
D:\Ingenium\server\lsm\
├── normalize.py          # MODIFICAR: extraer to_head_units() y assign_slots()
├── live.py               # frame_to_raw, frames_to_raw, LiveNormalizer
├── segmenter.py          # Segmenter + SegEvent
├── glove/
│   ├── __init__.py
│   ├── protocol.py       # parse_line → GloveReading | GloveId
│   ├── simulator.py      # simulate_line, wave_flex
│   └── calibration.py    # raw_flexion, GloveCalibration, Calibrator
├── evaluator/
│   ├── __init__.py
│   ├── references.py     # sample_stats, build_reference, GlossRef, save/load
│   ├── scoring.py        # evaluate, finger_status, dtw, Evaluation, Issue
│   └── feedback.py       # messages()
├── sentences.py          # template_sentence, SentenceBuilder
├── session.py            # Session: orquesta todo, sin red
├── vocab.py              # MODIFICAR: lookup acepta dataset "own"
└── app.py                # FastAPI: /ws, /api/*, estáticos, main()
D:\Ingenium\training\
├── build_references.py   # manifest → models/references.json
└── replay.py             # reproduce un .npz en Session (regresión sin cámara)
```

---

### Task 1: Dependencias del servidor y helpers de normalización reutilizables

**Files:**
- Modify: `D:\Ingenium\pyproject.toml`
- Modify: `D:\Ingenium\server\lsm\normalize.py`
- Test: `D:\Ingenium\server\tests\test_normalize.py` (agregar pruebas)

**Interfaces:**
- Consumes: `normalize(raw, anchor=None)` con el parámetro `anchor` agregado en la Task 11b del Plan 1 (debe conservarse).
- Produces: `to_head_units(h: (21,3), cx, cy, s) -> (21,3) float32`; `assign_slots(dets: list[(21,3)], last_wrist: list[np.ndarray|None]) -> list[int]` (orden de dets de entrada = orden de slots devueltos; ya ordena por x cuando hay 2). `normalize()` conserva su comportamiento y sus pruebas.

- [ ] **Step 1: Agregar el extra `server` en `pyproject.toml`** (pedir permiso al usuario: descarga desde PyPI de fastapi, uvicorn, openai, anthropic, httpx y dependencias, ~40 MB)

```toml
server = [
  "fastapi==0.115.0",
  "uvicorn[standard]==0.30.6",
  "openai==1.51.0",
  "anthropic==0.36.0",
  "httpx==0.27.2",
]
```
(dentro de `[project.optional-dependencies]`)

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && uv pip install --python D:/Ingenium/.venv/Scripts/python.exe -e ".[train,dev,server]" && python -c "import fastapi, uvicorn, openai, anthropic, httpx; print('ok')"`
Expected: `ok`

- [ ] **Step 2: Agregar pruebas de los helpers**

Agregar al final de `server/tests/test_normalize.py`:
```python
from lsm.normalize import assign_slots, to_head_units


def test_to_head_units():
    h = make_hand(wrist=(350, 160), size=30)
    u = to_head_units(h, 320, 100, 30)
    np.testing.assert_allclose(u[0, :2], [1.0, 2.0], atol=1e-5)
    assert u.dtype == np.float32


def test_assign_slots_two_hands_sorted_and_single_by_side():
    a, b = make_hand(wrist=(-1, 2)), make_hand(wrist=(1, 2))
    assert assign_slots([b, a], [None, None]) == [1, 0]
    assert assign_slots([make_hand(wrist=(0.5, 2))], [None, None]) == [1]
    assert assign_slots([make_hand(wrist=(0.2, 2))], [np.array([-0.1, 2, 0]), None]) == [0]
```

- [ ] **Step 3: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_normalize.py -v`
Expected: FAIL con `ImportError: cannot import name 'assign_slots'`

- [ ] **Step 4: Refactorizar `normalize.py`**

Reemplazar la función `normalize` por estas tres funciones (el resto del archivo no cambia):
```python
def to_head_units(h: np.ndarray, cx: float, cy: float, s: float) -> np.ndarray:
    n = h.astype(np.float32).copy()
    n[:, 0] = (n[:, 0] - cx) / s
    n[:, 1] = (n[:, 1] - cy) / s
    n[:, 2] = n[:, 2] / s
    return n


def assign_slots(dets: list[np.ndarray], last_wrist: list[np.ndarray | None]) -> list[int]:
    """Slot de cada detección, en el mismo orden que `dets`."""
    if len(dets) >= 2:
        order = sorted(range(2), key=lambda i: dets[i][0, 0])
        slots = [0, 0]
        slots[order[0]], slots[order[1]] = 0, 1
        return slots
    if len(dets) == 1:
        w = dets[0][0, :2]
        known = [(k, np.linalg.norm(w - last_wrist[k][:2])) for k in (0, 1) if last_wrist[k] is not None]
        return [min(known, key=lambda kv: kv[1])[0]] if known else [0 if w[0] < 0 else 1]
    return []


def normalize(raw: RawSequence, anchor: np.ndarray | None = None) -> NormSequence:
    anchor = head_anchor(raw) if anchor is None else np.tile(np.asarray(anchor, np.float32).reshape(1, 3), (raw.T, 1))
    T = raw.T
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    last_wrist: list[np.ndarray | None] = [None, None]
    for t in range(T):
        cx, cy, s = anchor[t]
        dets = [to_head_units(h, cx, cy, s) for h in raw.hands[t] if not np.isnan(h[0, 0])][:2]
        for d, k in zip(dets, assign_slots(dets, last_wrist)):
            hands[t, k] = d
            present[t, k] = True
            last_wrist[k] = d[0]
    return NormSequence(hands=hands, present=present, sample_id=raw.sample_id, signer=raw.signer)
```

- [ ] **Step 5: Correr todas las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest -q`
Expected: todas PASS (las 5 de normalize del Plan 1 + las 2 nuevas).

- [ ] **Step 6: Commit**

```bash
cd D:/Ingenium && git add pyproject.toml server/lsm/normalize.py server/tests/test_normalize.py
git commit -m "refactor(lsm): helpers to_head_units/assign_slots y extra server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Normalización en vivo (`live.py`)

**Files:**
- Create: `D:\Ingenium\server\lsm\live.py`
- Test: `D:\Ingenium\server\tests\test_live.py`

**Interfaces:**
- Consumes: `RawSequence`, `N_FACE` (Plan 1), `frame_anchor` (Plan 1), `to_head_units`, `assign_slots` (Task 1).
- Produces:
  - `frame_to_raw(frame: dict) -> RawSequence` (T=1) y `frames_to_raw(frames: list[dict], **meta) -> RawSequence` (T=len).
  - `LiveNormalizer(window=30)`; `push(raw1: RawSequence) -> tuple[hands (2,21,3) float32, present (2,) bool]`. Usa la mediana de las últimas `window` referencias de cabeza válidas; sin ninguna referencia todavía devuelve todo ausente.

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_live.py
import numpy as np

from lsm.live import LiveNormalizer, frame_to_raw, frames_to_raw
from tests.conftest import make_hand


def frame(hands_px, head=(320.0, 100.0), head_w=30.0, with_pose=True):
    pose = None
    if with_pose:
        pose = [[0.0, 0.0, 0.0, 0.0] for _ in range(33)]
        pose[0] = [head[0], head[1], 0.0, 0.99]
        pose[7] = [head[0] + head_w / 2, head[1], 0.0, 0.99]
        pose[8] = [head[0] - head_w / 2, head[1], 0.0, 0.99]
    return {"w": 640, "h": 480, "hands": [h.tolist() for h in hands_px], "pose": pose, "face": None, "gloves": {}}


def test_frame_to_raw_fills_arrays():
    r = frame_to_raw(frame([make_hand((300, 200), 30)]))
    assert r.T == 1 and r.width == 640
    assert not np.isnan(r.hands[0, 0, 0, 0]) and np.isnan(r.hands[0, 1, 0, 0])
    assert r.pose[0, 0, 3] > 0.9


def test_frames_to_raw_stacks_and_keeps_meta():
    r = frames_to_raw([frame([]), frame([make_hand((300, 200), 30)])], sample_id="x", dataset="own", source_label="HOLA", signer="a")
    assert r.T == 2 and r.sample_id == "x" and np.isnan(r.hands[0]).all()


def test_live_normalizer_units_and_median_anchor():
    ln = LiveNormalizer(window=5)
    h, p = ln.push(frame_to_raw(frame([make_hand((260, 190), 30)])))
    assert p.tolist() == [True, False]
    np.testing.assert_allclose(h[0, 0, :2], [-2.0, 3.0], atol=1e-4)
    # cuadro sin pose: usa la mediana previa
    h2, p2 = ln.push(frame_to_raw(frame([make_hand((260, 190), 30)], with_pose=False)))
    np.testing.assert_allclose(h2[0, 0, :2], [-2.0, 3.0], atol=1e-4)


def test_live_normalizer_without_any_anchor_returns_absent():
    ln = LiveNormalizer()
    h, p = ln.push(frame_to_raw(frame([make_hand((260, 190), 30)], with_pose=False)))
    assert not p.any() and (h == 0).all()
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_live.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.live'`

- [ ] **Step 3: Implementar `live.py`**

```python
# D:/Ingenium/server/lsm/live.py
"""Cuadros que llegan del navegador → RawSequence y normalización incremental."""
from __future__ import annotations

from collections import deque

import numpy as np

from lsm.anchor import frame_anchor
from lsm.normalize import assign_slots, to_head_units
from lsm.schema import N_FACE, RawSequence


def _fill(raw: RawSequence, t: int, frame: dict) -> None:
    for k, h in enumerate((frame.get("hands") or [])[:2]):
        raw.hands[t, k] = np.asarray(h, np.float32).reshape(21, 3)
    if frame.get("pose"):
        raw.pose[t] = np.asarray(frame["pose"], np.float32).reshape(33, 4)
    if frame.get("face"):
        raw.face[t] = np.asarray(frame["face"], np.float32).reshape(N_FACE, 3)


def frame_to_raw(frame: dict) -> RawSequence:
    raw = RawSequence.empty(1, int(frame["w"]), int(frame["h"]), fps=30.0)
    _fill(raw, 0, frame)
    return raw


def frames_to_raw(frames: list[dict], **meta) -> RawSequence:
    raw = RawSequence.empty(len(frames), int(frames[0]["w"]), int(frames[0]["h"]), fps=30.0, **meta)
    for t, f in enumerate(frames):
        _fill(raw, t, f)
    return raw


class LiveNormalizer:
    def __init__(self, window: int = 30):
        self.anchors: deque = deque(maxlen=window)
        self.last_wrist: list[np.ndarray | None] = [None, None]

    def push(self, raw1: RawSequence) -> tuple[np.ndarray, np.ndarray]:
        hands = np.zeros((2, 21, 3), np.float32)
        present = np.zeros(2, bool)
        a = frame_anchor(raw1, 0)
        if a is not None:
            self.anchors.append(a)
        if not self.anchors:
            return hands, present
        cx, cy, s = np.median(np.array(self.anchors), axis=0)
        dets = [to_head_units(h, cx, cy, s) for h in raw1.hands[0] if not np.isnan(h[0, 0])][:2]
        for d, k in zip(dets, assign_slots(dets, self.last_wrist)):
            hands[k] = d
            present[k] = True
            self.last_wrist[k] = d[0]
        return hands, present
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_live.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/live.py server/tests/test_live.py
git commit -m "feat(lsm): cuadros en vivo a RawSequence y normalización incremental

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Segmentador (`segmenter.py`)

**Files:**
- Create: `D:\Ingenium\server\lsm\segmenter.py`
- Test: `D:\Ingenium\server\tests\test_segmenter.py`

**Interfaces:**
- Consumes: `REST_Y` (Plan 1 `features`).
- Produces: `SegEvent(kind: "end"|"pause", start: int = -1, end: int = -1)`; `Segmenter(rest_y=REST_Y, still_speed=0.04, rest_frames=6, still_frames=12, pause_frames=45, min_len=6, max_len=75)`; `update(idx: int, hands (2,21,3), present (2,)) -> list[SegEvent]`; atributo `state: "idle"|"active"`.
- Reglas: inicia cuando hay una mano por encima de `rest_y` (si el segmento anterior terminó por quietud, exige además velocidad ≥ 2·`still_speed`). Termina por: `rest_frames` cuadros en reposo (fin = último cuadro activo), `still_frames` cuadros quietos con longitud ≥ `min_len + still_frames` (fin = cuadro actual), o `max_len`. Descarta segmentos más cortos que `min_len`. `pause` se emite una vez al acumular `pause_frames` cuadros en reposo si hubo algún segmento desde la pausa anterior.

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_segmenter.py
import numpy as np

from lsm.segmenter import Segmenter
from tests.conftest import make_hand

REST = make_hand(wrist=(0.0, 5.0))


def up(x):
    return make_hand(wrist=(x, 1.0))


def feed(seg, frames, start=0):
    events = []
    for i, h in enumerate(frames):
        hands = np.zeros((2, 21, 3), np.float32)
        present = np.zeros(2, bool)
        if h is not None:
            hands[0], present[0] = h, True
        events += seg.update(start + i, hands, present)
    return events


def test_rest_move_rest_gives_one_segment_then_pause():
    seg = Segmenter()
    frames = [REST] * 5 + [up(0.1 * i) for i in range(20)] + [REST] * 60
    ev = feed(seg, frames)
    ends = [e for e in ev if e.kind == "end"]
    assert len(ends) == 1 and (ends[0].start, ends[0].end) == (5, 24)
    assert [e.kind for e in ev].count("pause") == 1


def test_short_blip_is_discarded():
    ev = feed(Segmenter(), [REST] * 3 + [up(0.0)] * 3 + [REST] * 10)
    assert not [e for e in ev if e.kind == "end"]


def test_stillness_ends_segment_and_needs_motion_to_restart():
    moving = [up(0.2 * i) for i in range(10)]
    still = [up(2.0)] * 30
    again = [up(2.0 + 0.2 * i) for i in range(10)]
    ev = feed(Segmenter(), moving + still + again + [REST] * 10)
    ends = [e for e in ev if e.kind == "end"]
    assert len(ends) == 2
    assert ends[0].start == 0 and ends[1].start >= 40


def test_max_len_forces_cut():
    ev = feed(Segmenter(max_len=30), [up(0.1 * i) for i in range(70)])
    assert len([e for e in ev if e.kind == "end"]) >= 2


def test_absent_hands_count_as_rest():
    ev = feed(Segmenter(), [up(0.1 * i) for i in range(10)] + [None] * 10)
    assert [e.kind for e in ev] == ["end"]
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_segmenter.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.segmenter'`

- [ ] **Step 3: Implementar `segmenter.py`**

```python
# D:/Ingenium/server/lsm/segmenter.py
"""Detecta inicio/fin de señas y pausas de oración en el flujo en vivo."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lsm.features import REST_Y


@dataclass
class SegEvent:
    kind: str  # "end" | "pause"
    start: int = -1
    end: int = -1


class Segmenter:
    def __init__(self, rest_y: float = REST_Y, still_speed: float = 0.04, rest_frames: int = 6,
                 still_frames: int = 12, pause_frames: int = 45, min_len: int = 6, max_len: int = 75):
        self.rest_y, self.still_speed = rest_y, still_speed
        self.rest_frames, self.still_frames, self.pause_frames = rest_frames, still_frames, pause_frames
        self.min_len, self.max_len = min_len, max_len
        self.state = "idle"
        self.start = self.last_active = -1
        self.rest_count = self.still_count = self.idle_count = 0
        self.pending = 0
        self.need_motion = False
        self.prev_w: np.ndarray | None = None
        self.prev_p: np.ndarray | None = None

    def _speed(self, hands: np.ndarray, present: np.ndarray) -> float:
        w = hands[:, 0, :2]
        sp = 0.0
        if self.prev_w is not None:
            for s in (0, 1):
                if present[s] and self.prev_p[s]:
                    sp = max(sp, float(np.linalg.norm(w[s] - self.prev_w[s])))
        self.prev_w, self.prev_p = w.copy(), present.copy()
        return sp

    def _close(self, end: int, by_stillness: bool) -> list[SegEvent]:
        start = self.start
        self.state = "idle"
        self.idle_count = 0
        self.need_motion = by_stillness
        if end - start + 1 < self.min_len:
            return []
        self.pending += 1
        return [SegEvent("end", start, end)]

    def update(self, idx: int, hands: np.ndarray, present: np.ndarray) -> list[SegEvent]:
        active = bool((present & (hands[:, 0, 1] < self.rest_y)).any())
        speed = self._speed(hands, present)
        if self.state == "idle":
            if active and (not self.need_motion or speed >= 2 * self.still_speed):
                self.state, self.start, self.last_active = "active", idx, idx
                self.rest_count = self.still_count = 0
                self.need_motion = False
                return []
            if not active:
                self.need_motion = False
                self.idle_count += 1
                if self.idle_count == self.pause_frames and self.pending:
                    self.pending = 0
                    return [SegEvent("pause")]
            return []
        if active:
            self.last_active = idx
            self.rest_count = 0
            self.still_count = self.still_count + 1 if speed < self.still_speed else 0
        else:
            self.rest_count += 1
        length = idx - self.start + 1
        if self.rest_count >= self.rest_frames:
            return self._close(self.last_active, by_stillness=False)
        if self.still_count >= self.still_frames and length >= self.min_len + self.still_frames:
            return self._close(idx, by_stillness=True)
        if length >= self.max_len:
            return self._close(idx, by_stillness=False)
        return []
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_segmenter.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/segmenter.py server/tests/test_segmenter.py
git commit -m "feat(lsm): segmentador de señas y pausas en vivo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Protocolo y simulador del guante

**Files:**
- Create: `D:\Ingenium\server\lsm\glove\__init__.py` (vacío)
- Create: `D:\Ingenium\server\lsm\glove\protocol.py`
- Create: `D:\Ingenium\server\lsm\glove\simulator.py`
- Test: `D:\Ingenium\server\tests\test_glove_protocol.py`

**Interfaces:**
- Produces:
  - `GloveReading(side, seq, t_ms, pitch (6,), roll (6,), gyro (3,), hall (n,), status: int)` con `imu_ok(i) -> bool`.
  - `GloveId(side, fw, imus, halls)`.
  - `parse_line(line: str) -> GloveReading | GloveId | None` (None para basura o líneas incompletas; nunca lanza excepción).
  - `simulate_line(side, seq, t_ms, flex=(0,)*5, contact=(False,)*4, halls=8, status=0b111111) -> str` (pitch del dorso 0, pitch de cada dedo = flex; Hall base 2048, +600 si hay contacto en los primeros 4).
  - `wave_flex(t_ms) -> tuple[float, ...]` (5 dedos entre 5° y 85°, desfasados).

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_glove_protocol.py
import numpy as np

from lsm.glove.protocol import GloveId, GloveReading, parse_line
from lsm.glove.simulator import simulate_line, wave_flex


def test_parse_id():
    r = parse_line("ID,R,fw=1.0,imus=6,halls=8\n")
    assert isinstance(r, GloveId) and (r.side, r.fw, r.imus, r.halls) == ("R", "1.0", 6, 8)


def test_simulated_line_roundtrip():
    line = simulate_line("L", 7, 1234, flex=(10, 20, 30, 40, 50), contact=(False, True, False, False))
    r = parse_line(line)
    assert isinstance(r, GloveReading)
    assert (r.side, r.seq, r.t_ms) == ("L", 7, 1234)
    np.testing.assert_allclose(r.pitch, [0, 10, 20, 30, 40, 50])
    assert r.hall.shape == (8,) and r.hall[1] > r.hall[0]
    assert all(r.imu_ok(i) for i in range(6))


def test_status_bits():
    r = parse_line(simulate_line("R", 1, 1, status=0b111101))
    assert r.imu_ok(0) and not r.imu_ok(1)


def test_garbage_and_truncated_lines_are_none():
    assert parse_line("") is None
    assert parse_line("hola mundo") is None
    assert parse_line("D,R,1,2,3") is None
    assert parse_line("D,R,x,2" + ",0" * 20) is None


def test_zero_halls_is_valid():
    r = parse_line(simulate_line("R", 1, 1, halls=0))
    assert isinstance(r, GloveReading) and r.hall.shape == (0,)


def test_wave_flex_range():
    for t in range(0, 4000, 250):
        f = wave_flex(t)
        assert len(f) == 5 and all(5 <= v <= 85 for v in f)
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_glove_protocol.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.glove'`

- [ ] **Step 3: Implementar**

```python
# D:/Ingenium/server/lsm/glove/protocol.py
"""Líneas de texto del guante (spec §7.4)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

N_IMU = 6
BASE_FIELDS = 20  # D, lado, seq, t, 12 (pitch/roll), 3 gyro, status


@dataclass
class GloveReading:
    side: str
    seq: int
    t_ms: int
    pitch: np.ndarray
    roll: np.ndarray
    gyro: np.ndarray
    hall: np.ndarray
    status: int

    def imu_ok(self, i: int) -> bool:
        return bool((self.status >> i) & 1)


@dataclass
class GloveId:
    side: str
    fw: str
    imus: int
    halls: int


def parse_line(line: str) -> GloveReading | GloveId | None:
    parts = line.strip().split(",")
    try:
        if parts[0] == "ID" and len(parts) >= 2:
            kv = dict(p.split("=", 1) for p in parts[2:] if "=" in p)
            return GloveId(parts[1], kv.get("fw", ""), int(kv.get("imus", N_IMU)), int(kv.get("halls", 0)))
        if parts[0] == "D" and len(parts) >= BASE_FIELDS and parts[1] in ("L", "R"):
            seq, t_ms = int(parts[2]), int(parts[3])
            pr = np.array([float(x) for x in parts[4:16]], np.float32).reshape(N_IMU, 2)
            gyro = np.array([float(x) for x in parts[16:19]], np.float32)
            hall = np.array([float(x) for x in parts[19:-1]], np.float32)
            return GloveReading(parts[1], seq, t_ms, pr[:, 0].copy(), pr[:, 1].copy(), gyro, hall, int(parts[-1]))
    except ValueError:
        return None
    return None
```

```python
# D:/Ingenium/server/lsm/glove/simulator.py
"""Guante simulado para desarrollar y probar sin hardware."""
from __future__ import annotations

import math

HALL_BASE = 2048
HALL_CONTACT = 600


def simulate_line(side: str, seq: int, t_ms: int, flex=(0, 0, 0, 0, 0), contact=(False,) * 4,
                  halls: int = 8, status: int = 0b111111) -> str:
    pitch = [0.0, *[float(f) for f in flex]]
    pr = [f"{p:.1f},0.0" for p in pitch]
    hall = [HALL_BASE + (HALL_CONTACT if i < 4 and contact[i] else 0) for i in range(halls)]
    fields = ["D", side, str(seq), str(t_ms), *pr, "0.0,0.0,0.0", *[str(h) for h in hall], str(status)]
    return ",".join(fields)


def wave_flex(t_ms: int) -> tuple[float, ...]:
    return tuple(45.0 + 40.0 * math.sin(2 * math.pi * (t_ms / 2000.0 + f / 5.0)) for f in range(5))
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_glove_protocol.py -v`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/glove server/tests/test_glove_protocol.py
git commit -m "feat(glove): parser del protocolo serie y guante simulado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Calibración del guante

**Files:**
- Create: `D:\Ingenium\server\lsm\glove\calibration.py`
- Test: `D:\Ingenium\server\tests\test_glove_calibration.py`

**Interfaces:**
- Consumes: `GloveReading` (Task 4).
- Produces:
  - `raw_flexion(r) -> (5,)`: `pitch[1..5] − pitch[0]` envuelto a [−180, 180]; NaN si el dedo o el dorso no responde.
  - `GloveCalibration(raw_open, raw_fist, cam_open, cam_fist, hall_open_mean, hall_open_std)` con `flexion(r) -> (5,)` en **grados de cámara** (NaN si falta) y `contacts(r) -> (4,)` en {0.0, 1.0} o NaN.
  - `Calibrator(min_samples=10)` con atributo `step`, `add(side, reading, cam_flex: (5,) | None)` y `finish() -> dict[str, GloveCalibration | None]` (llaves `"L"`, `"R"`).
  - Constantes `DEFAULT_CAM_OPEN = 10.0`, `DEFAULT_CAM_FIST = 150.0`, `HALL_MIN_DELTA = 150.0`.

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_glove_calibration.py
import numpy as np

from lsm.glove.calibration import Calibrator, raw_flexion
from lsm.glove.protocol import parse_line
from lsm.glove.simulator import simulate_line


def reading(side="R", flex=(0,) * 5, contact=(False,) * 4, status=0b111111):
    return parse_line(simulate_line(side, 1, 1, flex=flex, contact=contact, status=status))


def test_raw_flexion_wraps_and_masks():
    r = reading(flex=(10, 20, 30, 190, 40), status=0b111011)
    f = raw_flexion(r)
    assert f[0] == 10 and f[2] == 30 and np.isnan(f[1])  # IMU 2 (índice) caído
    assert f[3] == -170


def test_calibration_maps_glove_to_camera_degrees():
    cal = Calibrator()
    cal.step = "open"
    for _ in range(12):
        cal.add("R", reading(flex=(5,) * 5), np.full(5, 12.0))
    cal.step = "fist"
    for _ in range(12):
        cal.add("R", reading(flex=(85,) * 5), np.full(5, 152.0))
    out = cal.finish()
    assert out["L"] is None
    c = out["R"]
    np.testing.assert_allclose(c.flexion(reading(flex=(45,) * 5)), 82.0, atol=1e-3)


def test_calibration_without_camera_uses_defaults():
    cal = Calibrator()
    cal.step = "open"
    for _ in range(10):
        cal.add("L", reading("L", flex=(0,) * 5), None)
    cal.step = "fist"
    for _ in range(10):
        cal.add("L", reading("L", flex=(90,) * 5), None)
    c = cal.finish()["L"]
    np.testing.assert_allclose(c.flexion(reading("L", flex=(90,) * 5)), 150.0, atol=1e-3)


def test_too_few_samples_gives_none():
    cal = Calibrator()
    cal.step = "open"
    cal.add("R", reading(), None)
    assert cal.finish()["R"] is None


def test_contacts_from_hall_baseline():
    cal = Calibrator()
    cal.step = "open"
    for _ in range(10):
        cal.add("R", reading(), None)
    cal.step = "fist"
    for _ in range(10):
        cal.add("R", reading(flex=(90,) * 5), None)
    c = cal.finish()["R"]
    assert c.contacts(reading(contact=(False, True, False, False))).tolist() == [0.0, 1.0, 0.0, 0.0]
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_glove_calibration.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.glove.calibration'`

- [ ] **Step 3: Implementar `calibration.py`**

```python
# D:/Ingenium/server/lsm/glove/calibration.py
"""Calibración por usuario: grados del guante → grados de la cámara (escala del dataset)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lsm.glove.protocol import GloveReading

DEFAULT_CAM_OPEN = 10.0
DEFAULT_CAM_FIST = 150.0
HALL_MIN_DELTA = 150.0
N_CONTACTS = 4


def raw_flexion(r: GloveReading) -> np.ndarray:
    f = (r.pitch[1:6] - r.pitch[0] + 180.0) % 360.0 - 180.0
    f = f.astype(np.float32)
    if not r.imu_ok(0):
        return np.full(5, np.nan, np.float32)
    for i in range(5):
        if not r.imu_ok(i + 1):
            f[i] = np.nan
    return f


@dataclass
class GloveCalibration:
    raw_open: np.ndarray
    raw_fist: np.ndarray
    cam_open: np.ndarray
    cam_fist: np.ndarray
    hall_open_mean: np.ndarray
    hall_open_std: np.ndarray

    def flexion(self, r: GloveReading) -> np.ndarray:
        span = self.raw_fist - self.raw_open
        with np.errstate(divide="ignore", invalid="ignore"):
            out = self.cam_open + (raw_flexion(r) - self.raw_open) * (self.cam_fist - self.cam_open) / span
        out[np.abs(span) < 5.0] = np.nan
        return out.astype(np.float32)

    def contacts(self, r: GloveReading) -> np.ndarray:
        out = np.full(N_CONTACTS, np.nan, np.float32)
        n = min(N_CONTACTS, len(r.hall), len(self.hall_open_mean))
        thr = np.maximum(6.0 * self.hall_open_std[:n], HALL_MIN_DELTA)
        out[:n] = (np.abs(r.hall[:n] - self.hall_open_mean[:n]) > thr).astype(np.float32)
        return out


class Calibrator:
    def __init__(self, min_samples: int = 10):
        self.step: str | None = None
        self.min_samples = min_samples
        self.samples = {s: {"open": [], "fist": []} for s in ("L", "R")}

    def add(self, side: str, reading: GloveReading, cam_flex: np.ndarray | None) -> None:
        if self.step in ("open", "fist") and side in self.samples:
            self.samples[side][self.step].append((reading, cam_flex))

    def _one(self, side: str) -> GloveCalibration | None:
        s = self.samples[side]
        if len(s["open"]) < self.min_samples or len(s["fist"]) < self.min_samples:
            return None

        def med_raw(items):
            return np.nanmedian(np.stack([raw_flexion(r) for r, _ in items]), axis=0)

        def med_cam(items, default):
            cams = [c for _, c in items if c is not None]
            return np.nanmedian(np.stack(cams), axis=0) if cams else np.full(5, default, np.float32)

        halls = np.stack([r.hall for r, _ in s["open"]])
        return GloveCalibration(med_raw(s["open"]), med_raw(s["fist"]),
                                med_cam(s["open"], DEFAULT_CAM_OPEN), med_cam(s["fist"], DEFAULT_CAM_FIST),
                                halls.mean(axis=0), halls.std(axis=0))

    def finish(self) -> dict[str, GloveCalibration | None]:
        return {side: self._one(side) for side in ("L", "R")}
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_glove_calibration.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/glove/calibration.py server/tests/test_glove_calibration.py
git commit -m "feat(glove): calibración guante→cámara y contactos por Hall

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Referencias por glosa

**Files:**
- Create: `D:\Ingenium\server\lsm\evaluator\__init__.py` (vacío)
- Create: `D:\Ingenium\server\lsm\evaluator\references.py`
- Create: `D:\Ingenium\training\build_references.py`
- Test: `D:\Ingenium\server\tests\test_references.py`

**Interfaces:**
- Consumes: `NormSequence` (Plan 1), `active_span`, `resample`, `finger_flexion`, `T_OUT` (Plan 1 `features`).
- Produces:
  - `palm_normal(h) -> (3,)` unitario; `thumb_contacts(h) -> (4,)` en {0,1} (punta del pulgar a menos de 0.35 × escala de la mano de las puntas 8/12/16/20).
  - `sample_stats(norm) -> dict` con llaves `present_frac (2,)`, `flex (2,5)`, `loc (2,3)`, `palm (2,3)`, `contacts (2,4)` (NaN en slots ausentes), `dom: int`, `traj (T_OUT,3)`, `path_len: float`. La fase de sostén son los 4 cuadros de menor velocidad de muñeca dentro del 80 % central.
  - `GlossRef` (dataclass) con `gloss`, `slots_used (2,) bool`, `flex_mean/flex_std (2,5)`, `loc_mean/loc_std (2,3)`, `palm_mean (2,3)`, `palm_spread (2,)` grados, `contact_prob (2,4)`, `dom: int`, `traj_mean (T_OUT,3)`, `traj_scale: float`, `path_len: float`, `n_samples: int`, `example_id: str`, `example_hands (T_OUT,2,21,3)`, `example_present (T_OUT,2)`.
  - `dtw(a, b) -> float` (distancia media por paso).
  - `build_reference(gloss, norms, preferred=("g11", "g00")) -> GlossRef`; `save_references(refs: dict, path)`; `load_references(path) -> dict[str, GlossRef]` (JSON sin NaN: se guardan como `null`).

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_references.py
import numpy as np

from lsm.evaluator.references import (build_reference, dtw, load_references, palm_normal, sample_stats,
                                       save_references, thumb_contacts)
from lsm.normalize import NormSequence
from tests.conftest import make_hand


def seq(flex=(0, 90, 90, 90, 90), x0=0.0, signer="m01", T=12):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for t in range(T):
        hands[t, 0] = make_hand(wrist=(x0 + 0.1 * t, 1.0), flex=flex)
        present[t, 0] = True
    return NormSequence(hands, present, f"{signer}_X", signer)


def test_palm_normal_is_unit_and_contacts_shape():
    h = make_hand()
    assert abs(np.linalg.norm(palm_normal(h)) - 1) < 1e-5 or np.linalg.norm(palm_normal(h)) == 0
    assert thumb_contacts(h).shape == (4,)


def test_sample_stats_flex_and_dom():
    st = sample_stats(seq())
    assert st["dom"] == 0 and st["present_frac"][0] == 1.0 and np.isnan(st["flex"][1]).all()
    np.testing.assert_allclose(st["flex"][0], [0, 90, 90, 90, 90], atol=1e-3)
    assert st["traj"].shape == (16, 3) and st["path_len"] > 0


def test_dtw_zero_for_identical_and_positive_for_shift():
    a = np.linspace(0, 1, 16)[:, None] * np.ones((1, 3))
    assert dtw(a, a) == 0 and dtw(a, a + 1) > 0.5


def test_build_reference_prefers_deaf_signer_and_uses_floors():
    norms = [seq(signer="m01"), seq(signer="g11", x0=0.05), seq(signer="g00")]
    ref = build_reference("HOLA", norms)
    assert ref.example_id == "g11_X" and ref.n_samples == 3
    assert ref.slots_used.tolist() == [True, False]
    np.testing.assert_allclose(ref.flex_mean[0], [0, 90, 90, 90, 90], atol=1e-3)
    assert ref.example_hands.shape == (16, 2, 21, 3)


def test_references_json_roundtrip(tmp_path):
    ref = build_reference("HOLA", [seq(), seq(signer="g00")])
    p = tmp_path / "r.json"
    save_references({"HOLA": ref}, p)
    back = load_references(p)["HOLA"]
    np.testing.assert_allclose(back.flex_mean[0], ref.flex_mean[0])
    assert np.isnan(back.flex_mean[1]).all() and back.dom == ref.dom
    assert "NaN" not in p.read_text(encoding="utf-8")
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_references.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.evaluator'`

- [ ] **Step 3: Implementar `references.py`**

```python
# D:/Ingenium/server/lsm/evaluator/references.py
"""Plantilla estadística de cada seña a partir de todas las personas del dataset."""
from __future__ import annotations

import json
import warnings
from dataclasses import asdict, dataclass, fields
from pathlib import Path

import numpy as np

from lsm.features import T_OUT, active_span, finger_flexion, resample
from lsm.normalize import NormSequence

TIPS = (8, 12, 16, 20)
HOLD_K = 4


def palm_normal(h: np.ndarray) -> np.ndarray:
    n = np.cross(h[5] - h[0], h[17] - h[0])
    s = np.linalg.norm(n)
    return (n / s).astype(np.float32) if s > 1e-9 else np.zeros(3, np.float32)


def thumb_contacts(h: np.ndarray) -> np.ndarray:
    scale = max(float(np.linalg.norm(h[9] - h[0])), 1e-6)
    return np.array([np.linalg.norm(h[4] - h[t]) / scale < 0.35 for t in TIPS], np.float32)


def _nanmean(a, axis=0):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(a, axis=axis)


def _nanstd(a, axis=0):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanstd(a, axis=axis)


def _hold_idx(hands: np.ndarray, present: np.ndarray, slot: int) -> np.ndarray:
    T = hands.shape[0]
    w = hands[:, slot, 0]
    speed = np.r_[0.0, np.linalg.norm(np.diff(w, axis=0), axis=1)]
    lo, hi = int(T * 0.1), max(int(T * 0.9), int(T * 0.1) + 1)
    cand = [t for t in range(lo, hi) if present[t, slot]] or [t for t in range(T) if present[t, slot]]
    cand = sorted(cand, key=lambda t: speed[t])
    return np.array(cand[:HOLD_K])


def sample_stats(norm: NormSequence) -> dict:
    hands, present = resample(norm, *active_span(norm), T_OUT)
    frac = present.mean(axis=0)
    st = {"present_frac": frac, "flex": np.full((2, 5), np.nan), "loc": np.full((2, 3), np.nan),
          "palm": np.full((2, 3), np.nan), "contacts": np.full((2, 4), np.nan)}
    for s in (0, 1):
        if frac[s] < 0.5:
            continue
        idx = _hold_idx(hands, present, s)
        st["flex"][s] = np.mean([finger_flexion(hands[t, s]) for t in idx], axis=0)
        st["loc"][s] = hands[idx, s, 0].mean(axis=0)
        p = np.mean([palm_normal(hands[t, s]) for t in idx], axis=0)
        st["palm"][s] = p / max(np.linalg.norm(p), 1e-9)
        st["contacts"][s] = np.mean([thumb_contacts(hands[t, s]) for t in idx], axis=0)
    dom = 0 if frac[0] >= 0.5 else (1 if frac[1] >= 0.5 else 0)
    st["dom"] = dom
    st["traj"] = hands[:, dom, 0].astype(np.float32)
    st["path_len"] = float(np.linalg.norm(np.diff(st["traj"], axis=0), axis=1).sum())
    return st


def dtw(a: np.ndarray, b: np.ndarray) -> float:
    n, m = len(a), len(b)
    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            c = float(np.linalg.norm(a[i - 1] - b[j - 1]))
            D[i, j] = c + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])
    return float(D[n, m] / (n + m))


@dataclass
class GlossRef:
    gloss: str
    slots_used: np.ndarray
    flex_mean: np.ndarray
    flex_std: np.ndarray
    loc_mean: np.ndarray
    loc_std: np.ndarray
    palm_mean: np.ndarray
    palm_spread: np.ndarray
    contact_prob: np.ndarray
    dom: int
    traj_mean: np.ndarray
    traj_scale: float
    path_len: float
    n_samples: int
    example_id: str
    example_hands: np.ndarray
    example_present: np.ndarray


def build_reference(gloss: str, norms: list[NormSequence], preferred: tuple[str, ...] = ("g11", "g00")) -> GlossRef:
    stats = [sample_stats(n) for n in norms]
    stack = lambda k: np.stack([s[k] for s in stats])
    frac = stack("present_frac")
    slots_used = (frac >= 0.5).mean(axis=0) >= 0.5
    palm_mean = np.zeros((2, 3))
    palm_spread = np.full(2, np.nan)
    palms = stack("palm")
    for s in (0, 1):
        m = _nanmean(palms[:, s])
        if not np.isnan(m).any():
            palm_mean[s] = m / max(np.linalg.norm(m), 1e-9)
            ok = ~np.isnan(palms[:, s, 0])
            ang = np.degrees(np.arccos(np.clip(palms[ok, s] @ palm_mean[s], -1, 1)))
            palm_spread[s] = float(ang.std()) if ang.size else np.nan
        else:
            palm_mean[s] = np.nan
    dom = 0 if slots_used[0] else 1
    trajs = [s["traj"] for s in stats if s["dom"] == dom] or [s["traj"] for s in stats]
    traj_mean = np.mean(trajs, axis=0)
    by_signer = {n.signer: n for n in norms}
    ex = next((by_signer[p] for p in preferred if p in by_signer), norms[0])
    ex_h, ex_p = resample(ex, *active_span(ex), T_OUT)
    return GlossRef(
        gloss=gloss, slots_used=slots_used,
        flex_mean=_nanmean(stack("flex")), flex_std=_nanstd(stack("flex")),
        loc_mean=_nanmean(stack("loc")), loc_std=_nanstd(stack("loc")),
        palm_mean=palm_mean, palm_spread=palm_spread, contact_prob=_nanmean(stack("contacts")),
        dom=dom, traj_mean=traj_mean.astype(np.float32),
        traj_scale=float(np.median([dtw(t, traj_mean) for t in trajs])),
        path_len=float(np.mean([s["path_len"] for s in stats])), n_samples=len(norms),
        example_id=ex.sample_id, example_hands=ex_h, example_present=ex_p,
    )


def _to_json(v):
    if isinstance(v, np.ndarray):
        return [_to_json(x) for x in v.tolist()] if v.ndim else _to_json(v.item())
    if isinstance(v, list):
        return [_to_json(x) for x in v]
    if isinstance(v, float) and np.isnan(v):
        return None
    if isinstance(v, (np.bool_, np.integer, np.floating)):
        return _to_json(v.item())
    return v


def save_references(refs: dict[str, GlossRef], path: str | Path) -> None:
    data = {g: {k: _to_json(v) for k, v in asdict(r).items()} for g, r in refs.items()}
    Path(path).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def load_references(path: str | Path) -> dict[str, GlossRef]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    arrays = {f.name for f in fields(GlossRef) if f.type == "np.ndarray"}
    out = {}
    for g, d in raw.items():
        kw = {k: (np.array(v, dtype=float) if k in arrays else v) for k, v in d.items()}
        kw["slots_used"] = kw["slots_used"].astype(bool)
        kw["example_present"] = kw["example_present"].astype(bool)
        out[g] = GlossRef(**kw)
    return out
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_references.py -v`
Expected: 5 PASS

- [ ] **Step 5: Escribir `training/build_references.py`**

```python
# D:/Ingenium/training/build_references.py
"""manifest.csv → models/references.json (todas las personas de cada glosa)."""
import csv
from collections import defaultdict

from lsm.evaluator.references import build_reference, save_references
from lsm.normalize import NormSequence
from lsm.paths import MODELS, PROCESSED


def main():
    groups = defaultdict(list)
    for r in csv.DictReader(open(PROCESSED / "manifest.csv", encoding="utf-8")):
        groups[r["gloss"]].append(NormSequence.load(r["norm_path"]))
    refs = {g: build_reference(g, norms) for g, norms in sorted(groups.items()) if len(norms) >= 3}
    MODELS.mkdir(parents=True, exist_ok=True)
    save_references(refs, MODELS / "references.json")
    print("referencias:", len(refs), "de", len(groups), "glosas")


if __name__ == "__main__":
    main()
```

Run (requiere `manifest.csv` del Plan 1): `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/training && python build_references.py`
Expected: `referencias: ~340 de ~345 glosas`. Si todavía no existe el manifest, anotar "pendiente" en el reporte y seguir: el script se ejecuta en la Task 10.

- [ ] **Step 6: Commit**

```bash
cd D:/Ingenium && git add server/lsm/evaluator server/tests/test_references.py training/build_references.py
git commit -m "feat(evaluator): referencias estadísticas por glosa (sostén, ubicación, trayectoria, palma)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Puntajes y retroalimentación

**Files:**
- Create: `D:\Ingenium\server\lsm\evaluator\scoring.py`
- Create: `D:\Ingenium\server\lsm\evaluator\feedback.py`
- Test: `D:\Ingenium\server\tests\test_scoring.py`

**Interfaces:**
- Consumes: `GlossRef`, `sample_stats`, `dtw` (Task 6).
- Produces:
  - Constantes `FLEX_FLOOR=12.0`, `LOC_FLOOR=0.35`, `MOVE_FLOOR=0.15`, `PALM_FLOOR=20.0`, `ISSUE_Z=1.5`, `PARAMS=("configuracion","ubicacion","movimiento","orientacion")`.
  - `z_to_score(z) -> float` = `100·exp(−z²/2)`.
  - `Issue(param, z, slot, finger: int | None = None, detail: dict = {})`; `Evaluation(scores: dict, total: float, finger_flex (2,5), finger_z (2,5), issues: list[Issue])`.
  - `evaluate(ref, seq, glove_flex: (2,5)|None = None, glove_contacts: (2,4)|None = None) -> Evaluation` (issues ordenados por z descendente).
  - `finger_status(ref, flex (2,5)) -> np.ndarray (2,5) int` (−1 slot sin uso o sin dato, 0 z<1, 1 z<2, 2 resto).
  - `feedback.messages(ev, ref, max_tips=2) -> list[str]`.

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_scoring.py
import numpy as np

from lsm.evaluator.feedback import messages
from lsm.evaluator.references import build_reference
from lsm.evaluator.scoring import evaluate, finger_status, z_to_score
from lsm.normalize import NormSequence
from tests.conftest import make_hand

TARGET = (0, 90, 90, 90, 90)


def seq(flex=TARGET, y=1.0, x0=0.0, T=12, signer="m01", step=0.1):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for t in range(T):
        hands[t, 0] = make_hand(wrist=(x0 + step * t, y), flex=flex)
        present[t, 0] = True
    return NormSequence(hands, present, f"{signer}_X", signer)


REF = build_reference("X", [seq(signer="a"), seq(signer="b", x0=0.02), seq(signer="c", x0=-0.02)])


def test_z_to_score():
    assert z_to_score(0) == 100 and 60 < z_to_score(1) < 61


def test_perfect_execution_scores_high_without_tips():
    ev = evaluate(REF, seq())
    assert ev.total > 90 and all(v > 85 for v in ev.scores.values())
    assert messages(ev, REF) == []


def test_bent_index_is_reported_in_spanish():
    ev = evaluate(REF, seq(flex=(0, 20, 90, 90, 90)))
    assert ev.scores["configuracion"] < ev.scores["ubicacion"]
    tips = messages(ev, REF)
    assert tips and tips[0].startswith("Mano derecha: dobla más el índice")


def test_glove_flex_overrides_camera():
    ev = evaluate(REF, seq(flex=(0, 20, 90, 90, 90)), glove_flex=np.array([[0, 90, 90, 90, 90], [np.nan] * 5]))
    assert ev.scores["configuracion"] > 90


def test_location_tip_says_raise_hand():
    ev = evaluate(REF, seq(y=3.0))
    assert any(t.startswith("Sube la mano derecha") for t in messages(ev, REF))


def test_missing_hand_is_reported():
    s = seq()
    s.present[:] = False
    s.hands[:] = 0
    ev = evaluate(REF, s)
    assert ev.total < 50
    assert messages(ev, REF)[0].startswith("No veo tu mano derecha")


def test_finger_status_codes():
    st = finger_status(REF, np.array([[0, 90, 40, 90, 90], [np.nan] * 5]))
    assert st[0].tolist()[:3] == [0, 0, 2] and (st[1] == -1).all()


def test_max_two_tips():
    ev = evaluate(REF, seq(flex=(90, 0, 0, 0, 0), y=3.5, step=0.4))
    assert len(messages(ev, REF)) == 2
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_scoring.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.evaluator.scoring'`

- [ ] **Step 3: Implementar `scoring.py`**

```python
# D:/Ingenium/server/lsm/evaluator/scoring.py
"""Puntaje 0–100 por parámetro de la LSM respecto a la variación natural entre signantes."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from lsm.evaluator.references import GlossRef, dtw, sample_stats
from lsm.normalize import NormSequence

FLEX_FLOOR, LOC_FLOOR, MOVE_FLOOR, PALM_FLOOR = 12.0, 0.35, 0.15, 20.0
ISSUE_Z = 1.5
CONTACT_PENALTY = 10.0
PARAMS = ("configuracion", "ubicacion", "movimiento", "orientacion")


def z_to_score(z: float) -> float:
    return float(100.0 * np.exp(-0.5 * float(z) ** 2))


@dataclass
class Issue:
    param: str
    z: float
    slot: int
    finger: int | None = None
    detail: dict = field(default_factory=dict)


@dataclass
class Evaluation:
    scores: dict
    total: float
    finger_flex: np.ndarray
    finger_z: np.ndarray
    issues: list


def finger_status(ref: GlossRef, flex: np.ndarray) -> np.ndarray:
    out = np.full((2, 5), -1, int)
    for s in (0, 1):
        if not ref.slots_used[s]:
            continue
        z = np.abs(flex[s] - ref.flex_mean[s]) / np.maximum(np.nan_to_num(ref.flex_std[s]), FLEX_FLOOR)
        out[s] = np.where(np.isnan(z), -1, np.where(z < 1, 0, np.where(z < 2, 1, 2)))
    return out


def _angle(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.degrees(np.arccos(np.clip(np.dot(a, b), -1.0, 1.0))))


def evaluate(ref: GlossRef, seq: NormSequence, glove_flex: np.ndarray | None = None,
             glove_contacts: np.ndarray | None = None) -> Evaluation:
    st = sample_stats(seq)
    flex = st["flex"].copy()
    if glove_flex is not None:
        flex = np.where(np.isnan(glove_flex), flex, glove_flex)
    contacts = st["contacts"].copy()
    if glove_contacts is not None:
        contacts = np.where(np.isnan(glove_contacts), contacts, glove_contacts)
    issues: list[Issue] = []
    per = {p: [] for p in PARAMS}
    finger_z = np.full((2, 5), np.nan)
    for s in (0, 1):
        if not ref.slots_used[s]:
            continue
        if st["present_frac"][s] < 0.5:
            issues.append(Issue("mano", 99.0, s))
            for p in PARAMS:
                per[p].append(0.0)
            continue
        z = np.abs(flex[s] - ref.flex_mean[s]) / np.maximum(np.nan_to_num(ref.flex_std[s]), FLEX_FLOOR)
        finger_z[s] = z
        conf = float(np.mean([z_to_score(v) for v in z if not np.isnan(v)] or [0.0]))
        for f in range(5):
            if z[f] > ISSUE_Z:
                issues.append(Issue("configuracion", float(z[f]), s, f,
                                    {"actual": float(flex[s, f]), "target": float(ref.flex_mean[s, f])}))
        for c in range(4):
            prob, got = ref.contact_prob[s, c], contacts[s, c]
            if np.isnan(prob) or np.isnan(got):
                continue
            if prob >= 0.7 and got < 0.5:
                conf -= CONTACT_PENALTY
                issues.append(Issue("contacto", 2.0, s, c + 1, {"expected": True}))
            elif prob <= 0.15 and got >= 0.5:
                conf -= CONTACT_PENALTY
                issues.append(Issue("contacto", 2.0, s, c + 1, {"expected": False}))
        per["configuracion"].append(max(conf, 0.0))
        d = st["loc"][s] - ref.loc_mean[s]
        zl = float(np.linalg.norm(d) / max(float(np.linalg.norm(np.nan_to_num(ref.loc_std[s]))), LOC_FLOOR))
        per["ubicacion"].append(z_to_score(zl))
        if zl > ISSUE_Z:
            issues.append(Issue("ubicacion", zl, s, None, {"dx": float(d[0]), "dy": float(d[1])}))
        spread = ref.palm_spread[s]
        zo = _angle(st["palm"][s], ref.palm_mean[s]) / max(0.0 if np.isnan(spread) else float(spread), PALM_FLOOR)
        per["orientacion"].append(z_to_score(zo))
        if zo > ISSUE_Z:
            issues.append(Issue("orientacion", zo, s))
    zm = dtw(st["traj"], ref.traj_mean) / max(ref.traj_scale, MOVE_FLOOR)
    per["movimiento"].append(0.0 if st["present_frac"][ref.dom] < 0.5 else z_to_score(zm))
    if zm > ISSUE_Z and st["present_frac"][ref.dom] >= 0.5:
        issues.append(Issue("movimiento", zm, ref.dom, None,
                            {"ratio": st["path_len"] / max(ref.path_len, 1e-6)}))
    scores = {p: round(float(np.mean(v)), 1) if v else 0.0 for p, v in per.items()}
    issues.sort(key=lambda i: -i.z)
    return Evaluation(scores, round(float(np.mean(list(scores.values()))), 1), flex, finger_z, issues)
```

- [ ] **Step 4: Implementar `feedback.py`**

```python
# D:/Ingenium/server/lsm/evaluator/feedback.py
"""Correcciones en español por plantilla (instantáneas, sin internet)."""
from __future__ import annotations

from lsm.evaluator.references import GlossRef
from lsm.evaluator.scoring import Evaluation, Issue

SIDE = ("derecha", "izquierda")  # slot 0 = mano derecha del signante
FINGER = ("pulgar", "índice", "medio", "anular", "meñique")


def _msg(i: Issue) -> str:
    lado = SIDE[i.slot]
    if i.param == "mano":
        return f"No veo tu mano {lado}: acércate o mejora la luz"
    if i.param == "configuracion":
        a, t = i.detail["actual"], i.detail["target"]
        verbo = "dobla más" if a < t else "estira más"
        return f"Mano {lado}: {verbo} el {FINGER[i.finger]} (tienes {a:.0f}°, debe ser ~{t:.0f}°)"
    if i.param == "contacto":
        if i.detail["expected"]:
            return f"Mano {lado}: el pulgar debe tocar el {FINGER[i.finger]}"
        return f"Mano {lado}: separa el pulgar del {FINGER[i.finger]}"
    if i.param == "ubicacion":
        dx, dy = i.detail["dx"], i.detail["dy"]
        if abs(dy) >= abs(dx):
            return f"{'Sube' if dy > 0 else 'Baja'} la mano {lado}"
        return f"Mueve la mano {lado} hacia tu {'derecha' if dx > 0 else 'izquierda'}"
    if i.param == "orientacion":
        return f"Gira la palma de la mano {lado}: revisa hacia dónde apunta"
    ratio = i.detail.get("ratio", 1.0)
    if ratio < 0.7:
        return "Haz el movimiento más amplio"
    if ratio > 1.4:
        return "Haz el movimiento más corto"
    return "Revisa la dirección del movimiento"


def messages(ev: Evaluation, ref: GlossRef, max_tips: int = 2) -> list[str]:
    out: list[str] = []
    for i in ev.issues:
        m = _msg(i)
        if m not in out:
            out.append(m)
        if len(out) == max_tips:
            break
    return out
```

- [ ] **Step 5: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_scoring.py -v`
Expected: 8 PASS. Si `test_location_tip_says_raise_hand` falla por el signo de `dy`, recordar que en la imagen `y` crece hacia abajo: `dy > 0` = la mano del usuario está más abajo que la referencia → "Sube".

- [ ] **Step 6: Commit**

```bash
cd D:/Ingenium && git add server/lsm/evaluator/scoring.py server/lsm/evaluator/feedback.py server/tests/test_scoring.py
git commit -m "feat(evaluator): puntajes por parámetro LSM y correcciones en español

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Oraciones (LLM + plantillas)

**Files:**
- Create: `D:\Ingenium\server\lsm\sentences.py`
- Test: `D:\Ingenium\server\tests\test_sentences.py`

**Interfaces:**
- Produces:
  - `SYSTEM_PROMPT: str`; `template_sentence(glosses: list[str]) -> str`.
  - `SentenceBuilder(llm=None, provider=None, model=None, timeout=6.0)`; `async build(glosses, context: list[str]) -> tuple[str, str]` → `(texto, "llm"|"template")`. `llm` es una función `async (system: str, user: str) -> str` (se inyecta en pruebas). Sin `llm`, se construye desde `provider` (`SENTENCES_PROVIDER`, por defecto `"openai"`) y `model` (`SENTENCES_MODEL`; por defecto `gpt-4o-mini` para OpenAI y `claude-haiku-4-5-20251001` para Anthropic) solo si existe la API key correspondiente. Cualquier error, timeout o respuesta vacía → plantilla.

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_sentences.py
import asyncio

from lsm.sentences import SYSTEM_PROMPT, SentenceBuilder, template_sentence


def test_template_moves_time_first_and_conjugates_yo():
    assert template_sentence(["YO", "ESCUELA", "IR", "MAÑANA"]) == "Mañana voy a ir a escuela."
    assert template_sentence(["YO", "DOCTOR", "NECESITAR"]) == "Necesito doctor."
    assert template_sentence(["HOLA"]) == "Hola."


def test_llm_used_and_context_passed():
    seen = {}

    async def fake(system, user):
        seen["system"], seen["user"] = system, user
        return "  Mañana voy a ir a la escuela.  "

    text, src = asyncio.run(SentenceBuilder(llm=fake).build(["YO", "ESCUELA", "IR", "MAÑANA"], ["Hola, soy sordo."]))
    assert (text, src) == ("Mañana voy a ir a la escuela.", "llm")
    assert seen["system"] == SYSTEM_PROMPT and "YO ESCUELA IR MAÑANA" in seen["user"] and "Hola, soy sordo." in seen["user"]


def test_llm_error_falls_back_to_template():
    async def boom(system, user):
        raise RuntimeError("sin red")

    text, src = asyncio.run(SentenceBuilder(llm=boom).build(["HOLA"], []))
    assert (text, src) == ("Hola.", "template")


def test_no_api_key_uses_template(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    text, src = asyncio.run(SentenceBuilder(provider="openai").build(["GRACIAS"], []))
    assert (text, src) == ("Gracias.", "template")
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_sentences.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.sentences'`

- [ ] **Step 3: Implementar `sentences.py`**

```python
# D:/Ingenium/server/lsm/sentences.py
"""Secuencia de glosas LSM → oración en español (LLM con respaldo por plantillas)."""
from __future__ import annotations

import asyncio
import os
from typing import Awaitable, Callable

SYSTEM_PROMPT = """Eres intérprete de Lengua de Señas Mexicana (LSM) a español.
Recibes una secuencia de GLOSAS (palabras en mayúsculas en el orden en que se señaron) y el contexto de oraciones anteriores.
Reglas de la LSM a considerar:
- El tiempo (AYER, HOY, MAÑANA, AHORA, ANTES, PRÓXIMO) suele ir al inicio y marca el tiempo verbal de toda la oración.
- El orden es tema-comentario; no hay artículos ni conjugación: tú los agregas.
- Los pronombres se señalan (YO, TÚ, ÉL…); si no hay sujeto explícito, infiérelo del contexto.
- Las preguntas (DÓNDE, CÓMO, CUÁNTO, QUÉ) pueden ir al final.
Responde SOLO con una oración en español natural y correcto, con puntuación.
No agregues información que no esté en las glosas o en el contexto. Mantén coherencia de género y número con el contexto."""

TIME = {"AYER": "Ayer", "HOY": "Hoy", "MAÑANA": "Mañana", "AHORA": "Ahora", "ANTES": "Antes",
        "PROXIMO": "Próximamente", "NOCHE": "En la noche", "TARDE": "En la tarde"}
YO_VERBS = {"IR": "voy a ir a", "TENER": "tengo", "NECESITAR": "necesito", "QUERER": "quiero",
            "GUSTAR": "me gusta", "ESTAR": "estoy", "COMER": "como", "DORMIR": "duermo", "AYUDA": "necesito ayuda",
            "NO_ENTENDER": "no entiendo", "NO_PODER": "no puedo", "SENTIR": "siento"}
Llm = Callable[[str, str], Awaitable[str]]


def template_sentence(glosses: list[str]) -> str:
    time = [TIME[g] for g in glosses if g in TIME]
    rest = [g for g in glosses if g not in TIME]
    has_yo = "YO" in rest
    rest = [g for g in rest if g != "YO"] if has_yo else rest
    verbs = [g for g in rest if has_yo and g in YO_VERBS]
    others = [g for g in rest if g not in verbs]
    words = [YO_VERBS[v] for v in verbs] + [o.lower().replace("_", " ") for o in others]
    if has_yo and not verbs:
        words = ["yo"] + words
    body = " ".join(words)
    text = f"{time[0]} {body}" if time else body
    text = text.strip()
    return (text[:1].upper() + text[1:] + ".") if text else ""


def _openai_llm(model: str, timeout: float) -> Llm:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(timeout=timeout)

    async def call(system: str, user: str) -> str:
        r = await client.chat.completions.create(model=model, temperature=0.2, max_tokens=160,
                                                 messages=[{"role": "system", "content": system},
                                                           {"role": "user", "content": user}])
        return r.choices[0].message.content or ""
    return call


def _anthropic_llm(model: str, timeout: float) -> Llm:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(timeout=timeout)

    async def call(system: str, user: str) -> str:
        r = await client.messages.create(model=model, max_tokens=160, system=system,
                                         messages=[{"role": "user", "content": user}])
        return "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    return call


class SentenceBuilder:
    def __init__(self, llm: Llm | None = None, provider: str | None = None, model: str | None = None,
                 timeout: float = 6.0):
        self.timeout = timeout
        self.llm = llm
        if llm is None:
            provider = provider or os.environ.get("SENTENCES_PROVIDER", "openai")
            if provider == "openai" and os.environ.get("OPENAI_API_KEY"):
                self.llm = _openai_llm(model or os.environ.get("SENTENCES_MODEL", "gpt-4o-mini"), timeout)
            elif provider == "anthropic" and os.environ.get("ANTHROPIC_API_KEY"):
                self.llm = _anthropic_llm(model or os.environ.get("SENTENCES_MODEL", "claude-haiku-4-5-20251001"), timeout)

    async def build(self, glosses: list[str], context: list[str]) -> tuple[str, str]:
        if self.llm is not None:
            user = "Contexto: " + (" ".join(context) if context else "(inicio de la conversación)") + \
                   "\nGlosas: " + " ".join(glosses)
            try:
                text = (await asyncio.wait_for(self.llm(SYSTEM_PROMPT, user), self.timeout)).strip()
                if text:
                    return text, "llm"
            except Exception:
                pass
        return template_sentence(glosses), "template"
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_sentences.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/sentences.py server/tests/test_sentences.py
git commit -m "feat(sentences): glosas LSM a español con LLM y respaldo por plantillas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Sesión (orquestador sin red)

**Files:**
- Create: `D:\Ingenium\server\lsm\session.py`
- Test: `D:\Ingenium\server\tests\test_session.py`

**Interfaces:**
- Consumes: `frame_to_raw`, `LiveNormalizer` (Task 2), `Segmenter` (Task 3), `parse_line`, `GloveReading` (Task 4), `Calibrator` (Task 5), `GlossRef` (Task 6), `evaluate`, `finger_status`, `messages` (Task 7), `SentenceBuilder` (Task 8), `finger_flexion`, `NormSequence` (Plan 1). `classifier` es cualquier objeto con `predict(norm, k=3) -> list[tuple[str, float]]` (el `Classifier` del Plan 1).
- Produces: `Session(classifier=None, references=None, sentences=None)`; `async handle(msg: dict) -> list[dict]` que implementa exactamente el **Contrato WebSocket** de arriba. Constantes `LIVE_EVERY=2`, `KEEP=900`, `CONF_MIN=0.6`, `NO_HAND_WARN=60`, `SIDE_OF_SLOT=("R","L")`.

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_session.py
import asyncio

import numpy as np

from lsm.evaluator.references import build_reference
from lsm.glove.simulator import simulate_line
from lsm.normalize import NormSequence
from lsm.sentences import SentenceBuilder
from lsm.session import Session
from tests.conftest import make_hand

HEAD = (320.0, 100.0)


def pose():
    p = [[0.0, 0.0, 0.0, 0.0] for _ in range(33)]
    p[0] = [HEAD[0], HEAD[1], 0.0, 0.99]
    p[7] = [HEAD[0] + 15, HEAD[1], 0.0, 0.99]
    p[8] = [HEAD[0] - 15, HEAD[1], 0.0, 0.99]
    return p


def frame(wrist_units=None, glove=None):
    hands = []
    if wrist_units is not None:
        wx, wy = HEAD[0] + 30 * wrist_units[0], HEAD[1] + 30 * wrist_units[1]
        hands = [make_hand(wrist=(wx, wy), size=30, flex=(0, 90, 90, 90, 90)).tolist()]
    return {"type": "frame", "w": 640, "h": 480, "hands": hands, "pose": pose(), "face": None,
            "gloves": {"R": glove, "L": None}}


def sign_frames():
    return [frame((-1.0, 5.0))] * 5 + [frame((-1.0 + 0.05 * i, 1.0)) for i in range(20)] + [frame((-1.0, 5.0))] * 60


class FakeClassifier:
    def predict(self, norm, k=3):
        return [("HOLA", 0.9), ("ADIOS", 0.05), ("SI", 0.02)][:k]


def ref():
    hands = np.zeros((12, 2, 21, 3), np.float32)
    present = np.zeros((12, 2), bool)
    for t in range(12):
        hands[t, 0] = make_hand(wrist=(-1.0 + 0.1 * t, 1.0), flex=(0, 90, 90, 90, 90))
        present[t, 0] = True
    return build_reference("HOLA", [NormSequence(hands, present, f"s{i}", f"s{i}") for i in range(3)])


async def run(session, msgs):
    out = []
    for m in msgs:
        out += await session.handle(m)
    return out


def test_translate_flow_sign_then_sentence():
    async def fake_llm(system, user):
        return "Hola."

    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=fake_llm))
    out = asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}] + sign_frames()))
    kinds = [m["type"] for m in out]
    assert kinds[0] == "ready"
    sign = next(m for m in out if m["type"] == "sign")
    assert sign["gloss"] == "HOLA" and sign["confident"] and sign["index"] == 0
    sent = next(m for m in out if m["type"] == "sentence")
    assert sent["text"] == "Hola." and sent["glosses"] == ["HOLA"] and sent["paragraph"] == "Hola."


def test_practice_flow_live_and_evaluation():
    s = Session(FakeClassifier(), {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"))
    out = asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}] + sign_frames()))
    assert out[0]["has_reference"] is True
    live = [m for m in out if m["type"] == "live"]
    assert live and len(live[0]["fingers"]) == 2
    ev = next(m for m in out if m["type"] == "evaluation")
    assert ev["target"] == "HOLA" and ev["recognized"][0][0] == "HOLA"
    assert set(ev["scores"]) == {"configuracion", "ubicacion", "movimiento", "orientacion"}
    assert isinstance(ev["tips"], list)


def test_confirm_and_remove_gloss():
    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"))
    s.pending = [{"gloss": "HOLA", "top3": [], "confident": False}, {"gloss": "SI", "top3": [], "confident": True}]
    out = asyncio.run(run(s, [{"type": "confirm_gloss", "index": 0, "gloss": "ADIOS"}, {"type": "remove_gloss", "index": 1}]))
    assert out[-1] == {"type": "pending", "glosses": ["ADIOS"]}


def test_no_hand_warning_once():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    out = asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}] + [frame(None)] * 130))
    assert [m["code"] for m in out if m["type"] == "warning"] == ["no_hand"]


def test_calibration_with_simulated_glove():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    msgs = [{"type": "hello", "mode": "practice", "target": None}, {"type": "calibrate", "step": "open"}]
    msgs += [frame((0, 1.0), simulate_line("R", i, i, flex=(0,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "fist"}]
    msgs += [frame((0, 1.0), simulate_line("R", i, i, flex=(80,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "done"}]
    out = asyncio.run(run(s, msgs))
    assert out[-1] == {"type": "calibration", "step": "done", "sides": {"L": False, "R": True}}


def test_unknown_message_is_error():
    out = asyncio.run(Session().handle({"type": "zzz"}))
    assert out[0]["type"] == "error"
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_session.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.session'`

- [ ] **Step 3: Implementar `session.py`**

```python
# D:/Ingenium/server/lsm/session.py
"""Orquesta una conexión: cuadros → segmentos → evaluación/traducción. Sin red: probable en aislamiento."""
from __future__ import annotations

import warnings

import numpy as np

from lsm.evaluator.feedback import messages
from lsm.evaluator.scoring import evaluate, finger_status
from lsm.features import finger_flexion
from lsm.glove.calibration import Calibrator
from lsm.glove.protocol import GloveReading, parse_line
from lsm.live import LiveNormalizer, frame_to_raw
from lsm.normalize import NormSequence
from lsm.segmenter import Segmenter
from lsm.sentences import SentenceBuilder

LIVE_EVERY = 2
KEEP = 900
DROP = 300
CONF_MIN = 0.6
NO_HAND_WARN = 60
SIDE_OF_SLOT = ("R", "L")


def _nanmedian(a: np.ndarray) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(a, axis=0)


class Session:
    def __init__(self, classifier=None, references: dict | None = None, sentences: SentenceBuilder | None = None):
        self.classifier = classifier
        self.references = references or {}
        self.sentences = sentences or SentenceBuilder()
        self.mode, self.target = "translate", None
        self.paragraph: list[str] = []
        self._reset_stream()

    def _reset_stream(self) -> None:
        self.normalizer, self.segmenter = LiveNormalizer(), Segmenter()
        self.hands, self.present, self.gflex, self.gcont = [], [], [], []
        self.base, self.idx = 0, -1
        self.gloves: dict[str, GloveReading | None] = {"L": None, "R": None}
        self.calib: dict = {"L": None, "R": None}
        self.calibrator: Calibrator | None = None
        self.pending: list[dict] = []
        self.no_hand = 0

    def _ready(self) -> dict:
        return {"type": "ready", "mode": self.mode, "target": self.target,
                "has_reference": self.target in self.references}

    async def handle(self, msg: dict) -> list[dict]:
        t = msg.get("type")
        if t == "hello":
            self.mode, self.target = msg.get("mode", "translate"), msg.get("target")
            calib = self.calib
            self._reset_stream()
            self.calib = calib  # la calibración sobrevive al cambio de modo
            return [self._ready()]
        if t == "frame":
            return await self._frame(msg)
        if t == "calibrate":
            return self._calibrate(msg.get("step"))
        if t == "confirm_gloss":
            i = int(msg["index"])
            if 0 <= i < len(self.pending):
                self.pending[i].update(gloss=msg["gloss"], confident=True)
            return [{"type": "pending", "glosses": [p["gloss"] for p in self.pending]}]
        if t == "remove_gloss":
            i = int(msg["index"])
            if 0 <= i < len(self.pending):
                self.pending.pop(i)
            return [{"type": "pending", "glosses": [p["gloss"] for p in self.pending]}]
        if t == "build_sentence":
            return await self._sentence()
        if t == "reset":
            self.paragraph = []
            calib = self.calib
            self._reset_stream()
            self.calib = calib
            return [self._ready()]
        return [{"type": "error", "message": f"tipo de mensaje desconocido: {t}"}]

    async def _frame(self, msg: dict) -> list[dict]:
        hands, present = self.normalizer.push(frame_to_raw(msg))
        self.idx += 1
        for side, line in (msg.get("gloves") or {}).items():
            r = parse_line(line) if isinstance(line, str) else None
            if isinstance(r, GloveReading) and side in self.gloves:
                self.gloves[side] = r
        gf, gc = np.full((2, 5), np.nan, np.float32), np.full((2, 4), np.nan, np.float32)
        cam = np.full((2, 5), np.nan, np.float32)
        for s, side in enumerate(SIDE_OF_SLOT):
            if present[s]:
                cam[s] = finger_flexion(hands[s])
            r, cal = self.gloves[side], self.calib.get(side)
            if r is not None and cal is not None:
                gf[s], gc[s] = cal.flexion(r), cal.contacts(r)
            if self.calibrator is not None and r is not None:
                self.calibrator.add(side, r, cam[s] if present[s] else None)
        self.hands.append(hands)
        self.present.append(present)
        self.gflex.append(gf)
        self.gcont.append(gc)
        if len(self.hands) > KEEP:
            del self.hands[:DROP], self.present[:DROP], self.gflex[:DROP], self.gcont[:DROP]
            self.base += DROP
        out: list[dict] = []
        ref = self.references.get(self.target) if self.mode == "practice" else None
        if ref is not None and self.idx % LIVE_EVERY == 0:
            flex = np.where(np.isnan(gf), cam, gf)
            out.append({"type": "live", "fingers": finger_status(ref, flex).tolist(),
                        "hands": present.tolist(), "segment": self.segmenter.state})
        self.no_hand = 0 if present.any() else self.no_hand + 1
        if self.no_hand == NO_HAND_WARN and self.mode == "practice":
            out.append({"type": "warning", "code": "no_hand",
                        "message": "No veo tus manos: acércate a la cámara o mejora la luz"})
        for ev in self.segmenter.update(self.idx, hands, present):
            if ev.kind == "end":
                out += self._segment(ev.start, ev.end)
            elif ev.kind == "pause" and self.mode == "translate":
                out += await self._sentence()
        return out

    def _segment(self, start: int, end: int) -> list[dict]:
        a, b = max(start - self.base, 0), end - self.base
        if b < a:
            return []
        seq = NormSequence(np.stack(self.hands[a:b + 1]), np.stack(self.present[a:b + 1]))
        top3 = [[g, round(float(p), 3)] for g, p in self.classifier.predict(seq, k=3)] if self.classifier else []
        if self.mode == "practice":
            ref = self.references.get(self.target)
            if ref is None:
                return [{"type": "evaluation", "target": self.target, "recognized": top3, "scores": {},
                         "total": 0.0, "tips": ["No hay referencia para esta seña"], "fingers": []}]
            q = (b - a) // 4
            gflex = _nanmedian(np.stack(self.gflex[a + q:b - q + 1]))
            gcont = _nanmedian(np.stack(self.gcont[a + q:b - q + 1]))
            ev = evaluate(ref, seq, gflex, gcont)
            return [{"type": "evaluation", "target": self.target, "recognized": top3, "scores": ev.scores,
                     "total": ev.total, "tips": messages(ev, ref),
                     "fingers": finger_status(ref, ev.finger_flex).tolist()}]
        if not top3:
            return []
        item = {"gloss": top3[0][0], "top3": top3, "confident": top3[0][1] >= CONF_MIN}
        self.pending.append(item)
        return [{"type": "sign", "index": len(self.pending) - 1, **item}]

    async def _sentence(self) -> list[dict]:
        if not self.pending:
            return []
        glosses = [p["gloss"] for p in self.pending]
        text, source = await self.sentences.build(glosses, self.paragraph[-3:])
        self.paragraph.append(text)
        self.pending = []
        return [{"type": "sentence", "glosses": glosses, "text": text,
                 "paragraph": " ".join(self.paragraph), "source": source}]

    def _calibrate(self, step: str | None) -> list[dict]:
        if step in ("open", "fist"):
            self.calibrator = self.calibrator or Calibrator()
            self.calibrator.step = step
            return [{"type": "calibration", "step": step, "status": "recording"}]
        if step == "done" and self.calibrator is not None:
            res = self.calibrator.finish()
            self.calibrator = None
            for side, cal in res.items():
                if cal is not None:
                    self.calib[side] = cal
            return [{"type": "calibration", "step": "done", "sides": {s: res[s] is not None for s in ("L", "R")}}]
        return [{"type": "error", "message": f"paso de calibración inválido: {step}"}]
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_session.py -v`
Expected: 6 PASS

- [ ] **Step 5: Correr toda la suite**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest -q`
Expected: todas PASS.

- [ ] **Step 6: Commit**

```bash
cd D:/Ingenium && git add server/lsm/session.py server/tests/test_session.py
git commit -m "feat(lsm): sesión que orquesta segmentación, evaluación, traducción y calibración

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: App FastAPI, grabaciones y reproducción

**Files:**
- Create: `D:\Ingenium\server\lsm\app.py`
- Create: `D:\Ingenium\training\replay.py`
- Modify: `D:\Ingenium\server\lsm\vocab.py` (`lookup` acepta `"own"`)
- Modify: `D:\Ingenium\training\build_dataset.py` (lee `index_own.csv` si existe)
- Test: `D:\Ingenium\server\tests\test_app.py`

**Interfaces:**
- Consumes: `Session` (Task 9), `load_references` (Task 6), `Classifier` (Plan 1), `frames_to_raw` (Task 2), `lsm.paths`.
- Produces:
  - `create_app(classifier=None, references=None, sentences=None, static_dir=None, own_dir=None) -> FastAPI` con: `GET /api/health` → `{"ok": true, "classifier": bool, "references": int}`; `GET /api/vocab` → `[{"gloss","category","has_reference"}]` (de `datasets/processed/vocab.csv` si existe; si no, de las referencias); `GET /api/reference/{gloss}` → `{"gloss","example_hands","example_present","flex_mean","slots_used","n_samples"}` (404 si no existe); `POST /api/recordings` con `{"label","signer","frames":[frame…]}` → guarda `RawSequence` en `<own_dir>/raw/<signer>_<LABEL>_<n>.npz` y agrega una fila a `<own_dir>/index_own.csv` (mismas columnas que los otros índices, `dataset="own"`) → `{"sample_id","frames"}`; `WS /ws` → `Session.handle`; estáticos en `/` si `static_dir` existe.
  - `main()`: carga `models/classifier_v1.pt` y `models/references.json` si existen; `uvicorn` en `HOST` (por defecto `127.0.0.1`) y `PORT` (por defecto `8000`); estáticos en `D:/Ingenium/web/dist`.
  - `lookup("own", label) == canonical(label)`.

- [ ] **Step 1: Escribir las pruebas**

```python
# D:/Ingenium/server/tests/test_app.py
import csv

from fastapi.testclient import TestClient

from lsm.app import create_app
from lsm.sentences import SentenceBuilder
from lsm.vocab import lookup
from tests.test_session import FakeClassifier, frame, ref


def client(tmp_path):
    app = create_app(FakeClassifier(), {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"),
                     static_dir=None, own_dir=tmp_path / "own")
    return TestClient(app)


def test_health_and_reference(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/health").json() == {"ok": True, "classifier": True, "references": 1}
    r = c.get("/api/reference/HOLA").json()
    assert r["gloss"] == "HOLA" and len(r["example_hands"]) == 16 and r["slots_used"] == [True, False]
    assert c.get("/api/reference/NADA").status_code == 404


def test_vocab_falls_back_to_references(tmp_path, monkeypatch):
    monkeypatch.setattr("lsm.app.VOCAB_CSV", tmp_path / "no.csv")
    assert client(tmp_path).get("/api/vocab").json() == [{"gloss": "HOLA", "category": "", "has_reference": True}]


def test_recording_saved_and_indexed(tmp_path):
    c = client(tmp_path)
    frames = [frame((0.0, 1.0)) for _ in range(5)]
    r = c.post("/api/recordings", json={"label": "hola", "signer": "angel", "frames": frames}).json()
    assert r["frames"] == 5 and r["sample_id"].startswith("angel_HOLA_")
    rows = list(csv.DictReader(open(tmp_path / "own" / "index_own.csv", encoding="utf-8")))
    assert rows[0]["dataset"] == "own" and rows[0]["source_label"] == "HOLA" and rows[0]["signer"] == "angel"


def test_websocket_hello(tmp_path):
    with client(tmp_path).websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello", "mode": "practice", "target": "HOLA"})
        assert ws.receive_json() == {"type": "ready", "mode": "practice", "target": "HOLA", "has_reference": True}


def test_lookup_own():
    assert lookup("own", "Mañana") == "MAÑANA"
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_app.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.app'`

- [ ] **Step 3: `vocab.lookup` acepta `"own"`**

En `server/lsm/vocab.py`, dentro de `lookup`, cambiar `if dataset == "glosses":` por `if dataset in ("glosses", "own"):`.

- [ ] **Step 4: Implementar `app.py`**

```python
# D:/Ingenium/server/lsm/app.py
"""FastAPI: WebSocket /ws + REST. La lógica vive en Session; aquí solo hay transporte."""
from __future__ import annotations

import csv
import os
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from lsm.evaluator.references import _to_json, load_references
from lsm.live import frames_to_raw
from lsm.paths import DATASETS, MODELS, PROCESSED, ROOT
from lsm.sentences import SentenceBuilder
from lsm.session import Session
from lsm.vocab import canonical

VOCAB_CSV = PROCESSED / "vocab.csv"
INDEX_FIELDS = ["sample_id", "dataset", "source_label", "signer", "path", "n_frames", "hand_ratio"]


class RecordingIn(BaseModel):
    label: str
    signer: str
    frames: list[dict]


def create_app(classifier=None, references: dict | None = None, sentences: SentenceBuilder | None = None,
               static_dir: str | Path | None = None, own_dir: str | Path | None = None) -> FastAPI:
    references = references or {}
    sentences = sentences or SentenceBuilder()
    own = Path(own_dir) if own_dir else DATASETS / "own"
    app = FastAPI(title="LSM INGENIUM")

    @app.get("/api/health")
    def health():
        return {"ok": True, "classifier": classifier is not None, "references": len(references)}

    @app.get("/api/vocab")
    def vocab():
        if Path(VOCAB_CSV).exists():
            rows = csv.DictReader(open(VOCAB_CSV, encoding="utf-8"))
            return [{"gloss": r["gloss"], "category": r["category"], "has_reference": r["gloss"] in references}
                    for r in rows]
        return [{"gloss": g, "category": "", "has_reference": True} for g in sorted(references)]

    @app.get("/api/reference/{gloss}")
    def reference(gloss: str):
        r = references.get(gloss)
        if r is None:
            raise HTTPException(404, "sin referencia")
        return {"gloss": r.gloss, "example_hands": _to_json(r.example_hands),
                "example_present": _to_json(r.example_present), "flex_mean": _to_json(r.flex_mean),
                "slots_used": _to_json(r.slots_used), "n_samples": r.n_samples}

    @app.post("/api/recordings")
    def recordings(rec: RecordingIn):
        if not rec.frames:
            raise HTTPException(400, "sin cuadros")
        label = canonical(rec.label)
        (own / "raw").mkdir(parents=True, exist_ok=True)
        n = len(list((own / "raw").glob(f"{rec.signer}_{label}_*.npz")))
        sid = f"{rec.signer}_{label}_{n:03d}"
        raw = frames_to_raw(rec.frames, sample_id=sid, dataset="own", source_label=label, signer=rec.signer)
        path = own / "raw" / f"{sid}.npz"
        raw.save(path)
        present = (~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1)
        index = own / "index_own.csv"
        new = not index.exists()
        with open(index, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=INDEX_FIELDS)
            if new:
                w.writeheader()
            w.writerow({"sample_id": sid, "dataset": "own", "source_label": label, "signer": rec.signer,
                        "path": str(path), "n_frames": raw.T, "hand_ratio": round(float(present.mean()), 3)})
        return {"sample_id": sid, "frames": raw.T}

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        session = Session(classifier, references, sentences)
        try:
            while True:
                msg = await ws.receive_json()
                for out in await session.handle(msg):
                    await ws.send_json(out)
        except WebSocketDisconnect:
            return

    if static_dir and Path(static_dir).exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="web")
    return app


def main() -> None:
    import uvicorn

    from lsm.classifier.infer import Classifier

    clf_path, ref_path = MODELS / "classifier_v1.pt", MODELS / "references.json"
    classifier = Classifier.load(clf_path) if clf_path.exists() else None
    references = load_references(ref_path) if ref_path.exists() else {}
    app = create_app(classifier, references, SentenceBuilder(), static_dir=ROOT / "web" / "dist")
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: `build_dataset.py` incluye grabaciones propias**

En `training/build_dataset.py`, reemplazar la tupla `("index_mendeley.csv", "index_glosses.csv")` del ciclo por una lista de rutas y leer cada una con su ruta completa:
```python
    indexes = [RAW_LANDMARKS / "index_mendeley.csv", RAW_LANDMARKS / "index_glosses.csv",
               DATASETS / "own" / "index_own.csv"]
    for idx in indexes:
        if not idx.exists():
            continue
        for r in csv.DictReader(open(idx, encoding="utf-8")):
```
(y agregar `DATASETS` a la importación de `lsm.paths`). Las grabaciones propias usan el split de `split_of(signer)`, es decir, `train`.

- [ ] **Step 6: Implementar `training/replay.py`**

```python
# D:/Ingenium/training/replay.py
"""Reproduce un RawSequence (.npz) en una Session para probar sin cámara ni guantes.
Uso: python replay.py <archivo.npz> [--mode translate|practice] [--target GLOSA]"""
import argparse
import asyncio

import numpy as np

from lsm.classifier.infer import Classifier
from lsm.evaluator.references import load_references
from lsm.paths import MODELS
from lsm.schema import RawSequence
from lsm.sentences import SentenceBuilder
from lsm.session import Session


def raw_to_frames(raw: RawSequence) -> list[dict]:
    frames = []
    for t in range(raw.T):
        hands = [h.tolist() for h in raw.hands[t] if not np.isnan(h[0, 0])]
        pose = None if np.isnan(raw.pose[t, 0, 0]) else np.nan_to_num(raw.pose[t]).tolist()
        face = None if np.isnan(raw.face[t, 0, 0]) else raw.face[t].tolist()
        frames.append({"type": "frame", "w": raw.width, "h": raw.height, "hands": hands, "pose": pose,
                       "face": face, "gloves": {}})
    return frames


async def run(path, mode, target, rest_frames=60):
    raw = RawSequence.load(path)
    clf_path, ref_path = MODELS / "classifier_v1.pt", MODELS / "references.json"
    s = Session(Classifier.load(clf_path) if clf_path.exists() else None,
                load_references(ref_path) if ref_path.exists() else {}, SentenceBuilder())
    frames = raw_to_frames(raw)
    rest = dict(frames[0], hands=[])  # manos fuera = reposo, para cerrar el segmento y la pausa
    for m in [{"type": "hello", "mode": mode, "target": target}] + frames + [rest] * rest_frames:
        for out in await s.handle(m):
            if out["type"] != "live":
                print(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--mode", default="translate")
    ap.add_argument("--target", default=None)
    a = ap.parse_args()
    asyncio.run(run(a.path, a.mode, a.target))
```

- [ ] **Step 7: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest -q`
Expected: todas PASS (incluye las 5 de `test_app.py`).

- [ ] **Step 8: Prueba de humo con el modelo real** (si ya existen `classifier_v1.pt` y `manifest.csv` del Plan 1)

Run:
```bash
source D:/Ingenium/tools/env.sh && cd D:/Ingenium/training && python build_references.py
python replay.py D:/Ingenium/datasets/raw_landmarks/glosses/g02_HOLA.npz --mode translate
python replay.py D:/Ingenium/datasets/raw_landmarks/glosses/g02_HOLA.npz --mode practice --target HOLA
```
Expected: en `translate` aparece al menos un `{'type': 'sign', ...}` y un `{'type': 'sentence', ...}`; en `practice`, un `{'type': 'evaluation', ...}` con 4 puntajes. Si los archivos del Plan 1 aún no existen, anotarlo en el reporte y no bloquear la tarea.

- [ ] **Step 9: Arranque manual del servidor**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && timeout 8 python -m lsm.app; curl -s http://127.0.0.1:8000/api/health` (en dos comandos: el primero en segundo plano).
Expected: `{"ok":true,...}`.

- [ ] **Step 10: Commit**

```bash
cd D:/Ingenium && git add server/lsm/app.py server/lsm/vocab.py server/tests/test_app.py training/replay.py training/build_dataset.py
git commit -m "feat(server): FastAPI con WebSocket, referencias, grabaciones propias y replay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
