# Plan 1: Datos y modelo v1 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir los datasets Mendeley (249 palabras) y LSM Glosses (119 glosas) en landmarks normalizados y entrenar el clasificador de señas v1, con métricas medidas en personas no vistas y un envoltorio de inferencia listo para el servidor.

**Architecture:** Extracción offline con MediaPipe Tasks (Python) → `RawSequence` por muestra (coordenadas en píxeles) → normalización respecto a la cabeza (`NormSequence`) → recorte y remuestreo a 16 cuadros → vector de 150 características por cuadro → Transformer pequeño en PyTorch. La normalización y las características viven en el paquete `lsm` y son las mismas que usará el servidor en vivo.

**Tech Stack:** Python 3.12 (uv, en `D:`), mediapipe 0.10.14, numpy 1.26.4, opencv (incluido por mediapipe), torch 2.4.1 CPU, scikit-learn, matplotlib, openpyxl, py7zr, pytest.

**Spec:** `D:\Ingenium\docs\superpowers\specs\2026-09-27-lsm-ingenium-design.md` (secciones 2, 3.2 y 4)

## Global Constraints

- **Todo en `D:\Ingenium`**: intérprete de Python, venv, cachés (uv, pip, torch, matplotlib), temporales, datasets y modelos. Nada en `C:`. Cargar siempre `source D:/Ingenium/tools/env.sh` antes de cualquier comando.
- **Rutas absolutas** en todos los comandos (el cwd de la shell puede reiniciarse a `C:\Users\angel\Desktop\Ingenium`).
- Python **3.12** (el 3.14 del sistema no tiene mediapipe). **mediapipe==0.10.14** en Python y **@mediapipe/tasks-vision@0.10.14** en la web (misma versión).
- Coordenadas crudas en **píxeles del cuadro procesado** (x·W, y·H, z·W). Cuadros **sin espejo** (nunca voltear la imagen antes de MediaPipe).
- `T_OUT = 16` cuadros por seña, `F_DIM = 150` características por cuadro.
- Slot 0 = mano en el **lado izquierdo de la imagen** (mano derecha del signante); slot 1 = lado derecho.
- Glosas canónicas: MAYÚSCULAS, sin acentos (se conserva la Ñ), espacios → `_`.
- IDs de persona: Mendeley `m01`…`m11`; LSM Glosses `g00`…`g11`. Validación: `m03`, `g03`. Prueba: `m02`, `g02`.
- Los datasets y `tools/` **no se versionan** (ya están en `.gitignore`).
- Cada commit termina con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Estructura de archivos

```
D:\Ingenium\
├── pyproject.toml                    # proyecto Python único (paquete lsm + extras train/dev)
├── tools/env.sh                      # variables de entorno que apuntan a D:
├── server/
│   ├── lsm/
│   │   ├── __init__.py
│   │   ├── paths.py                  # rutas del proyecto
│   │   ├── schema.py                 # RawSequence: formato crudo por muestra (+ guardar/cargar)
│   │   ├── anchor.py                 # referencia de la cabeza por cuadro
│   │   ├── normalize.py              # NormSequence: unidades de cabeza + asignación de manos a slots
│   │   ├── features.py               # flexión, mano local, recorte, remuestreo, vector de 150
│   │   ├── augment.py                # aumentación sobre NormSequence
│   │   ├── vocab.py                  # glosas canónicas y mapeo de ambos datasets
│   │   └── classifier/
│   │       ├── __init__.py
│   │       ├── model.py              # SignTransformer
│   │       └── infer.py              # Classifier.load / predict (lo usa el servidor)
│   └── tests/
│       ├── conftest.py               # generadores sintéticos (manos, secuencias)
│       ├── test_schema.py
│       ├── test_anchor.py
│       ├── test_normalize.py
│       ├── test_features.py
│       ├── test_augment.py
│       ├── test_vocab.py
│       ├── test_model.py
│       ├── test_infer.py
│       └── test_extract_integration.py   # @slow: MediaPipe real sobre las muestras de verificación
└── training/
    ├── download_models.py            # modelos .task de MediaPipe
    ├── extract_common.py             # Extractor (MediaPipe) + detección del bloque de la cara
    ├── extract_mendeley.py           # zip → raw_landmarks/mendeley/*.npz + index
    ├── extract_glosses.py            # 7z → videos → raw_landmarks/glosses/*.npz + index
    ├── calibrate_facebox.py          # calcula FACEBOX_TO_HEAD
    ├── build_dataset.py              # manifest + caché normalizada + splits
    └── train.py                      # entrenamiento, métricas, reporte
```

---

### Task 1: Entorno en D: y esqueleto del proyecto Python

**Files:**
- Create: `D:\Ingenium\tools\env.sh`
- Create: `D:\Ingenium\pyproject.toml`
- Create: `D:\Ingenium\server\lsm\__init__.py`
- Create: `D:\Ingenium\server\lsm\paths.py`
- Create: `D:\Ingenium\server\tests\test_paths.py`
- Modify: `D:\Ingenium\.gitignore`

**Interfaces:**
- Produces: `lsm.paths` con `ROOT`, `DATASETS`, `RAW_LANDMARKS`, `PROCESSED`, `MODELS`, `MP_MODELS` (todas `pathlib.Path`).

- [ ] **Step 1: Crear `tools/env.sh`**

```bash
# D:/Ingenium/tools/env.sh — cargar con: source D:/Ingenium/tools/env.sh
export LSM_ROOT=D:/Ingenium
export UV_CACHE_DIR=D:/Ingenium/tools/uv-cache
export UV_PYTHON_INSTALL_DIR=D:/Ingenium/tools/python
export PIP_CACHE_DIR=D:/Ingenium/tools/pip-cache
export TMP=D:/Ingenium/tools/tmp
export TEMP=D:/Ingenium/tools/tmp
export TORCH_HOME=D:/Ingenium/tools/torch
export MPLCONFIGDIR=D:/Ingenium/tools/mpl
export PYTHONIOENCODING=utf-8
export PATH="D:/Ingenium/.venv/Scripts:D:/Ingenium/tools/uvpkg/bin:$PATH"
mkdir -p "$UV_CACHE_DIR" "$UV_PYTHON_INSTALL_DIR" "$PIP_CACHE_DIR" "$TMP" "$TORCH_HOME" "$MPLCONFIGDIR"
```

- [ ] **Step 2: Instalar uv y Python 3.12 en D:** (pedir permiso al usuario: descarga de `uv` desde PyPI ~15 MB y de Python 3.12 desde python-build-standalone ~30 MB)

Run:
```bash
source D:/Ingenium/tools/env.sh
python -m pip install --target D:/Ingenium/tools/uvpkg uv==0.4.30
uv python install 3.12
uv venv D:/Ingenium/.venv --python 3.12
D:/Ingenium/.venv/Scripts/python.exe --version
```
Expected: `Python 3.12.x`

- [ ] **Step 3: Crear `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "lsm"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "numpy==1.26.4",
]

[project.optional-dependencies]
train = [
  "mediapipe==0.10.14",
  "scikit-learn==1.5.2",
  "matplotlib==3.9.2",
  "openpyxl==3.1.5",
  "py7zr==0.22.0",
  "tqdm==4.66.5",
]
dev = ["pytest==8.3.3"]

[tool.setuptools.packages.find]
where = ["server"]
include = ["lsm*"]

[tool.pytest.ini_options]
testpaths = ["server/tests"]
pythonpath = ["server"]
markers = ["slow: usa MediaPipe real y archivos de datasets"]
addopts = "-m 'not slow'"
```

Crear también `D:\Ingenium\server\tests\__init__.py` vacío (permite `from tests.conftest import ...`).

- [ ] **Step 4: Instalar dependencias** (torch CPU desde su índice oficial, ~200 MB)

Run:
```bash
source D:/Ingenium/tools/env.sh
cd D:/Ingenium && uv pip install --python D:/Ingenium/.venv/Scripts/python.exe -e ".[train,dev]"
uv pip install --python D:/Ingenium/.venv/Scripts/python.exe torch==2.4.1 --index-url https://download.pytorch.org/whl/cpu
D:/Ingenium/.venv/Scripts/python.exe -c "import mediapipe, torch, numpy; print(mediapipe.__version__, torch.__version__, numpy.__version__)"
```
Expected: `0.10.14 2.4.1+cpu 1.26.4`

- [ ] **Step 5: Escribir el test de rutas**

```python
# D:/Ingenium/server/tests/test_paths.py
from lsm import paths


def test_paths_live_under_root_on_d():
    assert str(paths.ROOT).replace("\\", "/").lower().startswith("d:/ingenium")
    for p in (paths.DATASETS, paths.RAW_LANDMARKS, paths.PROCESSED, paths.MODELS, paths.MP_MODELS):
        assert paths.ROOT in p.parents
```

- [ ] **Step 6: Correr el test para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_paths.py -v`
Expected: FAIL con `ImportError: cannot import name 'paths'`

- [ ] **Step 7: Implementar `lsm/__init__.py` y `lsm/paths.py`**

```python
# D:/Ingenium/server/lsm/__init__.py
"""Sistema de evaluación e interpretación de LSM (INGENIUM 2026)."""
```

```python
# D:/Ingenium/server/lsm/paths.py
import os
from pathlib import Path

ROOT = Path(os.environ.get("LSM_ROOT", "D:/Ingenium"))
DATASETS = ROOT / "datasets"
RAW_LANDMARKS = DATASETS / "raw_landmarks"
PROCESSED = DATASETS / "processed"
MODELS = ROOT / "models"
MP_MODELS = MODELS / "mediapipe"
```

- [ ] **Step 8: Correr el test**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_paths.py -v`
Expected: PASS

- [ ] **Step 9: Ignorar modelos y commit**

Agregar al final de `D:\Ingenium\.gitignore`:
```
models/
*.egg-info/
```

```bash
cd D:/Ingenium && git add .gitignore pyproject.toml server/lsm/__init__.py server/lsm/paths.py server/tests/__init__.py server/tests/test_paths.py
git add -f tools/env.sh   # tools/ está ignorado; solo se versiona env.sh
git commit -m "chore: entorno Python 3.12 en D: y paquete lsm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Formato crudo `RawSequence`

**Files:**
- Create: `D:\Ingenium\server\lsm\schema.py`
- Create: `D:\Ingenium\server\tests\conftest.py`
- Test: `D:\Ingenium\server\tests\test_schema.py`

**Interfaces:**
- Produces:
  - `FACE_IDX: tuple[int, ...]` (22 índices de la malla facial), `N_HAND=21`, `N_POSE=33`, `N_FACE=22`, `FACE_NOSE=0`, `FACE_CHEEK_A=1`, `FACE_CHEEK_B=2`.
  - `RawSequence` (dataclass): `hands (T,2,21,3)`, `pose (T,33,4)`, `face (T,22,3)`, `face_box (T,4)` en float32 con NaN = ausente; `width:int`, `height:int`, `fps:float`, `sample_id:str`, `dataset:str`, `source_label:str`, `signer:str`; propiedad `T`; `RawSequence.empty(T, width, height, fps=0.0, **meta)`; `save(path)`; `RawSequence.load(path)`.
  - En `conftest.py`: `make_hand(wrist=(0,0), size=1.0, flex=(0,0,0,0,0)) -> np.ndarray (21,3)` y `raw_with_head(T, head=(320,100), head_w=30.0, hands_px=None) -> RawSequence`.

- [ ] **Step 1: Escribir `conftest.py` con los generadores sintéticos**

```python
# D:/Ingenium/server/tests/conftest.py
import math

import numpy as np

from lsm.schema import RawSequence

X_OFF = (-0.6, -0.3, 0.0, 0.3, 0.6)  # pulgar..meñique


def make_hand(wrist=(0.0, 0.0), size=1.0, flex=(0, 0, 0, 0, 0)) -> np.ndarray:
    """Mano sintética (21,3). La base de cada dedo está a y=-1 (arriba en la imagen).
    Con flex=0 el dedo sigue la dirección muñeca→base; flex rota esa dirección en el plano xy."""
    pts = np.zeros((21, 3), np.float32)
    for f in range(5):
        ids = [1 + 4 * f, 2 + 4 * f, 3 + 4 * f, 4 + 4 * f]
        base = np.array([X_OFF[f], -1.0, 0.0])
        d = base / np.linalg.norm(base)
        th = math.radians(flex[f])
        dr = np.array([d[0] * math.cos(th) - d[1] * math.sin(th), d[0] * math.sin(th) + d[1] * math.cos(th), 0.0])
        for k, i in enumerate(ids):
            pts[i] = base + dr * (0.8 * k / 3)
    pts = pts * size
    pts[:, 0] += wrist[0]
    pts[:, 1] += wrist[1]
    return pts


def raw_with_head(T=5, head=(320.0, 100.0), head_w=30.0, hands_px=None) -> RawSequence:
    """Secuencia con pose (nariz + orejas visibles) y manos opcionales en píxeles.
    hands_px: lista de longitud T; cada elemento es una lista de arrays (21,3)."""
    raw = RawSequence.empty(T, 640, 480, fps=30.0, sample_id="s", dataset="test", source_label="X", signer="t01")
    for t in range(T):
        raw.pose[t, :, 3] = 0.0
        raw.pose[t, 0] = [head[0], head[1], 0, 0.99]
        raw.pose[t, 7] = [head[0] + head_w / 2, head[1], 0, 0.99]
        raw.pose[t, 8] = [head[0] - head_w / 2, head[1], 0, 0.99]
        if hands_px is not None:
            for k, h in enumerate(hands_px[t][:2]):
                raw.hands[t, k] = h
    return raw
```

- [ ] **Step 2: Escribir el test de guardar/cargar**

```python
# D:/Ingenium/server/tests/test_schema.py
import numpy as np

from lsm.schema import FACE_IDX, N_FACE, RawSequence


def test_face_idx_has_22_points_starting_with_nose_and_cheeks():
    assert N_FACE == 22 and len(FACE_IDX) == 22
    assert FACE_IDX[:3] == (1, 234, 454)


def test_empty_is_all_nan_with_shapes():
    r = RawSequence.empty(4, 640, 480, fps=10.0, sample_id="a", dataset="mendeley", source_label="036", signer="m01")
    assert r.T == 4
    assert r.hands.shape == (4, 2, 21, 3) and np.isnan(r.hands).all()
    assert r.pose.shape == (4, 33, 4) and r.face.shape == (4, 22, 3) and r.face_box.shape == (4, 4)


def test_save_load_roundtrip(tmp_path):
    r = RawSequence.empty(3, 960, 540, fps=30.0, sample_id="g00_HOLA", dataset="glosses", source_label="HOLA", signer="g00")
    r.hands[1, 0] = 5.0
    p = tmp_path / "x.npz"
    r.save(p)
    q = RawSequence.load(p)
    assert (q.width, q.height, q.fps, q.sample_id, q.dataset, q.source_label, q.signer) == (960, 540, 30.0, "g00_HOLA", "glosses", "HOLA", "g00")
    np.testing.assert_array_equal(np.nan_to_num(q.hands, nan=-1), np.nan_to_num(r.hands, nan=-1))
```

- [ ] **Step 3: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_schema.py -v`
Expected: ERROR al cargar `conftest.py` con `ModuleNotFoundError: No module named 'lsm.schema'`

- [ ] **Step 4: Implementar `schema.py`**

```python
# D:/Ingenium/server/lsm/schema.py
"""Formato crudo por muestra: landmarks de MediaPipe en píxeles del cuadro procesado."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

N_HAND = 21
N_POSE = 33
# nariz, mejilla (234), mejilla (454), cejas (10), boca (8), barbilla
FACE_IDX = (1, 234, 454, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300,
            61, 291, 0, 17, 13, 14, 78, 308, 152)
N_FACE = len(FACE_IDX)
FACE_NOSE, FACE_CHEEK_A, FACE_CHEEK_B = 0, 1, 2


@dataclass
class RawSequence:
    hands: np.ndarray      # (T,2,21,3) px; orden de detección; NaN = sin mano
    pose: np.ndarray       # (T,33,4) px + visibilidad
    face: np.ndarray       # (T,22,3) px, índices FACE_IDX
    face_box: np.ndarray   # (T,4) px x0,y0,x1,y1 (bloque de la cara; solo Mendeley)
    width: int
    height: int
    fps: float = 0.0       # 0 = desconocido
    sample_id: str = ""
    dataset: str = ""
    source_label: str = ""
    signer: str = ""

    @property
    def T(self) -> int:
        return int(self.hands.shape[0])

    @staticmethod
    def empty(T: int, width: int, height: int, fps: float = 0.0, **meta) -> "RawSequence":
        return RawSequence(
            hands=np.full((T, 2, N_HAND, 3), np.nan, np.float32),
            pose=np.full((T, N_POSE, 4), np.nan, np.float32),
            face=np.full((T, N_FACE, 3), np.nan, np.float32),
            face_box=np.full((T, 4), np.nan, np.float32),
            width=width, height=height, fps=fps, **meta,
        )

    def save(self, path: str | Path) -> None:
        meta = {k: getattr(self, k) for k in ("width", "height", "fps", "sample_id", "dataset", "source_label", "signer")}
        np.savez_compressed(path, hands=self.hands, pose=self.pose, face=self.face,
                            face_box=self.face_box, meta=np.array(json.dumps(meta)))

    @staticmethod
    def load(path: str | Path) -> "RawSequence":
        with np.load(path) as z:
            meta = json.loads(str(z["meta"]))
            return RawSequence(hands=z["hands"], pose=z["pose"], face=z["face"], face_box=z["face_box"], **meta)
```

- [ ] **Step 5: Correr los tests**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_schema.py -v`
Expected: 3 PASS

- [ ] **Step 6: Commit**

```bash
cd D:/Ingenium && git add server/lsm/schema.py server/tests/conftest.py server/tests/test_schema.py
git commit -m "feat(lsm): formato crudo RawSequence con guardar/cargar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Referencia de la cabeza (`anchor.py`)

**Files:**
- Create: `D:\Ingenium\server\lsm\anchor.py`
- Test: `D:\Ingenium\server\tests\test_anchor.py`

**Interfaces:**
- Consumes: `RawSequence`, `FACE_NOSE`, `FACE_CHEEK_A`, `FACE_CHEEK_B` (Task 2).
- Produces: `FACEBOX_TO_HEAD: float` (constante calibrable), `class AnchorError(ValueError)`, `frame_anchor(raw, t) -> tuple[float, float, float] | None` (cx, cy, escala en px), `head_anchor(raw) -> np.ndarray (T,3)`.

- [ ] **Step 1: Escribir los tests**

```python
# D:/Ingenium/server/tests/test_anchor.py
import numpy as np
import pytest

from lsm.anchor import FACEBOX_TO_HEAD, AnchorError, frame_anchor, head_anchor
from lsm.schema import RawSequence
from tests.conftest import raw_with_head


def test_pose_anchor_uses_nose_and_ear_distance():
    raw = raw_with_head(T=3, head=(320, 100), head_w=30)
    cx, cy, s = frame_anchor(raw, 0)
    assert (cx, cy) == pytest.approx((320, 100)) and s == pytest.approx(30)


def test_face_mesh_has_priority_over_pose():
    raw = raw_with_head(T=1, head=(320, 100), head_w=30)
    raw.face[0, 0] = [300, 90, 0]
    raw.face[0, 1] = [280, 95, 0]
    raw.face[0, 2] = [320, 95, 0]
    assert frame_anchor(raw, 0) == pytest.approx((300, 90, 40))


def test_low_visibility_pose_is_ignored_and_face_box_is_used():
    raw = raw_with_head(T=1)
    raw.pose[0, :, 3] = 0.1
    raw.face_box[0] = [100, 50, 140, 100]
    cx, cy, s = frame_anchor(raw, 0)
    assert (cx, cy) == pytest.approx((120, 75)) and s == pytest.approx(40 * FACEBOX_TO_HEAD)


def test_missing_frames_take_median():
    raw = raw_with_head(T=4, head=(320, 100), head_w=30)
    raw.pose[2] = np.nan
    a = head_anchor(raw)
    assert a.shape == (4, 3)
    np.testing.assert_allclose(a[2], [320, 100, 30])


def test_no_anchor_anywhere_raises():
    raw = RawSequence.empty(3, 640, 480)
    with pytest.raises(AnchorError):
        head_anchor(raw)
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_anchor.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.anchor'`

- [ ] **Step 3: Implementar `anchor.py`**

```python
# D:/Ingenium/server/lsm/anchor.py
"""Referencia corporal = la cabeza (centro y ancho en px), igual para todas las fuentes."""
from __future__ import annotations

import numpy as np

from lsm.schema import FACE_CHEEK_A, FACE_CHEEK_B, FACE_NOSE, RawSequence

# ancho de cabeza ≈ ancho del bloque pixelado × este factor (calibrar con training/calibrate_facebox.py)
FACEBOX_TO_HEAD = 0.85
POSE_NOSE, POSE_EAR_A, POSE_EAR_B = 0, 7, 8
MIN_VIS = 0.5


class AnchorError(ValueError):
    pass


def frame_anchor(raw: RawSequence, t: int) -> tuple[float, float, float] | None:
    f = raw.face[t]
    if not np.isnan(f[FACE_NOSE, 0]) and not np.isnan(f[FACE_CHEEK_A, 0]) and not np.isnan(f[FACE_CHEEK_B, 0]):
        s = float(np.linalg.norm(f[FACE_CHEEK_A, :2] - f[FACE_CHEEK_B, :2]))
        if s > 1e-3:
            return float(f[FACE_NOSE, 0]), float(f[FACE_NOSE, 1]), s
    p = raw.pose[t]
    if not np.isnan(p[POSE_NOSE, 0]) and min(p[POSE_NOSE, 3], p[POSE_EAR_A, 3], p[POSE_EAR_B, 3]) > MIN_VIS:
        s = float(np.linalg.norm(p[POSE_EAR_A, :2] - p[POSE_EAR_B, :2]))
        if s > 1e-3:
            return float(p[POSE_NOSE, 0]), float(p[POSE_NOSE, 1]), s
    b = raw.face_box[t]
    if not np.isnan(b[0]) and b[2] > b[0]:
        return float((b[0] + b[2]) / 2), float((b[1] + b[3]) / 2), float((b[2] - b[0]) * FACEBOX_TO_HEAD)
    return None


def head_anchor(raw: RawSequence) -> np.ndarray:
    out = np.full((raw.T, 3), np.nan, np.float32)
    for t in range(raw.T):
        a = frame_anchor(raw, t)
        if a is not None:
            out[t] = a
    ok = ~np.isnan(out[:, 0])
    if not ok.any():
        raise AnchorError(f"sin referencia de cabeza en {raw.sample_id}")
    out[~ok] = np.median(out[ok], axis=0)
    return out
```

- [ ] **Step 4: Correr los tests**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_anchor.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/anchor.py server/tests/test_anchor.py
git commit -m "feat(lsm): referencia de la cabeza con prioridad malla > pose > bloque de cara

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Normalización y asignación de manos (`normalize.py`)

**Files:**
- Create: `D:\Ingenium\server\lsm\normalize.py`
- Test: `D:\Ingenium\server\tests\test_normalize.py`

**Interfaces:**
- Consumes: `RawSequence` (Task 2), `head_anchor` (Task 3).
- Produces: `NormSequence` (dataclass): `hands (T,2,21,3)` float32 en **unidades de cabeza** con origen en el centro de la cabeza (ausente = 0), `present (T,2)` bool, `sample_id`, `signer`; `NormSequence.save(path)`, `NormSequence.load(path)`; `normalize(raw) -> NormSequence`.

- [ ] **Step 1: Escribir los tests**

```python
# D:/Ingenium/server/tests/test_normalize.py
import numpy as np
import pytest

from lsm.normalize import NormSequence, normalize
from tests.conftest import make_hand, raw_with_head


def test_units_are_head_widths_from_head_center():
    h = make_hand(wrist=(320 - 60, 100 + 90), size=30)  # 2 cabezas a la izq., 3 abajo
    raw = raw_with_head(T=1, head=(320, 100), head_w=30, hands_px=[[h]])
    n = normalize(raw)
    assert n.present[0].tolist() == [True, False]
    np.testing.assert_allclose(n.hands[0, 0, 0, :2], [-2.0, 3.0], atol=1e-5)


def test_two_hands_sorted_by_image_x():
    left = make_hand(wrist=(250, 200), size=30)
    right = make_hand(wrist=(400, 200), size=30)
    raw = raw_with_head(T=1, hands_px=[[right, left]])  # orden de detección invertido
    n = normalize(raw)
    assert n.hands[0, 0, 0, 0] < n.hands[0, 1, 0, 0]
    assert n.present[0].all()


def test_single_hand_keeps_slot_by_continuity_when_crossing_midline():
    frames = [[make_hand(wrist=(300, 200), size=30)],   # izq. del centro → slot 0
              [make_hand(wrist=(335, 200), size=30)]]   # cruza el centro, sigue siendo la misma mano
    raw = raw_with_head(T=2, head=(320, 100), hands_px=frames)
    n = normalize(raw)
    assert n.present[:, 0].all() and not n.present[:, 1].any()


def test_absent_hands_are_zero():
    raw = raw_with_head(T=2)
    n = normalize(raw)
    assert not n.present.any() and (n.hands == 0).all()


def test_norm_roundtrip(tmp_path):
    raw = raw_with_head(T=2, hands_px=[[make_hand((300, 200), 30)], []])
    n = normalize(raw)
    n.save(tmp_path / "n.npz")
    m = NormSequence.load(tmp_path / "n.npz")
    np.testing.assert_array_equal(m.hands, n.hands)
    np.testing.assert_array_equal(m.present, n.present)
    assert (m.sample_id, m.signer) == (n.sample_id, n.signer)
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_normalize.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.normalize'`

- [ ] **Step 3: Implementar `normalize.py`**

```python
# D:/Ingenium/server/lsm/normalize.py
"""Landmarks en unidades de cabeza y asignación estable de manos a slots.
Slot 0 = lado izquierdo de la imagen (mano derecha del signante); slot 1 = lado derecho."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lsm.anchor import head_anchor
from lsm.schema import RawSequence


@dataclass
class NormSequence:
    hands: np.ndarray    # (T,2,21,3) unidades de cabeza; ausente = 0
    present: np.ndarray  # (T,2) bool
    sample_id: str = ""
    signer: str = ""

    @property
    def T(self) -> int:
        return int(self.hands.shape[0])

    def save(self, path: str | Path) -> None:
        np.savez_compressed(path, hands=self.hands, present=self.present,
                            meta=np.array(json.dumps({"sample_id": self.sample_id, "signer": self.signer})))

    @staticmethod
    def load(path: str | Path) -> "NormSequence":
        with np.load(path) as z:
            return NormSequence(hands=z["hands"], present=z["present"], **json.loads(str(z["meta"])))


def normalize(raw: RawSequence) -> NormSequence:
    anchor = head_anchor(raw)
    T = raw.T
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    last_wrist: list[np.ndarray | None] = [None, None]
    for t in range(T):
        cx, cy, s = anchor[t]
        dets = []
        for h in raw.hands[t]:
            if np.isnan(h[0, 0]):
                continue
            n = h.astype(np.float32).copy()
            n[:, 0] = (n[:, 0] - cx) / s
            n[:, 1] = (n[:, 1] - cy) / s
            n[:, 2] = n[:, 2] / s
            dets.append(n)
        if len(dets) >= 2:
            dets = sorted(dets[:2], key=lambda d: d[0, 0])
            slots = [0, 1]
        elif len(dets) == 1:
            w = dets[0][0, :2]
            known = [(k, np.linalg.norm(w - last_wrist[k][:2])) for k in (0, 1) if last_wrist[k] is not None]
            slots = [min(known, key=lambda kv: kv[1])[0]] if known else [0 if w[0] < 0 else 1]
        else:
            slots = []
        for d, k in zip(dets, slots):
            hands[t, k] = d
            present[t, k] = True
            last_wrist[k] = d[0]
    return NormSequence(hands=hands, present=present, sample_id=raw.sample_id, signer=raw.signer)
```

- [ ] **Step 4: Correr los tests**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_normalize.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/normalize.py server/tests/test_normalize.py
git commit -m "feat(lsm): normalización en unidades de cabeza y slots de mano estables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Características (`features.py`)

**Files:**
- Create: `D:\Ingenium\server\lsm\features.py`
- Test: `D:\Ingenium\server\tests\test_features.py`

**Interfaces:**
- Consumes: `NormSequence` (Task 4).
- Produces:
  - Constantes `T_OUT=16`, `HAND_DIM=72`, `F_DIM=150`, `REST_Y=3.5`, `FINGERS=((1,4),(5,8),(9,12),(13,16),(17,20))`.
  - `finger_flexion(hand: (21,3)) -> np.ndarray (5,)` en grados (0 = recto). **El evaluador del Plan 2 usa esta misma función.**
  - `hand_local(hand) -> (21,3)` (origen en la muñeca, escala muñeca→MCP medio).
  - `active_span(norm) -> tuple[int, int]` (inclusivo).
  - `resample(norm, start, end, t_out=T_OUT) -> tuple[hands (t_out,2,21,3), present (t_out,2)]`.
  - `featurize(norm, t_out=T_OUT) -> np.ndarray (t_out, F_DIM)` float32. Diseño por slot `s` (offset `s*72`): `[present(1), muñeca xyz(3), mano local 21×3 (63), flexión/180 (5)]`; columnas 144–149: velocidad de la muñeca del slot 0 (3) y del slot 1 (3).

- [ ] **Step 1: Escribir los tests**

```python
# D:/Ingenium/server/tests/test_features.py
import numpy as np
import pytest

from lsm.features import F_DIM, T_OUT, active_span, featurize, finger_flexion, hand_local, resample
from lsm.normalize import NormSequence
from tests.conftest import make_hand


def seq(T, slot0=None, slot1=None):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for s, spec in ((0, slot0), (1, slot1)):
        if spec is None:
            continue
        for t in range(T):
            h = spec(t)
            if h is not None:
                hands[t, s] = h
                present[t, s] = True
    return NormSequence(hands=hands, present=present, sample_id="x", signer="t")


def test_finger_flexion_matches_synthetic_angles():
    h = make_hand(flex=(0, 30, 60, 90, 120))
    np.testing.assert_allclose(finger_flexion(h), [0, 30, 60, 90, 120], atol=1e-3)


def test_hand_local_origin_and_scale():
    h = make_hand(wrist=(5, 7), size=3)
    loc = hand_local(h)
    np.testing.assert_allclose(loc[0], 0, atol=1e-6)
    assert np.linalg.norm(loc[9]) == pytest.approx(1.0)


def test_active_span_ignores_rest_frames():
    up = lambda t: make_hand(wrist=(0, 1.0), size=1)
    rest = lambda t: make_hand(wrist=(0, 5.0), size=1)
    n = seq(6, slot0=lambda t: up(t) if 2 <= t <= 3 else rest(t))
    assert active_span(n) == (1, 4)  # ±1 cuadro de margen


def test_active_span_without_activity_is_whole_sequence():
    n = seq(4)
    assert active_span(n) == (0, 3)


def test_resample_interpolates_and_keeps_presence():
    n = seq(3, slot0=lambda t: make_hand(wrist=(float(t), 0.0), size=1))
    hands, present = resample(n, 0, 2, t_out=5)
    assert hands.shape == (5, 2, 21, 3) and present[:, 0].all() and not present[:, 1].any()
    np.testing.assert_allclose(hands[:, 0, 0, 0], [0, 0.5, 1, 1.5, 2], atol=1e-5)
    assert (hands[:, 1] == 0).all()


def test_featurize_shape_and_layout():
    n = seq(10, slot0=lambda t: make_hand(wrist=(0.1 * t, 1.0), size=1, flex=(0, 90, 0, 0, 0)))
    f = featurize(n)
    assert f.shape == (T_OUT, F_DIM) and f.dtype == np.float32
    assert (f[:, 0] == 1).all() and (f[:, 72] == 0).all()
    assert f[0, 68] == pytest.approx(0.5, abs=1e-3)       # flexión del índice = 90/180
    assert (f[:, 72:144] == 0).all() and (f[:, 147:150] == 0).all()
    assert f[5, 144] > 0                                   # la muñeca se mueve a +x
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_features.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.features'`

- [ ] **Step 3: Implementar `features.py`**

```python
# D:/Ingenium/server/lsm/features.py
"""Características por cuadro, compartidas por el entrenamiento y el servidor en vivo."""
from __future__ import annotations

import numpy as np

from lsm.normalize import NormSequence

T_OUT = 16
HAND_DIM = 72
F_DIM = 2 * HAND_DIM + 6
REST_Y = 3.5  # muñeca más abajo que 3.5 anchos de cabeza bajo la nariz = reposo
FINGERS = ((1, 4), (5, 8), (9, 12), (13, 16), (17, 20))  # (base, punta): pulgar..meñique


def _angle(v1: np.ndarray, v2: np.ndarray) -> float:
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if n1 < 1e-9 or n2 < 1e-9:
        return 0.0
    c = float(np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0))
    return float(np.degrees(np.arccos(c)))


def finger_flexion(hand: np.ndarray) -> np.ndarray:
    """Ángulo entre (base − muñeca) y (punta − base) por dedo. 0° = recto."""
    return np.array([_angle(hand[b] - hand[0], hand[tip] - hand[b]) for b, tip in FINGERS], np.float32)


def hand_local(hand: np.ndarray) -> np.ndarray:
    loc = hand - hand[0]
    s = np.linalg.norm(loc[9])
    return (loc / s if s > 1e-9 else loc).astype(np.float32)


def active_span(norm: NormSequence, pad: int = 1) -> tuple[int, int]:
    wrist_y = norm.hands[:, :, 0, 1]
    active = (norm.present & (wrist_y < REST_Y)).any(axis=1)
    idx = np.flatnonzero(active)
    if idx.size == 0:
        return 0, norm.T - 1
    return max(0, int(idx[0]) - pad), min(norm.T - 1, int(idx[-1]) + pad)


def resample(norm: NormSequence, start: int, end: int, t_out: int = T_OUT):
    src = np.arange(start, end + 1)
    q = np.linspace(start, end, t_out)
    hands = np.zeros((t_out, 2, 21, 3), np.float32)
    present = np.zeros((t_out, 2), bool)
    for s in (0, 1):
        pres = norm.present[start:end + 1, s]
        present[:, s] = np.interp(q, src, pres.astype(np.float32)) >= 0.5
        if pres.any():
            ts = src[pres]
            vals = norm.hands[start:end + 1][pres, s].reshape(len(ts), -1)
            cols = [np.interp(q, ts, vals[:, c]) for c in range(vals.shape[1])]
            hands[:, s] = np.stack(cols, axis=1).reshape(t_out, 21, 3)
    hands[~present] = 0
    return hands, present


def featurize(norm: NormSequence, t_out: int = T_OUT) -> np.ndarray:
    start, end = active_span(norm)
    hands, present = resample(norm, start, end, t_out)
    f = np.zeros((t_out, F_DIM), np.float32)
    for s in (0, 1):
        o = s * HAND_DIM
        for t in range(t_out):
            if not present[t, s]:
                continue
            h = hands[t, s]
            f[t, o] = 1.0
            f[t, o + 1:o + 4] = h[0]
            f[t, o + 4:o + 67] = hand_local(h).ravel()
            f[t, o + 67:o + 72] = finger_flexion(h) / 180.0
        w = hands[:, s, 0]
        vel = np.diff(w, axis=0, prepend=w[:1])
        both = present[:, s] & np.concatenate([[False], present[:-1, s]])
        vel[~both] = 0
        f[:, 2 * HAND_DIM + 3 * s:2 * HAND_DIM + 3 * s + 3] = vel
    return f
```

- [ ] **Step 4: Correr los tests**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_features.py -v`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/features.py server/tests/test_features.py
git commit -m "feat(lsm): flexión por dedo, recorte, remuestreo y vector de 150 características

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Aumentación (`augment.py`)

**Files:**
- Create: `D:\Ingenium\server\lsm\augment.py`
- Test: `D:\Ingenium\server\tests\test_augment.py`

**Interfaces:**
- Consumes: `NormSequence` (Task 4).
- Produces: `augment(norm, rng: np.random.Generator, p_mirror=0.3) -> NormSequence` (nunca modifica la entrada).

- [ ] **Step 1: Escribir los tests**

```python
# D:/Ingenium/server/tests/test_augment.py
import numpy as np

from lsm.augment import augment
from lsm.normalize import NormSequence
from tests.conftest import make_hand


def one_hand_seq(T=10):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for t in range(T):
        hands[t, 0] = make_hand(wrist=(-1.0, 2.0), size=1)
        present[t, 0] = True
    return NormSequence(hands, present, "x", "t")


def test_does_not_mutate_input_and_keeps_meta():
    n = one_hand_seq()
    before = n.hands.copy()
    a = augment(n, np.random.default_rng(0))
    np.testing.assert_array_equal(n.hands, before)
    assert (a.sample_id, a.signer) == ("x", "t")
    assert 8 <= a.T <= 10


def test_mirror_swaps_slots_and_flips_x():
    n = one_hand_seq()
    a = augment(n, np.random.default_rng(1), p_mirror=1.0)
    assert a.present[:, 1].sum() >= a.T - 2 and not a.present[:, 0].any()
    assert np.median(a.hands[a.present[:, 1], 1, 0, 0]) > 0


def test_absent_stays_zero():
    n = one_hand_seq()
    a = augment(n, np.random.default_rng(2), p_mirror=0.0)
    assert (a.hands[~a.present] == 0).all()
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_augment.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.augment'`

- [ ] **Step 3: Implementar `augment.py`**

```python
# D:/Ingenium/server/lsm/augment.py
"""Aumentación para compensar ~10–22 personas por seña."""
from __future__ import annotations

import numpy as np

from lsm.normalize import NormSequence


def augment(norm: NormSequence, rng: np.random.Generator, p_mirror: float = 0.3) -> NormSequence:
    h = norm.hands.copy()
    p = norm.present.copy()
    T = h.shape[0]
    if T >= 4:  # recorte temporal (≥85 %)
        n = max(2, int(round(T * rng.uniform(0.85, 1.0))))
        s0 = int(rng.integers(0, T - n + 1))
        h, p = h[s0:s0 + n], p[s0:s0 + n]
    if rng.random() < p_mirror:  # espejo: persona zurda
        h[..., 0] *= -1
        h, p = h[:, ::-1].copy(), p[:, ::-1].copy()
    ang = np.radians(rng.uniform(-15, 15))
    R = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]], np.float32)
    scale = rng.uniform(0.85, 1.15)
    shift = rng.uniform(-0.3, 0.3, size=2).astype(np.float32)
    h[..., :2] = (h[..., :2] @ R.T) * scale + shift
    h[..., 2] *= scale
    h += rng.normal(0, 0.02, h.shape).astype(np.float32)
    p &= ~(rng.random(p.shape) < 0.05)  # manos perdidas
    h[~p] = 0
    return NormSequence(hands=h.astype(np.float32), present=p, sample_id=norm.sample_id, signer=norm.signer)
```

- [ ] **Step 4: Correr los tests**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_augment.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/augment.py server/tests/test_augment.py
git commit -m "feat(lsm): aumentación (recorte, espejo, rotación, escala, ruido, pérdidas)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Vocabulario unificado (`vocab.py`)

**Files:**
- Create: `D:\Ingenium\server\lsm\vocab.py`
- Test: `D:\Ingenium\server\tests\test_vocab.py`

**Interfaces:**
- Produces: `MENDELEY_ES: dict[int, str]` (1–249), `canonical(name) -> str`, `mendeley_category(word_id) -> str`, `lookup(dataset, source_label) -> str` (`dataset` ∈ `{"mendeley", "glosses"}`; para Mendeley `source_label` es el id de 3 dígitos, p. ej. `"036"`), `build_vocab(glosses_names) -> list[dict]` (llaves `gloss`, `category`, `sources`), `write_vocab_csv(rows, path)`.

- [ ] **Step 1: Escribir los tests**

```python
# D:/Ingenium/server/tests/test_vocab.py
from lsm.vocab import MENDELEY_ES, build_vocab, canonical, lookup, mendeley_category


def test_mendeley_has_249_unique_canonical_glosses():
    assert sorted(MENDELEY_ES) == list(range(1, 250))
    assert len(set(MENDELEY_ES.values())) == 249
    assert all(g == canonical(g) for g in MENDELEY_ES.values())


def test_canonical_strips_accents_keeps_enye():
    assert canonical("Año próximo") == "AÑO_PROXIMO"
    assert canonical("corazón") == "CORAZON"


def test_lookup_both_datasets():
    assert lookup("mendeley", "036") == "ESCUELA"
    assert lookup("mendeley", "238") == "OAXACA"
    assert lookup("glosses", "POR_FAVOR") == "POR_FAVOR"


def test_overlaps_are_merged():
    rows = build_vocab(["HOLA", "AYUDA", "YO", "DOCTOR"])
    by = {r["gloss"]: r for r in rows}
    assert by["AYUDA"]["sources"] == "mendeley:185;glosses:AYUDA"
    assert by["HOLA"]["sources"] == "glosses:HOLA"
    assert len(rows) == 249 + 1  # solo HOLA es nueva


def test_categories():
    assert mendeley_category(36) == "escuela"
    assert mendeley_category(170) == "pronombres"
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_vocab.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.vocab'`

- [ ] **Step 3: Implementar `vocab.py`**

```python
# D:/Ingenium/server/lsm/vocab.py
"""Glosas canónicas en español y mapeo de ambos datasets."""
from __future__ import annotations

import csv
import unicodedata
from pathlib import Path

_M = """BUENOS_DIAS BUENAS_TARDES BUENAS_NOCHES GRACIAS POR_FAVOR NOS_VEMOS ADIOS
DIA HORA SEMANA MINUTO SEGUNDO
LUNES MARTES MIERCOLES JUEVES VIERNES SABADO DOMINGO
ENERO FEBRERO MARZO ABRIL MAYO JUNIO JULIO AGOSTO SEPTIEMBRE OCTUBRE NOVIEMBRE DICIEMBRE AÑO
CALIFICACION LECCION CUADERNO ESCUELA LAPIZ LEER LSM EXAMEN ESCRIBIR GOMA SACAPUNTAS REGLA COLORES
ABUELA ABUELO ESPOSA ESPOSO FAMILIA HERMANA HERMANO HIJO HIJA HOMBRE MUJER PAPA MAMA NOVIA NOVIO PRIMA PRIMO SOBRINA SOBRINO TIA TIO
CUARTO BAÑO COCINA CAMA CASA ROPERO CORTINA CUNA TECHO PISO ESCALERAS ESCOBA LAMPARA MESA PARED PASILLO VIDRIO VENTANA PUERTA
ADULTO JOVEN NIÑO BEBE FEO BONITO MALA_PERSONA SORDO MUDO FUERTE GORDO ALTO BAJO BUENA_PERSONA CIEGO DEBIL DELGADO
CUCHARA CUCHILLO PLATO VASO COMIDA CENA DESAYUNO TENEDOR SERVILLETA SAL QUIERO_MAS NO_ME_GUSTO
ARETE BLUSA BOTA CAMISA COLLAR GUANTE PANTALON PIJAMA SHORT TRAJE VESTIDO ZAPATOS FALDA ROPA_INTERIOR
BARBA BIGOTE BRAZO BOCA CABELLO CABEZA ROSTRO PIES DIENTES OJOS OREJAS NARIZ OIDO MEJILLA UÑA
AVION BARCO BICICLETA CAMION HELICOPTERO CARRO MOTOCICLETA TAXI TRACTOR TREN METRO AUTOBUS CAMIONETA
AEROPUERTO BIBLIOTECA CENTRO CINE CIRCO EDIFICIO HOSPITAL HOTEL MERCADO MUSEO RESTAURANTE SUPERMERCADO CAFETERIA
YO TU EL ELLA ELLOS ELLAS NOSOTROS NOSOTRAS USTEDES NADIE ALGUIEN
ABRAZAR AMAR ARREGLAR ASUSTAR AYUDA BUSCAR CALLAR CERRAR CREER COMER DETENER DORMIR CACHETADA GUARDAR JUGAR RECOGER LLORAR MENTIR OIR OLVIDAR HACER REIR TIRAR ORDENAR LIMPIAR
ACTOR BOMBEROS DOCTOR MAESTRO MESERO POLICIA PRESIDENTE SECRETARIA CARPINTERO MECANICO ZAPATERO ESTILISTA COSTURERA
AGUASCALIENTES BAJA_CALIFORNIA_NORTE BAJA_CALIFORNIA_SUR CAMPECHE COAHUILA COLIMA CHIAPAS CHIHUAHUA SINALOA DURANGO GUANAJUATO GUERRERO HIDALGO JALISCO MEXICO MICHOACAN MORELOS NAYARIT NUEVO_LEON OAXACA PUEBLA QUERETARO QUINTANA_ROO SAN_LUIS_POTOSI SONORA TABASCO TAMAULIPAS TLAXCALA VERACRUZ YUCATAN ZACATECAS"""
MENDELEY_ES: dict[int, str] = {i + 1: g for i, g in enumerate(_M.split())}

_CATS = ((7, "saludos"), (12, "tiempo"), (19, "dias"), (32, "meses"), (45, "escuela"), (66, "familia"),
         (85, "casa"), (102, "adjetivos"), (114, "cocina"), (128, "ropa"), (143, "cuerpo"), (156, "vehiculos"),
         (169, "lugares"), (180, "pronombres"), (205, "verbos"), (218, "profesiones"), (249, "estados"))
GLOSSES_CATEGORY = "salud_y_frecuentes"


def canonical(name: str) -> str:
    s = name.strip().upper().replace(" ", "_").replace("Ñ", "\0")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return s.replace("\0", "Ñ")


def mendeley_category(word_id: int) -> str:
    for last, cat in _CATS:
        if word_id <= last:
            return cat
    raise ValueError(word_id)


def lookup(dataset: str, source_label: str) -> str:
    if dataset == "mendeley":
        return MENDELEY_ES[int(source_label)]
    if dataset == "glosses":
        return canonical(source_label)
    raise ValueError(dataset)


def build_vocab(glosses_names: list[str]) -> list[dict]:
    rows: dict[str, dict] = {}
    for i, g in MENDELEY_ES.items():
        rows[g] = {"gloss": g, "category": mendeley_category(i), "sources": f"mendeley:{i:03d}"}
    for name in glosses_names:
        g = canonical(name)
        if g in rows:
            rows[g]["sources"] += f";glosses:{name}"
        else:
            rows[g] = {"gloss": g, "category": GLOSSES_CATEGORY, "sources": f"glosses:{name}"}
    return list(rows.values())


def write_vocab_csv(rows: list[dict], path: str | Path) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["gloss", "category", "sources"])
        w.writeheader()
        w.writerows(rows)
```

- [ ] **Step 4: Correr los tests**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_vocab.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add server/lsm/vocab.py server/tests/test_vocab.py
git commit -m "feat(lsm): vocabulario canónico en español para Mendeley y LSM Glosses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Extractor con MediaPipe y bloque de la cara

**Files:**
- Create: `D:\Ingenium\training\download_models.py`
- Create: `D:\Ingenium\training\extract_common.py`
- Test: `D:\Ingenium\server\tests\test_extract_integration.py` (marcado `slow`)

**Interfaces:**
- Consumes: `RawSequence`, `FACE_IDX` (Task 2), `lsm.paths.MP_MODELS` (Task 1).
- Produces:
  - `download_models.py` → `D:/Ingenium/models/mediapipe/{hand_landmarker,pose_landmarker_full,pose_landmarker_heavy,face_landmarker}.task`.
  - `Extractor(video: bool, pose_model: str = "pose_landmarker_full", use_face: bool = True)` con `process(rgb: np.ndarray, raw: RawSequence, t: int, dt_ms: int = 33) -> None` y `close()`.
  - `face_box_from_skin(bgr: np.ndarray) -> np.ndarray (4,)` (NaN si no hay).

- [ ] **Step 1: Escribir `download_models.py` y ejecutarlo** (pedir permiso: 4 archivos desde storage.googleapis.com, ~60 MB en total)

```python
# D:/Ingenium/training/download_models.py
import urllib.request

from lsm.paths import MP_MODELS

URLS = {
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    "pose_landmarker_full.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    "pose_landmarker_heavy.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
}

if __name__ == "__main__":
    MP_MODELS.mkdir(parents=True, exist_ok=True)
    for name, url in URLS.items():
        dst = MP_MODELS / name
        if not dst.exists():
            urllib.request.urlretrieve(url, dst)
        print(name, dst.stat().st_size // 1024, "KB")
```

Run: `source D:/Ingenium/tools/env.sh && python D:/Ingenium/training/download_models.py`
Expected: 4 líneas con tamaños > 1000 KB.

- [ ] **Step 2: Escribir el test de integración (lento)**

```python
# D:/Ingenium/server/tests/test_extract_integration.py
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, "D:/Ingenium/training")
from extract_common import Extractor, face_box_from_skin  # noqa: E402

from lsm.anchor import head_anchor
from lsm.schema import RawSequence

MV = Path("D:/Ingenium/datasets/mendeley_verify/09238")
GV = Path("D:/Ingenium/datasets/lsm_glosses_verify/Mexican Sign Language Glosses/HOLA/HOLA_0.mp4")


@pytest.mark.slow
def test_mendeley_frames_hands_and_face_box():
    files = sorted(MV.glob("*.jpg"))
    raw = RawSequence.empty(len(files), 640, 480)
    ex = Extractor(video=False, pose_model="pose_landmarker_heavy", use_face=False)
    for t, f in enumerate(files):
        bgr = cv2.imread(str(f))
        ex.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), raw, t)
    ex.close()
    hand_frames = (~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1).mean()
    assert hand_frames >= 0.8
    box = face_box_from_skin(cv2.imread(str(files[0])))
    assert not np.isnan(box).any() and 10 < box[2] - box[0] < 120


@pytest.mark.slow
def test_glosses_video_pose_and_anchor():
    cap = cv2.VideoCapture(str(GV))
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(cv2.resize(fr, (960, 544)))
    raw = RawSequence.empty(len(frames), 960, 544, fps=30.0)
    ex = Extractor(video=True)
    for t, fr in enumerate(frames):
        ex.process(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB), raw, t)
    ex.close()
    assert (~np.isnan(raw.pose[:, 0, 0])).mean() >= 0.9
    assert (~np.isnan(raw.face[:, 0, 0])).mean() >= 0.9
    a = head_anchor(raw)
    assert 20 < np.median(a[:, 2]) < 300
```

- [ ] **Step 3: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_extract_integration.py -m slow -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'extract_common'`

- [ ] **Step 4: Implementar `extract_common.py`**

```python
# D:/Ingenium/training/extract_common.py
"""Envoltorio de MediaPipe Tasks (0.10.14) que llena un RawSequence cuadro por cuadro."""
from __future__ import annotations

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from lsm.paths import MP_MODELS
from lsm.schema import FACE_IDX, RawSequence


class Extractor:
    def __init__(self, video: bool, pose_model: str = "pose_landmarker_full", use_face: bool = True):
        mode = vision.RunningMode.VIDEO if video else vision.RunningMode.IMAGE
        opt = lambda name: BaseOptions(model_asset_path=str(MP_MODELS / f"{name}.task"))
        self.video = video
        self._ts = 0
        self.hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=opt("hand_landmarker"), running_mode=mode, num_hands=2,
            min_hand_detection_confidence=0.3, min_hand_presence_confidence=0.3, min_tracking_confidence=0.3))
        self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=opt(pose_model), running_mode=mode,
            min_pose_detection_confidence=0.3, min_pose_presence_confidence=0.3, min_tracking_confidence=0.3))
        self.face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=opt("face_landmarker"), running_mode=mode, num_faces=1,
            min_face_detection_confidence=0.3)) if use_face else None

    def _detect(self, model, img):
        return model.detect_for_video(img, self._ts) if self.video else model.detect(img)

    def process(self, rgb: np.ndarray, raw: RawSequence, t: int, dt_ms: int = 33) -> None:
        H, W = rgb.shape[:2]
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        if self.video:
            self._ts += dt_ms
        h = self._detect(self.hands, img)
        for k, lm in enumerate(h.hand_landmarks[:2]):
            raw.hands[t, k] = [[q.x * W, q.y * H, q.z * W] for q in lm]
        p = self._detect(self.pose, img)
        if p.pose_landmarks:
            raw.pose[t] = [[q.x * W, q.y * H, q.z * W, q.visibility] for q in p.pose_landmarks[0]]
        if self.face is not None:
            f = self._detect(self.face, img)
            if f.face_landmarks:
                fl = f.face_landmarks[0]
                raw.face[t] = [[fl[i].x * W, fl[i].y * H, fl[i].z * W] for i in FACE_IDX]

    def close(self) -> None:
        for m in (self.hands, self.pose, self.face):
            if m is not None:
                m.close()


def face_box_from_skin(bgr: np.ndarray) -> np.ndarray:
    """Bloque pixelado de la cara (Mendeley): mayor región color piel en la mitad superior.
    Usar en cuadros de reposo (primero y último), cuando las manos están abajo."""
    H, W = bgr.shape[:2]
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    mask = cv2.inRange(ycrcb, (0, 135, 85), (255, 180, 135))
    mask[H // 2:] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    best = None
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 0.001 * H * W or not 0.5 < w / max(h, 1) < 2.0:
            continue
        if best is None or area > best[4]:
            best = (x, y, w, h, area)
    if best is None:
        return np.full(4, np.nan, np.float32)
    x, y, w, h, _ = best
    return np.array([x, y, x + w, y + h], np.float32)
```

- [ ] **Step 5: Correr el test de integración**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_extract_integration.py -m slow -v`
Expected: 2 PASS. Si `face_box_from_skin` falla, ajustar los rangos Cr/Cb mirando `09238_sheet.jpg` y volver a correr (no cambiar el test).

- [ ] **Step 6: Commit**

```bash
cd D:/Ingenium && git add training/download_models.py training/extract_common.py server/tests/test_extract_integration.py
git commit -m "feat(training): extractor MediaPipe y detección del bloque de la cara

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Extracción de Mendeley (desde el zip, sin descomprimir)

**Files:**
- Create: `D:\Ingenium\training\extract_mendeley.py`

**Interfaces:**
- Consumes: `Extractor`, `face_box_from_skin` (Task 8), `RawSequence` (Task 2).
- Produces: `D:/Ingenium/datasets/raw_landmarks/mendeley/m{SS}_{WWW}.npz` y `D:/Ingenium/datasets/raw_landmarks/index_mendeley.csv` con columnas `sample_id,dataset,source_label,signer,path,n_frames,hand_ratio`.

- [ ] **Step 1: Implementar el script**

```python
# D:/Ingenium/training/extract_mendeley.py
"""Mendeley MSLwords1 → RawSequence por muestra. Lee los JPG directo del zip."""
from __future__ import annotations

import csv
import os
import zipfile
from collections import defaultdict
from multiprocessing import Pool

import cv2
import numpy as np

from extract_common import Extractor, face_box_from_skin
from lsm.paths import DATASETS, RAW_LANDMARKS
from lsm.schema import RawSequence

ZIP = DATASETS / "mendeley" / "6rj76z6y3n-1.zip"
OUT = RAW_LANDMARKS / "mendeley"
_zip = None
_ex = None


def _init():
    global _zip, _ex
    _zip = zipfile.ZipFile(ZIP)
    _ex = Extractor(video=False, pose_model="pose_landmarker_heavy", use_face=False)


def _work(item):
    folder, names = item  # folder = "SSWWW"
    signer, word = folder[:2], folder[2:]
    sid = f"m{signer}_{word}"
    dst = OUT / f"{sid}.npz"
    frames = [cv2.imdecode(np.frombuffer(_zip.read(n), np.uint8), cv2.IMREAD_COLOR) for n in sorted(names)]
    H, W = frames[0].shape[:2]
    raw = RawSequence.empty(len(frames), W, H, fps=0.0, sample_id=sid, dataset="mendeley",
                            source_label=word, signer=f"m{signer}")
    for t, bgr in enumerate(frames):
        _ex.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), raw, t)
    boxes = [face_box_from_skin(frames[i]) for i in {0, len(frames) - 1}]
    boxes = [b for b in boxes if not np.isnan(b).any()]
    if boxes:
        raw.face_box[:] = np.median(np.stack(boxes), axis=0)
    raw.save(dst)
    hand_ratio = float((~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1).mean())
    return {"sample_id": sid, "dataset": "mendeley", "source_label": word, "signer": f"m{signer}",
            "path": str(dst), "n_frames": raw.T, "hand_ratio": round(hand_ratio, 3)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    groups = defaultdict(list)
    with zipfile.ZipFile(ZIP) as z:
        for n in z.namelist():
            parts = n.split("/")
            if n.lower().endswith(".jpg") and len(parts) >= 4:
                groups[parts[-2]].append(n)
    items = sorted(groups.items())
    print("muestras:", len(items))
    rows = []
    with Pool(max(1, (os.cpu_count() or 4) - 2), initializer=_init) as pool:
        for i, row in enumerate(pool.imap_unordered(_work, items, chunksize=4)):
            rows.append(row)
            if i % 100 == 0:
                print(i, row["sample_id"], row["hand_ratio"], flush=True)
    rows.sort(key=lambda r: r["sample_id"])
    with open(RAW_LANDMARKS / "index_mendeley.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print("listo:", len(rows), "hand_ratio medio:", np.mean([r["hand_ratio"] for r in rows]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Correr en segundo plano** (~15–40 min según los núcleos)

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/training && python extract_mendeley.py > D:/Ingenium/tools/tmp/extract_mendeley.log 2>&1`
Expected (al final del log): `listo: 2447 hand_ratio medio: 0.9…` (≥ 0.85).

- [ ] **Step 3: Verificación rápida**

Run:
```bash
source D:/Ingenium/tools/env.sh && python -c "
import csv, numpy as np
r = list(csv.DictReader(open('D:/Ingenium/datasets/raw_landmarks/index_mendeley.csv', encoding='utf-8')))
print(len(r), sum(float(x['hand_ratio']) < 0.5 for x in r), 'muestras con <50% de manos')
from lsm.schema import RawSequence
raw = RawSequence.load(r[0]['path']); print(raw.sample_id, raw.T, np.isnan(raw.face_box).all())"
```
Expected: `2447 N muestras con <50% de manos` con N < 150, y `False` (sí hay bloque de cara).

- [ ] **Step 4: Commit**

```bash
cd D:/Ingenium && git add training/extract_mendeley.py
git commit -m "feat(training): extracción de landmarks de Mendeley desde el zip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Extracción de LSM Glosses (videos)

**Files:**
- Create: `D:\Ingenium\training\extract_glosses.py`

**Interfaces:**
- Consumes: `Extractor` (Task 8), `RawSequence` (Task 2).
- Produces: `D:/Ingenium/datasets/raw_landmarks/glosses/g{SS}_{GLOSA}.npz` y `D:/Ingenium/datasets/raw_landmarks/index_glosses.csv` (mismas columnas que Task 9).

- [ ] **Step 1: Implementar el script**

```python
# D:/Ingenium/training/extract_glosses.py
"""LSM Glosses (.7z) → videos → RawSequence por video (≤30 fps, 960 px de ancho)."""
from __future__ import annotations

import csv
import os
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np
import py7zr

from extract_common import Extractor
from lsm.paths import DATASETS, RAW_LANDMARKS
from lsm.schema import RawSequence

ARCHIVE = DATASETS / "lsm_glosses" / "lsm_glosses.7z"
EXTRACTED = DATASETS / "lsm_glosses" / "extracted"
OUT = RAW_LANDMARKS / "glosses"
TARGET_W = 960


def _work(path_str: str):
    path = Path(path_str)
    gloss, subj = path.stem.rsplit("_", 1)
    sid = f"g{int(subj):02d}_{gloss}"
    dst = OUT / f"{sid}.npz"
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps / 30.0))
    frames = []
    i = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if i % step == 0:
            h, w = fr.shape[:2]
            frames.append(cv2.resize(fr, (TARGET_W, int(round(h * TARGET_W / w)))))
        i += 1
    cap.release()
    if not frames:
        return None
    H, W = frames[0].shape[:2]
    raw = RawSequence.empty(len(frames), W, H, fps=fps / step, sample_id=sid, dataset="glosses",
                            source_label=gloss, signer=f"g{int(subj):02d}")
    ex = Extractor(video=True)  # uno por video: el seguimiento no debe cruzar videos
    dt = int(round(1000 * step / fps))
    for t, bgr in enumerate(frames):
        ex.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), raw, t, dt_ms=dt)
    ex.close()
    raw.save(dst)
    hand_ratio = float((~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1).mean())
    return {"sample_id": sid, "dataset": "glosses", "source_label": gloss, "signer": raw.signer,
            "path": str(dst), "n_frames": raw.T, "hand_ratio": round(hand_ratio, 3)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if not EXTRACTED.exists():
        print("descomprimiendo", ARCHIVE)
        with py7zr.SevenZipFile(ARCHIVE) as z:
            z.extractall(EXTRACTED)
    videos = sorted(str(p) for p in EXTRACTED.rglob("*.mp4"))
    print("videos:", len(videos))
    rows = []
    with Pool(max(1, (os.cpu_count() or 4) - 2)) as pool:
        for i, row in enumerate(pool.imap_unordered(_work, videos, chunksize=2)):
            if row:
                rows.append(row)
            if i % 50 == 0:
                print(i, row and row["sample_id"], flush=True)
    rows.sort(key=lambda r: r["sample_id"])
    with open(RAW_LANDMARKS / "index_glosses.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print("listo:", len(rows), "hand_ratio medio:", np.mean([r["hand_ratio"] for r in rows]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Correr en segundo plano** (descompresión ~5 min + extracción ~1–2 h; se puede correr en paralelo con la Task 11)

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/training && python extract_glosses.py > D:/Ingenium/tools/tmp/extract_glosses.log 2>&1`
Expected (al final del log): `listo: 1415 hand_ratio medio: 0.8…` (≥ 0.75; los videos tienen reposo al inicio y al final).

- [ ] **Step 3: Commit**

```bash
cd D:/Ingenium && git add training/extract_glosses.py
git commit -m "feat(training): extracción de landmarks de LSM Glosses desde video

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Calibrar `FACEBOX_TO_HEAD`

**Files:**
- Create: `D:\Ingenium\training\calibrate_facebox.py`
- Modify: `D:\Ingenium\server\lsm\anchor.py` (constante `FACEBOX_TO_HEAD`)

**Interfaces:**
- Consumes: `index_mendeley.csv` (Task 9), `RawSequence`.

- [ ] **Step 1: Implementar el script**

```python
# D:/Ingenium/training/calibrate_facebox.py
"""Mediana de (distancia entre orejas de la pose) / (ancho del bloque de la cara) en Mendeley."""
import csv

import numpy as np

from lsm.paths import RAW_LANDMARKS
from lsm.schema import RawSequence

ratios = []
for r in csv.DictReader(open(RAW_LANDMARKS / "index_mendeley.csv", encoding="utf-8")):
    raw = RawSequence.load(r["path"])
    bw = raw.face_box[0, 2] - raw.face_box[0, 0]
    if np.isnan(bw) or bw <= 0:
        continue
    for t in range(raw.T):
        p = raw.pose[t]
        if not np.isnan(p[0, 0]) and min(p[7, 3], p[8, 3]) > 0.5:
            ratios.append(np.linalg.norm(p[7, :2] - p[8, :2]) / bw)
print("n =", len(ratios), "mediana =", round(float(np.median(ratios)), 3),
      "p25/p75 =", np.round(np.percentile(ratios, [25, 75]), 3))
```

- [ ] **Step 2: Ejecutar y actualizar la constante**

Run: `source D:/Ingenium/tools/env.sh && python D:/Ingenium/training/calibrate_facebox.py`
Expected: `n = …` (> 500) y una mediana entre 0.5 y 1.5. Reemplazar `FACEBOX_TO_HEAD = 0.85` en `anchor.py` por la mediana redondeada a 2 decimales. Si `n < 100`, dejar 0.85 y anotarlo en el reporte de la Task 13.

- [ ] **Step 3: Correr todos los tests rápidos**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest -q`
Expected: todos PASS. `test_low_visibility_pose_is_ignored_and_face_box_is_used` usa la constante importada, así que sigue pasando.

- [ ] **Step 4: Commit**

```bash
cd D:/Ingenium && git add training/calibrate_facebox.py server/lsm/anchor.py
git commit -m "feat(training): calibración del factor bloque de cara → ancho de cabeza

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Construcción del dataset (manifest, caché normalizada y splits)

**Files:**
- Create: `D:\Ingenium\training\build_dataset.py`
- Create: `D:\Ingenium\server\lsm\splits.py`
- Test: `D:\Ingenium\server\tests\test_splits.py`

**Interfaces:**
- Consumes: `normalize`, `NormSequence` (Task 4), `lookup`, `build_vocab`, `write_vocab_csv` (Task 7), los índices de las Tasks 9 y 10.
- Produces:
  - `lsm.splits`: `VAL_SIGNERS = {"m03", "g03"}`, `TEST_SIGNERS = {"m02", "g02"}`, `split_of(signer) -> str` ∈ `{"train","val","test"}`.
  - `D:/Ingenium/datasets/processed/norm/<sample_id>.npz` (NormSequence).
  - `D:/Ingenium/datasets/processed/manifest.csv` con `sample_id,gloss,signer,dataset,norm_path,split`.
  - `D:/Ingenium/datasets/processed/vocab.csv`.

- [ ] **Step 1: Escribir el test de splits**

```python
# D:/Ingenium/server/tests/test_splits.py
from lsm.splits import TEST_SIGNERS, VAL_SIGNERS, split_of


def test_split_by_signer():
    assert split_of("m02") == "test" and split_of("g02") == "test"
    assert split_of("m03") == "val" and split_of("g03") == "val"
    assert split_of("g11") == "train"  # la persona sorda se queda en entrenamiento (referencias)
    assert not (VAL_SIGNERS & TEST_SIGNERS)
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_splits.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.splits'`

- [ ] **Step 3: Implementar `splits.py`**

```python
# D:/Ingenium/server/lsm/splits.py
"""Separación por persona: el modelo se mide con signantes que nunca vio."""
VAL_SIGNERS = {"m03", "g03"}
TEST_SIGNERS = {"m02", "g02"}


def split_of(signer: str) -> str:
    if signer in TEST_SIGNERS:
        return "test"
    if signer in VAL_SIGNERS:
        return "val"
    return "train"
```

- [ ] **Step 4: Correr el test**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_splits.py -v`
Expected: PASS

- [ ] **Step 5: Implementar `build_dataset.py`**

```python
# D:/Ingenium/training/build_dataset.py
"""Índices crudos → NormSequence en caché + manifest.csv + vocab.csv."""
import csv
from collections import Counter

from lsm.anchor import AnchorError
from lsm.normalize import normalize
from lsm.paths import PROCESSED, RAW_LANDMARKS
from lsm.schema import RawSequence
from lsm.splits import split_of
from lsm.vocab import build_vocab, lookup, write_vocab_csv

MIN_HAND_RATIO = 0.3


def main():
    norm_dir = PROCESSED / "norm"
    norm_dir.mkdir(parents=True, exist_ok=True)
    rows, skipped = [], Counter()
    glosses_names = set()
    for idx in ("index_mendeley.csv", "index_glosses.csv"):
        for r in csv.DictReader(open(RAW_LANDMARKS / idx, encoding="utf-8")):
            if r["dataset"] == "glosses":
                glosses_names.add(r["source_label"])
            if float(r["hand_ratio"]) < MIN_HAND_RATIO:
                skipped["pocas_manos"] += 1
                continue
            try:
                n = normalize(RawSequence.load(r["path"]))
            except AnchorError:
                skipped["sin_cabeza"] += 1
                continue
            dst = norm_dir / f"{r['sample_id']}.npz"
            n.save(dst)
            rows.append({"sample_id": r["sample_id"], "gloss": lookup(r["dataset"], r["source_label"]),
                         "signer": r["signer"], "dataset": r["dataset"], "norm_path": str(dst),
                         "split": split_of(r["signer"])})
    with open(PROCESSED / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    write_vocab_csv(build_vocab(sorted(glosses_names)), PROCESSED / "vocab.csv")
    print("muestras:", len(rows), "omitidas:", dict(skipped))
    print("por split:", Counter(r["split"] for r in rows))
    print("glosas:", len({r["gloss"] for r in rows}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Ejecutar** (cuando las Tasks 9 y 10 hayan terminado)

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/training && python build_dataset.py`
Expected: `muestras: ~3700–3850`, omitidas < 5 %, `glosas: ~340–346`, y los tres splits con muestras.

- [ ] **Step 7: Commit**

```bash
cd D:/Ingenium && git add server/lsm/splits.py server/tests/test_splits.py training/build_dataset.py
git commit -m "feat(training): manifest, caché normalizada y splits por persona

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Modelo y entrenamiento

**Files:**
- Create: `D:\Ingenium\server\lsm\classifier\__init__.py`
- Create: `D:\Ingenium\server\lsm\classifier\model.py`
- Create: `D:\Ingenium\training\train.py`
- Test: `D:\Ingenium\server\tests\test_model.py`

**Interfaces:**
- Consumes: `featurize`, `F_DIM`, `T_OUT` (Task 5), `augment` (Task 6), `NormSequence` (Task 4), `manifest.csv` (Task 12).
- Produces:
  - `SignTransformer(n_classes, f_dim=F_DIM, t=T_OUT, d=128, layers=3, heads=4, ff=256, dropout=0.2)`; `forward(x: (B,T,F)) -> logits (B,C)`.
  - Checkpoint `D:/Ingenium/models/classifier_v1.pt`: `dict(state_dict, labels: list[str], feat_mean: np.ndarray (F_DIM,), feat_std: np.ndarray (F_DIM,), config: dict)`.
  - Reporte `D:/Ingenium/models/classifier_v1_report.json` (`val_acc`, `test_acc`, `test_top3`, `test_macro_f1`, `n_classes`, `n_train`, `facebox_to_head`) y `D:/Ingenium/models/classifier_v1_per_class.csv`.

- [ ] **Step 1: Escribir los tests del modelo**

```python
# D:/Ingenium/server/tests/test_model.py
import torch

from lsm.classifier.model import SignTransformer
from lsm.features import F_DIM, T_OUT


def test_forward_shape():
    m = SignTransformer(n_classes=7)
    out = m(torch.randn(3, T_OUT, F_DIM))
    assert out.shape == (3, 7)


def test_can_overfit_tiny_batch():
    torch.manual_seed(0)
    m = SignTransformer(n_classes=4, dropout=0.0)
    x = torch.randn(8, T_OUT, F_DIM)
    y = torch.tensor([0, 1, 2, 3, 0, 1, 2, 3])
    opt = torch.optim.AdamW(m.parameters(), lr=1e-3)
    for _ in range(150):
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(m(x), y)
        loss.backward()
        opt.step()
    assert (m(x).argmax(1) == y).all()
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_model.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.classifier'`

- [ ] **Step 3: Implementar `model.py`**

```python
# D:/Ingenium/server/lsm/classifier/__init__.py
```

```python
# D:/Ingenium/server/lsm/classifier/model.py
import torch
from torch import nn

from lsm.features import F_DIM, T_OUT


class SignTransformer(nn.Module):
    def __init__(self, n_classes: int, f_dim: int = F_DIM, t: int = T_OUT, d: int = 128,
                 layers: int = 3, heads: int = 4, ff: int = 256, dropout: float = 0.2):
        super().__init__()
        self.inp = nn.Linear(f_dim, d)
        self.pos = nn.Parameter(torch.zeros(1, t, d))
        layer = nn.TransformerEncoderLayer(d, heads, ff, dropout, batch_first=True, norm_first=True)
        self.enc = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, n_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.enc(self.inp(x) + self.pos)
        return self.head(self.norm(h.mean(dim=1)))
```

- [ ] **Step 4: Correr los tests del modelo**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_model.py -v`
Expected: 2 PASS

- [ ] **Step 5: Implementar `train.py`**

```python
# D:/Ingenium/training/train.py
"""Entrena SignTransformer v1 y reporta métricas con personas no vistas."""
from __future__ import annotations

import argparse
import csv
import json

import numpy as np
import torch
from sklearn.metrics import f1_score

from lsm.anchor import FACEBOX_TO_HEAD
from lsm.augment import augment
from lsm.classifier.model import SignTransformer
from lsm.features import featurize
from lsm.normalize import NormSequence
from lsm.paths import MODELS, PROCESSED


class SignDataset(torch.utils.data.Dataset):
    def __init__(self, items, labels, mean, std, train: bool, seed: int = 0):
        self.items, self.labels, self.mean, self.std, self.train = items, labels, mean, std, train
        self.rng = np.random.default_rng(seed)

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        seq = self.items[i]
        if self.train:
            seq = augment(seq, self.rng)
        x = (featurize(seq) - self.mean) / self.std
        return torch.from_numpy(x.astype(np.float32)), self.labels[i]


def load_split(rows, split, label_idx):
    sel = [r for r in rows if r["split"] == split and r["gloss"] in label_idx]
    return [NormSequence.load(r["norm_path"]) for r in sel], [label_idx[r["gloss"]] for r in sel]


@torch.no_grad()
def predict(model, ds, batch=256):
    model.eval()
    dl = torch.utils.data.DataLoader(ds, batch_size=batch)
    return torch.cat([torch.softmax(model(x), 1) for x, _ in dl]).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=150)
    ap.add_argument("--out", default="classifier_v1")
    args = ap.parse_args()
    torch.manual_seed(0)
    rows = list(csv.DictReader(open(PROCESSED / "manifest.csv", encoding="utf-8")))
    labels = sorted({r["gloss"] for r in rows if r["split"] == "train"})
    li = {g: i for i, g in enumerate(labels)}
    tr_x, tr_y = load_split(rows, "train", li)
    va_x, va_y = load_split(rows, "val", li)
    te_x, te_y = load_split(rows, "test", li)
    feats = np.concatenate([featurize(s) for s in tr_x])
    mean, std = feats.mean(0), feats.std(0) + 1e-6
    train_ds = SignDataset(tr_x, tr_y, mean, std, train=True)
    val_ds = SignDataset(va_x, va_y, mean, std, train=False)
    test_ds = SignDataset(te_x, te_y, mean, std, train=False)
    model = SignTransformer(len(labels))
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=0.05)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, total_steps=args.epochs * (len(train_ds) // 64 + 1))
    dl = torch.utils.data.DataLoader(train_ds, batch_size=64, shuffle=True)
    best, best_state = -1.0, None
    for ep in range(args.epochs):
        model.train()
        for x, y in dl:
            opt.zero_grad()
            loss = torch.nn.functional.cross_entropy(model(x), y, label_smoothing=0.1)
            loss.backward()
            opt.step()
            sched.step()
        if ep % 5 == 4 or ep == args.epochs - 1:
            acc = float((predict(model, val_ds).argmax(1) == np.array(va_y)).mean())
            print(f"época {ep + 1} loss {loss.item():.3f} val_acc {acc:.3f}", flush=True)
            if acc > best:
                best, best_state = acc, {k: v.clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    p = predict(model, test_ds)
    y = np.array(te_y)
    top3 = float(np.mean([yi in np.argsort(-pi)[:3] for pi, yi in zip(p, y)]))
    report = {"val_acc": best, "test_acc": float((p.argmax(1) == y).mean()), "test_top3": top3,
              "test_macro_f1": float(f1_score(y, p.argmax(1), average="macro")),
              "n_classes": len(labels), "n_train": len(tr_x), "n_val": len(va_x), "n_test": len(te_x),
              "facebox_to_head": FACEBOX_TO_HEAD}
    MODELS.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "labels": labels, "feat_mean": mean, "feat_std": std,
                "config": {"d": 128, "layers": 3, "heads": 4, "ff": 256}}, MODELS / f"{args.out}.pt")
    json.dump(report, open(MODELS / f"{args.out}_report.json", "w"), indent=2)
    with open(MODELS / f"{args.out}_per_class.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["gloss", "n_test", "acc"])
        for c, g in enumerate(labels):
            m = y == c
            if m.any():
                w.writerow([g, int(m.sum()), round(float((p[m].argmax(1) == c).mean()), 3)])
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Prueba de humo (2 épocas)**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/training && python train.py --epochs 2 --out smoke`
Expected: imprime el JSON del reporte sin errores y crea `D:/Ingenium/models/smoke.pt`.

- [ ] **Step 7: Entrenamiento completo en segundo plano** (~30–60 min en CPU)

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/training && python train.py --epochs 150 > D:/Ingenium/tools/tmp/train_v1.log 2>&1`
Expected: `classifier_v1_report.json` con `test_top3` ≥ 0.6. Si `test_acc` < 0.4, **detenerse y reportar** (revisar `hand_ratio` y la cobertura del anchor antes de tocar el modelo).

- [ ] **Step 8: Commit** (los `.pt` no se versionan)

```bash
cd D:/Ingenium && git add server/lsm/classifier/__init__.py server/lsm/classifier/model.py server/tests/test_model.py training/train.py
git commit -m "feat(model): SignTransformer v1 y entrenamiento con evaluación por persona

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Envoltorio de inferencia para el servidor

**Files:**
- Create: `D:\Ingenium\server\lsm\classifier\infer.py`
- Test: `D:\Ingenium\server\tests\test_infer.py`

**Interfaces:**
- Consumes: `SignTransformer` (Task 13), `featurize` (Task 5), `NormSequence` (Task 4), formato del checkpoint (Task 13).
- Produces: `Classifier.load(path) -> Classifier`; `Classifier.labels: list[str]`; `Classifier.predict(norm: NormSequence, k: int = 3) -> list[tuple[str, float]]` (ordenado de mayor a menor probabilidad). **El Plan 2 (servidor) usa exactamente esta firma.**

- [ ] **Step 1: Escribir el test**

```python
# D:/Ingenium/server/tests/test_infer.py
import numpy as np
import torch

from lsm.classifier.infer import Classifier
from lsm.classifier.model import SignTransformer
from lsm.features import F_DIM
from lsm.normalize import NormSequence
from tests.conftest import make_hand


def test_load_and_predict_topk(tmp_path):
    labels = ["A", "B", "C", "D"]
    m = SignTransformer(len(labels))
    ckpt = tmp_path / "c.pt"
    torch.save({"state_dict": m.state_dict(), "labels": labels, "feat_mean": np.zeros(F_DIM, np.float32),
                "feat_std": np.ones(F_DIM, np.float32), "config": {"d": 128, "layers": 3, "heads": 4, "ff": 256}}, ckpt)
    clf = Classifier.load(ckpt)
    hands = np.zeros((8, 2, 21, 3), np.float32)
    present = np.zeros((8, 2), bool)
    for t in range(8):
        hands[t, 0] = make_hand(wrist=(0, 1.0))
        present[t, 0] = True
    out = clf.predict(NormSequence(hands, present), k=3)
    assert len(out) == 3 and {g for g, _ in out} <= set(labels)
    probs = [p for _, p in out]
    assert probs == sorted(probs, reverse=True) and 0 < sum(probs) <= 1.0001
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_infer.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'lsm.classifier.infer'`

- [ ] **Step 3: Implementar `infer.py`**

```python
# D:/Ingenium/server/lsm/classifier/infer.py
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

from lsm.classifier.model import SignTransformer
from lsm.features import featurize
from lsm.normalize import NormSequence


class Classifier:
    def __init__(self, model: SignTransformer, labels: list[str], mean: np.ndarray, std: np.ndarray):
        self.model, self.labels, self.mean, self.std = model.eval(), labels, mean, std

    @classmethod
    def load(cls, path: str | Path) -> "Classifier":
        ck = torch.load(path, map_location="cpu", weights_only=False)
        model = SignTransformer(len(ck["labels"]), **ck["config"])
        model.load_state_dict(ck["state_dict"])
        return cls(model, list(ck["labels"]), np.asarray(ck["feat_mean"]), np.asarray(ck["feat_std"]))

    @torch.no_grad()
    def predict(self, norm: NormSequence, k: int = 3) -> list[tuple[str, float]]:
        x = (featurize(norm) - self.mean) / self.std
        p = torch.softmax(self.model(torch.from_numpy(x.astype(np.float32))[None]), 1)[0].numpy()
        top = np.argsort(-p)[:k]
        return [(self.labels[i], float(p[i])) for i in top]
```

- [ ] **Step 4: Correr todos los tests rápidos**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest -q`
Expected: todos PASS.

- [ ] **Step 5: Probar con el modelo real**

Run:
```bash
source D:/Ingenium/tools/env.sh && python -c "
import csv
from lsm.classifier.infer import Classifier
from lsm.normalize import NormSequence
clf = Classifier.load('D:/Ingenium/models/classifier_v1.pt')
rows = [r for r in csv.DictReader(open('D:/Ingenium/datasets/processed/manifest.csv', encoding='utf-8')) if r['split']=='test'][:5]
for r in rows: print(r['gloss'], '→', clf.predict(NormSequence.load(r['norm_path'])))"
```
Expected: 5 líneas con la glosa real y el top-3; en la mayoría la real aparece dentro del top-3.

- [ ] **Step 6: Commit**

```bash
cd D:/Ingenium && git add server/lsm/classifier/infer.py server/tests/test_infer.py
git commit -m "feat(model): envoltorio de inferencia Classifier.load/predict para el servidor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Qué queda para los siguientes planes

| Plan | Contenido | Depende de |
|---|---|---|
| **2. Servidor** | FastAPI + WebSocket, NormSequence en vivo (anchor con mediana móvil), segmentador, clase `NINGUNA`, evaluador (referencias por glosa usando `finger_flexion`), guante (parser, calibración, simulado), oraciones (OpenAI + plantillas), grabar y reproducir | Plan 1 (Tasks 2–5, 14) |
| **3. Interfaz web** | React + Vite, MediaPipe JS 0.10.14, Web Serial, pantallas, herramienta de grabación (con flujo de diseño de `CLAUDE.md`) | Contrato WebSocket del Plan 2 |
| **4. Firmware** | PlatformIO ESP32, TCA9548A, 6× MPU-6050, Hall, protocolo, modo simulado | Protocolo del spec §7.4 |
| **5. Despliegue y demo** | VPS con Caddy y HTTPS (subdominio del usuario), ajuste fino con grabaciones propias, guion y lista de verificación | Planes 2–4 |
