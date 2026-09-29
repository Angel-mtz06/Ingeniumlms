"""build_dataset con grabaciones propias: NINGUNA se trocea en ventanas y las tomas se separan train/val."""
import csv
import sys

import numpy as np

from lsm.normalize import NormSequence
from tests.conftest import make_hand, raw_with_head

sys.path.insert(0, "D:/Ingenium/training")
import build_dataset  # noqa: E402

FIELDS = ["sample_id", "dataset", "source_label", "signer", "path", "n_frames", "hand_ratio"]


def _rec(own, sid, label, signer, T, hand_from=0):
    hands = [[make_hand(wrist=(320.0, 160.0), size=30)] if t >= hand_from else [] for t in range(T)]
    raw = raw_with_head(T=T, hands_px=hands)
    raw.sample_id, raw.dataset, raw.source_label, raw.signer = sid, "own", label, signer
    path = own / "raw" / f"{sid}.npz"
    raw.save(path)
    ratio = round((T - hand_from) / T, 3)
    return {"sample_id": sid, "dataset": "own", "source_label": label, "signer": signer, "path": str(path),
            "n_frames": T, "hand_ratio": ratio}


def test_build_dataset_own_and_none(tmp_path, monkeypatch, capsys):
    root = tmp_path / "root"
    own = root / "datasets" / "own"
    (own / "raw").mkdir(parents=True)
    rows = [_rec(own, f"angel_HOLA_{t:03d}", "HOLA", "angel", 20) for t in range(5)]
    # 10 s de NINGUNA: el filtro de manos (≥30 %) se aplica por ventana, no a la toma entera
    rows.append(_rec(own, "angel_NINGUNA_000", "NINGUNA", "angel", 300, hand_from=60))
    rows.append(_rec(own, "ana_NINGUNA_000", "NINGUNA", "ana", 300, hand_from=250))  # 17 % con manos en total
    with open(own / "index_own.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    monkeypatch.setattr(build_dataset, "DATASETS", root / "datasets")
    monkeypatch.setattr(build_dataset, "RAW_LANDMARKS", root / "datasets" / "raw_landmarks")
    monkeypatch.setattr(build_dataset, "PROCESSED", root / "datasets" / "processed")
    build_dataset.main()
    man = list(csv.DictReader(open(root / "datasets" / "processed" / "manifest.csv", encoding="utf-8")))
    hola = {r["sample_id"]: r["split"] for r in man if r["gloss"] == "HOLA"}
    assert hola == {"angel_HOLA_000": "val", "angel_HOLA_001": "train", "angel_HOLA_002": "train",
                    "angel_HOLA_003": "train", "angel_HOLA_004": "train"}
    none = [r for r in man if r["gloss"] == "NINGUNA"]
    assert none and all(r["split"] == "train" and "_NINGUNA_000_w" in r["sample_id"] for r in none)
    # tope de 8 ventanas por toma. ana (17 % de manos en toda la toma) no se descarta entera: quedan sus
    # 9 ventanas del final con ≥30 % de manos, recortadas a 8
    assert sum(r["signer"] == "angel" for r in none) == 8
    assert sum(r["signer"] == "ana" for r in none) == 8
    for r in none:
        if r["signer"] == "ana":
            assert NormSequence.load(r["norm_path"]).present.any(axis=1).mean() >= 0.3
    for r in none:
        assert (root / "datasets" / "processed" / "norm" / f"{r['sample_id']}.npz").exists()
    out = capsys.readouterr().out
    assert "propias" in out and "NINGUNA" in out
    np.testing.assert_equal(len({r["sample_id"] for r in man}), len(man))


def test_build_references_excludes_none(tmp_path, monkeypatch):
    import build_references
    from lsm.evaluator.references import load_references
    from tests.test_references import seq

    rows = []
    for g in ("HOLA", "NINGUNA"):
        for i in range(3):
            p = tmp_path / f"{g}_{i}.npz"
            seq(signer=f"p{i}").save(p)
            rows.append({"sample_id": f"{g}_{i}", "gloss": g, "signer": f"p{i}", "dataset": "own",
                         "norm_path": str(p), "split": "train"})
    with open(tmp_path / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    monkeypatch.setattr(build_references, "PROCESSED", tmp_path)
    monkeypatch.setattr(build_references, "MODELS", tmp_path / "models")
    build_references.main([])
    assert set(load_references(tmp_path / "models" / "references.json")) == {"HOLA"}


def test_build_references_out_path(tmp_path, monkeypatch):
    import build_references
    from lsm.evaluator.references import load_references
    from tests.test_references import seq

    rows = []
    for i in range(3):
        p = tmp_path / f"HOLA_{i}.npz"
        seq(signer=f"p{i}").save(p)
        rows.append({"sample_id": f"HOLA_{i}", "gloss": "HOLA", "signer": f"p{i}", "dataset": "own",
                     "norm_path": str(p), "split": "train"})
    with open(tmp_path / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    monkeypatch.setattr(build_references, "PROCESSED", tmp_path)
    monkeypatch.setattr(build_references, "MODELS", tmp_path / "models")
    out = tmp_path / "stage" / "references_classifier_v2.json"
    build_references.main(["--out", str(out)])
    assert set(load_references(out)) == {"HOLA"}
    assert not (tmp_path / "models" / "references.json").exists()  # la de v1 no se toca
