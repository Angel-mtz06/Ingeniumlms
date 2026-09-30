"""Puntaje 0–100 por parámetro de la LSM respecto a la variación natural entre signantes."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from lsm.evaluator.references import GlossRef, dtw, sample_stats
from lsm.normalize import NormSequence

FLEX_FLOOR, LOC_FLOOR, MOVE_FLOOR, PALM_FLOOR = 12.0, 0.35, 0.15, 20.0
Z_MARGIN = 1.0  # hasta 1 z es variación normal entre signantes: no resta puntos
ISSUE_Z = 2.0  # consejo si el z con margen (z − Z_MARGIN) pasa de 2, es decir z > 3
CONTACT_PENALTY = 10.0
PARAMS = ("configuracion", "ubicacion", "movimiento", "orientacion")


def z_to_score(z: float) -> float:
    return float(100.0 * np.exp(-0.5 * float(z) ** 2))


def _score(z: float) -> float:
    return z_to_score(max(float(z) - Z_MARGIN, 0.0))


def _is_issue(z: float) -> bool:
    return float(z) - Z_MARGIN > ISSUE_Z


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


def _tol(ref: GlossRef, param: str) -> float:
    """Margen extra de la referencia para un parámetro (1.0 si no tiene): divide el z de ese parámetro."""
    return float((ref.tolerance or {}).get(param, 1.0))


def _flex_z(ref: GlossRef, flex_row: np.ndarray, s: int) -> np.ndarray:
    return np.abs(flex_row - ref.flex_mean[s]) / np.maximum(np.nan_to_num(ref.flex_std[s]), FLEX_FLOOR) / _tol(ref, "configuracion")


def finger_status(ref: GlossRef, flex: np.ndarray) -> np.ndarray:
    out = np.full((2, 5), -1, int)
    for s in (0, 1):
        if not ref.slots_used[s]:
            continue
        z = _flex_z(ref, flex[s], s) - Z_MARGIN  # mismo margen que el puntaje y los consejos
        out[s] = np.where(np.isnan(z), -1, np.where(z < 1, 0, np.where(z < 2, 1, 2)))
    return out


def _angle(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.degrees(np.arccos(np.clip(np.dot(a, b), -1.0, 1.0))))


def align_one_hand(ref: GlossRef, seq: NormSequence, glove_flex: np.ndarray | None = None,
                   glove_contacts: np.ndarray | None = None):
    """Seña de UNA mano: si la mano de la persona quedó en el otro lado (pasa con señas al centro de la cara, como
    MAMÁ: el lado se decide por la posición), se intercambian los lados para evaluar esa mano. No se refleja nada:
    la orientación de la palma sigue distinguiendo la mano correcta de la otra. Devuelve (seq, glove_flex,
    glove_contacts), sin cambios si la seña usa las dos manos o la mano ya está en su lado."""
    used = np.flatnonzero(np.asarray(ref.slots_used, bool))
    if len(used) != 1:
        return seq, glove_flex, glove_contacts
    s = int(used[0])
    frac = np.asarray(seq.present, bool).mean(axis=0)
    if frac[s] >= 0.5 or frac[1 - s] < 0.5:
        return seq, glove_flex, glove_contacts
    swapped = NormSequence(seq.hands[:, ::-1].copy(), seq.present[:, ::-1].copy(), seq.sample_id, seq.signer)
    flip = lambda a: None if a is None else np.asarray(a)[::-1].copy()  # noqa: E731
    return swapped, flip(glove_flex), flip(glove_contacts)


def live_flex_for(ref: GlossRef, flex: np.ndarray, present: np.ndarray) -> np.ndarray:
    """Lo mismo para los dedos en vivo: la flexión de la mano que sí se ve, en el lado de la referencia."""
    used = np.flatnonzero(np.asarray(ref.slots_used, bool))
    if len(used) == 1 and not present[used[0]] and present[1 - used[0]]:
        return np.asarray(flex)[::-1].copy()
    return flex


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
            for p in ("configuracion", "ubicacion", "orientacion"):
                per[p].append(0.0)
            continue
        z = _flex_z(ref, flex[s], s)
        finger_z[s] = z
        conf = float(np.mean([_score(v) for v in z if not np.isnan(v)] or [0.0]))
        for f in range(5):
            if _is_issue(z[f]):
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
        zl = float(np.linalg.norm(d) / max(float(np.linalg.norm(np.nan_to_num(ref.loc_std[s]))), LOC_FLOOR)) / _tol(ref, "ubicacion")
        per["ubicacion"].append(_score(zl))
        if _is_issue(zl):
            # Centro de la palma de la persona y dónde quedaría con la muñeca de la referencia (misma forma de mano).
            c = st["center"][s]
            t = ref.loc_mean[s] + (c - st["loc"][s])
            issues.append(Issue("ubicacion", zl, s, None, {"dx": float(d[0]), "dy": float(d[1]), "x": float(c[0]),
                                                           "y": float(c[1]), "tx": float(t[0]), "ty": float(t[1])}))
        spread = ref.palm_spread[s]
        zo = _angle(st["palm"][s], ref.palm_mean[s]) / max(0.0 if np.isnan(spread) else float(spread), PALM_FLOOR) / _tol(ref, "orientacion")
        per["orientacion"].append(_score(zo))
        if _is_issue(zo):
            issues.append(Issue("orientacion", zo, s))
    zm = dtw(st["traj"], ref.traj_mean) / max(ref.traj_scale, MOVE_FLOOR) / _tol(ref, "movimiento")
    per["movimiento"].append(0.0 if st["present_frac"][ref.dom] < 0.5 else _score(zm))
    if _is_issue(zm) and st["present_frac"][ref.dom] >= 0.5:
        issues.append(Issue("movimiento", zm, ref.dom, None,
                            {"ratio": st["path_len"] / max(ref.path_len, 1e-6)}))
    scores = {p: round(float(np.mean(v)), 1) if v else 0.0 for p, v in per.items()}
    issues.sort(key=lambda i: -i.z)
    return Evaluation(scores, round(float(np.mean(list(scores.values()))), 1), flex, finger_z, issues)
