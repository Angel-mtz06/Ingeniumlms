from __future__ import annotations

from pathlib import Path
from typing import Sequence

import numpy as np
import torch

from lsm.classifier.model import SignTransformer
from lsm.features import active_span, featurize
from lsm.normalize import NormSequence


def _from_ckpt(ck: dict) -> "Classifier":
    model = SignTransformer(len(ck["labels"]), **ck["config"])
    model.load_state_dict(ck["state_dict"])
    return Classifier(model, list(ck["labels"]), np.asarray(ck["feat_mean"]), np.asarray(ck["feat_std"]))


class Classifier:
    def __init__(self, model: SignTransformer, labels: list[str], mean: np.ndarray, std: np.ndarray):
        self.model, self.labels, self.mean, self.std = model.eval(), labels, mean, std

    @classmethod
    def load(cls, path: str | Path) -> "Classifier | EnsembleClassifier":
        """Un checkpoint de train.py, o un ensamble de semillas guardado con `save_ensemble` ({"ensemble": [...]})."""
        ck = torch.load(path, map_location="cpu", weights_only=False)
        if "ensemble" in ck:
            return EnsembleClassifier([_from_ckpt(c) for c in ck["ensemble"]])
        return _from_ckpt(ck)

    @torch.no_grad()
    def probs(self, norm: NormSequence) -> np.ndarray:
        x = (featurize(norm) - self.mean) / self.std
        return torch.softmax(self.model(torch.from_numpy(x.astype(np.float32))[None]), 1)[0].numpy()

    def predict(self, norm: NormSequence, k: int = 3) -> list[tuple[str, float]]:
        return _top(self.probs(norm), self.labels, k)


class EnsembleClassifier:
    """Promedia las probabilidades de varios clasificadores con las mismas etiquetas en el mismo orden (p. ej. el
    mismo modelo entrenado con distintas semillas). Cada miembro normaliza los rasgos con su media y desviación."""

    def __init__(self, members: Sequence[Classifier]):
        if not members:
            raise ValueError("ensamble vacío")
        labels = members[0].labels
        for m in members[1:]:
            if m.labels != labels:
                raise ValueError("los miembros del ensamble no tienen las mismas etiquetas en el mismo orden")
        self.members, self.labels = list(members), list(labels)

    def probs(self, norm: NormSequence) -> np.ndarray:
        return np.mean([m.probs(norm) for m in self.members], axis=0)

    def predict(self, norm: NormSequence, k: int = 3) -> list[tuple[str, float]]:
        return _top(self.probs(norm), self.labels, k)


def _top(p: np.ndarray, labels: list[str], k: int) -> list[tuple[str, float]]:
    top = np.argsort(-p)[:k]
    return [(labels[i], float(p[i])) for i in top]


def save_ensemble(paths: Sequence[str | Path], out: str | Path, **meta) -> None:
    """Junta checkpoints de train.py (mismas etiquetas, mismo orden) en un solo archivo que `Classifier.load` abre
    como `EnsembleClassifier`. `meta` se guarda tal cual (p. ej. de qué semillas sale y sus métricas)."""
    cks = [torch.load(p, map_location="cpu", weights_only=False) for p in paths]
    for c in cks[1:]:
        if list(c["labels"]) != list(cks[0]["labels"]):
            raise ValueError("los checkpoints no tienen las mismas etiquetas en el mismo orden")
    torch.save({"ensemble": cks, "labels": list(cks[0]["labels"]), "members": [Path(p).name for p in paths], **meta},
               out)


# Recortes del segmento para promediar (fracción del tramo activo que se quita al inicio, al final): el segmentador
# en vivo no siempre corta la seña en su lugar. Con v2e, en personas no vistas: top-3 95.0 → 97.5 %, mismo top-1.
TTA_CROPS = ((0.0, 0.0), (0.15, 0.0), (0.0, 0.15))
MIN_CROP = 4  # cuadros mínimos de un recorte; más corto se usa la secuencia completa


def crop_active(norm: NormSequence, lo: float, hi: float) -> NormSequence:
    """Quita `lo` del inicio del tramo activo (junto con el reposo previo) y `hi` de su final."""
    if lo <= 0 and hi <= 0:
        return norm
    a, b = active_span(norm, pad=0)
    span = b - a + 1
    s = a + int(round(lo * span)) if lo > 0 else 0
    e = b + 1 - int(round(hi * span)) if hi > 0 else len(norm.hands)
    if e - s < MIN_CROP:
        return norm
    return NormSequence(norm.hands[s:e], norm.present[s:e], norm.sample_id, norm.signer)


def predict_tta(clf, norm: NormSequence, k: int = 3) -> list[tuple[str, float]]:
    """Top-k con las probabilidades promediadas de los recortes TTA_CROPS. Un clasificador sin `probs` (p. ej. de
    pruebas) predice solo con la secuencia completa."""
    if not hasattr(clf, "probs"):
        return clf.predict(norm, k=k)
    return _top(np.mean([clf.probs(crop_active(norm, lo, hi)) for lo, hi in TTA_CROPS], axis=0), clf.labels, k)
