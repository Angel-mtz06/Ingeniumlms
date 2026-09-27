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
