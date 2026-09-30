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


def _ckpt(labels, seed):
    torch.manual_seed(seed)
    m = SignTransformer(len(labels))
    return {"state_dict": m.state_dict(), "labels": labels, "feat_mean": np.full(F_DIM, 0.1 * seed, np.float32),
            "feat_std": np.ones(F_DIM, np.float32), "config": {"d": 128, "layers": 3, "heads": 4, "ff": 256}}


def _seq():
    hands = np.zeros((8, 2, 21, 3), np.float32)
    present = np.zeros((8, 2), bool)
    for t in range(8):
        hands[t, 0] = make_hand(wrist=(0, 1.0 + 0.05 * t))
        present[t, 0] = True
    return NormSequence(hands, present)


def test_ensemble_averages_member_probabilities(tmp_path):
    import pytest
    from lsm.classifier.infer import EnsembleClassifier, save_ensemble
    labels = ["A", "B", "C", "D"]
    paths = []
    for s in range(3):
        paths.append(tmp_path / f"s{s}.pt")
        torch.save(_ckpt(labels, s), paths[-1])
    members = [Classifier.load(p) for p in paths]
    out = tmp_path / "ens.pt"
    save_ensemble(paths, out)
    ens = Classifier.load(out)
    assert isinstance(ens, EnsembleClassifier) and ens.labels == labels and len(ens.members) == 3
    seq = _seq()
    want = np.mean([m.probs(seq) for m in members], axis=0)  # cada miembro con su media y desviación
    np.testing.assert_allclose(ens.probs(seq), want, rtol=1e-5, atol=1e-6)
    top = ens.predict(seq, k=4)
    assert [g for g, _ in top] == [labels[i] for i in np.argsort(-want)]
    assert abs(sum(p for _, p in top) - 1) < 1e-4
    # etiquetas en otro orden: error
    torch.save(_ckpt(["B", "A", "C", "D"], 9), tmp_path / "bad.pt")
    with pytest.raises(ValueError):
        save_ensemble([paths[0], tmp_path / "bad.pt"], tmp_path / "x.pt")
    with pytest.raises(ValueError):
        EnsembleClassifier([members[0], Classifier.load(tmp_path / "bad.pt")])


def test_crop_active_and_predict_tta():
    import numpy as np
    from lsm.classifier.infer import TTA_CROPS, crop_active, predict_tta
    from lsm.normalize import NormSequence
    T = 30
    hands = np.zeros((T, 2, 21, 3), np.float32)
    hands[:, 0, 0, 1] = 5.0  # reposo (muñeca abajo)
    hands[10:30, 0, 0, 1] = 1.0  # tramo activo: cuadros 10..29
    present = np.zeros((T, 2), bool)
    present[:, 0] = True  # solo una mano
    norm = NormSequence(hands, present)
    assert crop_active(norm, 0, 0) is norm
    assert crop_active(norm, 0.15, 0).T == 30 - (10 + 3)  # sin el reposo previo ni el 15 % inicial
    assert crop_active(norm, 0, 0.15).T == 30 - 3
    assert crop_active(norm, 0.9, 0.9) is norm  # recorte demasiado corto: la secuencia completa

    class Fake:
        labels = ["A", "B"]
        seen = []

        def probs(self, n):
            self.seen.append(n.T)
            return np.array([0.6, 0.4]) if n.T == 30 else np.array([0.2, 0.8])

    f = Fake()
    top = predict_tta(f, norm, k=2)
    assert len(f.seen) == len(TTA_CROPS) and top[0][0] == "B"  # (0.6 + 0.2 + 0.2) / 3 < (0.4 + 0.8 + 0.8) / 3
