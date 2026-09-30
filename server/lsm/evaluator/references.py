"""Plantilla estadística de cada seña a partir de todas las personas del dataset."""
from __future__ import annotations

import json
import warnings
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path

import numpy as np

from lsm.features import T_OUT, active_span, finger_flexion, resample
from lsm.normalize import NormSequence, mirror

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


PALM_POINTS = [0, 5, 9, 13, 17]  # muñeca y nudillos


def sample_stats(norm: NormSequence) -> dict:
    hands, present = resample(norm, *active_span(norm), T_OUT)
    frac = present.mean(axis=0)
    st = {"present_frac": frac, "flex": np.full((2, 5), np.nan), "loc": np.full((2, 3), np.nan),
          "center": np.full((2, 3), np.nan),  # centro de la palma (muñeca + nudillos): para nombrar la zona
          "palm": np.full((2, 3), np.nan), "contacts": np.full((2, 4), np.nan)}
    for s in (0, 1):
        if frac[s] < 0.5:
            continue
        idx = _hold_idx(hands, present, s)
        st["flex"][s] = np.mean([finger_flexion(hands[t, s]) for t in idx], axis=0)
        st["loc"][s] = hands[idx, s, 0].mean(axis=0)
        st["center"][s] = hands[idx, s][:, PALM_POINTS].mean(axis=(0, 1))
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
    # Margen extra por parámetro (p. ej. {"movimiento": 2.5}); divide el z de ese parámetro. None = sin margen.
    tolerance: dict | None = None


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


def mirror_reference(ref: GlossRef) -> GlossRef:
    """La referencia en espejo, como si se hubiera construido con las muestras reflejadas (`normalize.mirror`): se
    intercambian las manos (slot 0 ↔ 1), la ubicación y la trayectoria cambian el signo de x, la normal de la palma
    (x, y, z) pasa a (x, -y, -z) y la flexión y los contactos no cambian. Sirve para tomas grabadas en espejo (la
    cámara frontal del celular): la mano derecha quedó como izquierda."""
    swap = lambda a: np.asarray(a)[::-1].copy()  # noqa: E731
    loc = swap(ref.loc_mean)
    loc[:, 0] *= -1
    palm = swap(ref.palm_mean)
    palm[:, 1:] *= -1
    traj = np.asarray(ref.traj_mean, np.float32).copy()
    traj[:, 0] *= -1
    ex = mirror(NormSequence(np.asarray(ref.example_hands, np.float32), np.asarray(ref.example_present, bool)))
    return replace(ref, slots_used=swap(ref.slots_used), flex_mean=swap(ref.flex_mean), flex_std=swap(ref.flex_std),
                   loc_mean=loc, loc_std=swap(ref.loc_std), palm_mean=palm, palm_spread=swap(ref.palm_spread),
                   contact_prob=swap(ref.contact_prob), dom=1 - ref.dom, traj_mean=traj,
                   example_hands=ex.hands, example_present=ex.present)


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
