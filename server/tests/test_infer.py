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
