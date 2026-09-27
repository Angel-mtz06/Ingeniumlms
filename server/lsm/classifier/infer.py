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
