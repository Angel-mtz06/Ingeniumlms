"""Cara, cuello y torso de la persona: zonas de ubicación de la mano y mano encima de la cara.

Todo en unidades de cabeza (mismo origen y escala que las manos normalizadas: origen en la nariz, 1 unidad = distancia
entre mejillas, y crece hacia abajo). La vista es 2D: "pecho" significa "a la altura del pecho, frente al cuerpo".
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lsm.schema import RawSequence

# Índices dentro de FACE_IDX (schema): nariz, mejillas, cejas, labios y barbilla.
F_NOSE, F_CHEEK_A, F_CHEEK_B = 0, 1, 2
F_BROWS = tuple(range(3, 13))
F_LIP_TOP, F_LIP_BOTTOM, F_CHIN = 15, 16, 21
# Pose: nariz, boca, hombros, caderas.
P_NOSE, P_MOUTH_A, P_MOUTH_B = 0, 9, 10
P_SHOULDER_A, P_SHOULDER_B, P_HIP_A, P_HIP_B = 11, 12, 23, 24
MIN_VIS = 0.5
# Proporciones típicas (en unidades de cabeza) para lo que no se ve: sin cara, con la pose; sin hombros ni caderas.
BROW_ABOVE_NOSE, MOUTH_TOP, MOUTH_BOTTOM, CHIN_BELOW_NOSE = 0.45, 0.25, 0.45, 0.75
SHOULDER_BELOW_CHIN, SHOULDER_HALF, TORSO_HEIGHT = 0.8, 1.5, 3.6
FOREHEAD = 0.6  # la frente sube esto sobre las cejas

ZONES = ("arriba", "frente", "ojo", "nariz", "mejilla", "boca", "barbilla", "sien", "oreja", "cuello", "hombro",
         "pecho", "estomago", "cintura", "lado")
# "llévala …" / "ahora está …"
ZONE_TO = {"arriba": "arriba de la cabeza", "frente": "a la frente", "ojo": "a los ojos", "nariz": "a la nariz",
           "mejilla": "a la mejilla", "boca": "a la boca", "barbilla": "a la barbilla", "sien": "a la sien",
           "oreja": "a la oreja", "cuello": "al cuello", "hombro": "al hombro", "pecho": "a la altura del pecho",
           "estomago": "a la altura del estómago", "cintura": "a la cintura", "lado": "a un lado del cuerpo"}
ZONE_AT = {"arriba": "arriba de la cabeza", "frente": "en la frente", "ojo": "en los ojos", "nariz": "en la nariz",
           "mejilla": "en la mejilla", "boca": "en la boca", "barbilla": "en la barbilla", "sien": "en la sien",
           "oreja": "en la oreja", "cuello": "en el cuello", "hombro": "en el hombro",
           "pecho": "a la altura del pecho", "estomago": "a la altura del estómago", "cintura": "en la cintura",
           "lado": "a un lado del cuerpo"}


@dataclass
class Body:
    face_x: float
    face_half: float  # medio ancho de la cara (mejilla a mejilla / 2)
    nose_y: float
    brow_y: float
    mouth_top: float
    mouth_bottom: float
    chin_y: float
    shoulders: np.ndarray | None  # (2, 2) x, y de cada hombro; None si no se ven
    hips_y: float | None  # None si no se ven

    @property
    def shoulder_y(self) -> float:
        return float(self.shoulders[:, 1].mean()) if self.shoulders is not None else self.chin_y + SHOULDER_BELOW_CHIN

    @property
    def torso_x(self) -> tuple[float, float]:
        if self.shoulders is not None:
            return float(self.shoulders[:, 0].min()), float(self.shoulders[:, 0].max())
        return self.face_x - SHOULDER_HALF, self.face_x + SHOULDER_HALF

    @property
    def waist_y(self) -> float:
        return self.hips_y if self.hips_y is not None else self.shoulder_y + TORSO_HEIGHT


def _hu(p, cx: float, cy: float, s: float) -> np.ndarray:
    return np.array([(p[0] - cx) / s, (p[1] - cy) / s], np.float32)


def _ok(p) -> bool:
    return not np.isnan(p[0])


def body_from_raw(raw: RawSequence, t: int, anchor: tuple[float, float, float]) -> Body | None:
    """Cuerpo del cuadro `t` en unidades de cabeza con `anchor` = (cx, cy, s) en px. None sin cara ni pose."""
    cx, cy, s = anchor
    f, p = raw.face[t], raw.pose[t]
    vis = lambda i: _ok(p[i]) and p[i, 3] > MIN_VIS  # noqa: E731
    if all(_ok(f[i]) for i in (F_NOSE, F_CHEEK_A, F_CHEEK_B, F_LIP_TOP, F_LIP_BOTTOM, F_CHIN)):
        nose, a, b = _hu(f[F_NOSE], cx, cy, s), _hu(f[F_CHEEK_A], cx, cy, s), _hu(f[F_CHEEK_B], cx, cy, s)
        brows = [_hu(f[i], cx, cy, s)[1] for i in F_BROWS if _ok(f[i])]
        face_x, face_half = float((a[0] + b[0]) / 2), float(abs(a[0] - b[0]) / 2)
        nose_y = float(nose[1])
        brow_y = float(np.mean(brows)) if brows else nose_y - BROW_ABOVE_NOSE
        mouth_top, mouth_bottom = float(_hu(f[F_LIP_TOP], cx, cy, s)[1]), float(_hu(f[F_LIP_BOTTOM], cx, cy, s)[1])
        chin_y = float(_hu(f[F_CHIN], cx, cy, s)[1])
    elif vis(P_NOSE):
        nose = _hu(p[P_NOSE], cx, cy, s)
        face_x, face_half, nose_y = float(nose[0]), 0.5, float(nose[1])
        brow_y = nose_y - BROW_ABOVE_NOSE
        if vis(P_MOUTH_A) and vis(P_MOUTH_B):
            my = float((_hu(p[P_MOUTH_A], cx, cy, s)[1] + _hu(p[P_MOUTH_B], cx, cy, s)[1]) / 2)
            mouth_top, mouth_bottom = my - 0.1, my + 0.1
        else:
            mouth_top, mouth_bottom = nose_y + MOUTH_TOP, nose_y + MOUTH_BOTTOM
        chin_y = nose_y + CHIN_BELOW_NOSE
    else:
        return None
    shoulders = None
    if vis(P_SHOULDER_A) and vis(P_SHOULDER_B):
        shoulders = np.stack([_hu(p[P_SHOULDER_A], cx, cy, s), _hu(p[P_SHOULDER_B], cx, cy, s)])
    hips_y = None
    if vis(P_HIP_A) and vis(P_HIP_B):
        hips_y = float((_hu(p[P_HIP_A], cx, cy, s)[1] + _hu(p[P_HIP_B], cx, cy, s)[1]) / 2)
    return Body(face_x, face_half, nose_y, brow_y, mouth_top, mouth_bottom, chin_y, shoulders, hips_y)


def zone(body: Body, x: float, y: float) -> str:
    """Zona del cuerpo a la altura de (x, y), en unidades de cabeza."""
    dx = abs(x - body.face_x)
    hw = max(body.face_half, 0.2)
    top = body.brow_y - FOREHEAD
    if y < top:
        return "arriba" if dx <= 2.2 * hw else "lado"
    if y <= body.chin_y + 0.05:
        if dx <= 1.05 * hw:
            center = dx <= 0.4 * hw
            if y < body.brow_y + 0.05:
                return "frente"
            if y < body.nose_y:
                return "nariz" if center else "ojo"
            if y < body.mouth_top - 0.03:
                return "nariz" if center else "mejilla"
            if y <= body.mouth_bottom + 0.05:
                return "boca" if dx <= 0.6 * hw else "mejilla"
            return "barbilla" if dx <= 0.6 * hw else "mejilla"
        if dx <= 2.5 * hw:  # la palma queda fuera de la cabeza cuando los dedos tocan la sien o la oreja
            return "sien" if y < body.nose_y - 0.1 else "oreja"
        return "lado"
    sy = body.shoulder_y
    if body.shoulders is not None:
        for sx, shy in body.shoulders:
            if np.hypot(x - sx, y - shy) <= 0.5:
                return "hombro"
    if y < sy - 0.15:
        return "cuello" if dx <= 1.0 * hw else ("hombro" if dx <= 2.0 * hw + 0.5 else "lado")
    x0, x1 = body.torso_x
    if not (x0 - 0.3 <= x <= x1 + 0.3):
        return "lado"
    waist = body.waist_y
    if y > waist + 0.3:
        return "cintura"
    return "pecho" if y < (sy + waist) / 2 else "estomago"


def hand_over_face(raw: RawSequence, t: int, margin: float = 0.1) -> bool:
    """True si alguna mano tapa la cara (≥3 puntos dentro del recuadro de la cara): la malla facial sale deformada."""
    f = raw.face[t]
    pts = f[~np.isnan(f[:, 0])]
    if len(pts) < 3:
        return False
    x0, y0 = pts[:, 0].min(), pts[:, 1].min()
    x1, y1 = pts[:, 0].max(), pts[:, 1].max()
    mx, my = (x1 - x0) * margin, (y1 - y0) * margin
    # la frente queda arriba de las cejas: se amplía hacia arriba
    y0 -= (y1 - y0) * 0.35
    for h in raw.hands[t]:
        if np.isnan(h[0, 0]):
            continue
        inside = (h[:, 0] >= x0 - mx) & (h[:, 0] <= x1 + mx) & (h[:, 1] >= y0 - my) & (h[:, 1] <= y1 + my)
        if int(inside.sum()) >= 3:
            return True
    return False


def near_face(body: Body | None, hand: np.ndarray) -> bool:
    """La mano (21×3, unidades de cabeza) está frente a la cara o junto a ella."""
    if body is None:
        return False
    c = hand[[0, 5, 9, 13, 17], :2].mean(axis=0)
    return abs(c[0] - body.face_x) <= 2.0 * max(body.face_half, 0.2) and body.brow_y - FOREHEAD - 0.3 <= c[1] <= body.chin_y + 0.4
