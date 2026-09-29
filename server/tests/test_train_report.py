"""Métricas de grabaciones propias en el reporte de entrenamiento."""
import sys

import numpy as np

sys.path.insert(0, "D:/Ingenium/training")
import train  # noqa: E402


def test_own_accuracy_only_counts_own_rows():
    rows = [{"dataset": "own"}, {"dataset": "glosses"}, {"dataset": "own"}, {"dataset": "own"}]
    y_true = np.array([0, 1, 2, 3])
    y_pred = np.array([0, 9, 2, 0])
    assert train.own_accuracy(rows, y_true, y_pred) == 2 / 3


def test_own_accuracy_none_without_own_rows():
    assert train.own_accuracy([{"dataset": "glosses"}], np.array([0]), np.array([0])) is None
    assert train.own_accuracy([], np.array([], int), np.array([], int)) is None


def test_select_filters_split_and_known_labels():
    rows = [{"split": "train", "gloss": "A", "dataset": "own"}, {"split": "val", "gloss": "A", "dataset": "own"},
            {"split": "train", "gloss": "Z", "dataset": "own"}]
    assert train.select(rows, "train", {"A": 0}) == [rows[0]]


def test_comparison_marks_missing_metrics():
    import compare_models
    rows = dict((m, (a, b)) for m, a, b in compare_models.comparison(
        {"val_acc": 0.94, "n_classes": 121}, {"val_acc": 0.9, "own_val_acc": 0.8, "n_classes": 124}))
    assert rows["exactitud val (personas no vistas)"] == ("0.940", "0.900")
    assert rows["exactitud en grabaciones propias (val)"] == ("—", "0.800")
    assert rows["clases"] == ("121", "124")


def test_is_worse_more_than_two_points():
    import compare_models
    old = {"val_acc": 0.94, "test_acc": 0.76}
    assert not compare_models.is_worse(old, {"val_acc": 0.925, "test_acc": 0.745})  # 1.5 puntos: igual
    assert compare_models.is_worse(old, {"val_acc": 0.91, "test_acc": 0.80})  # val cae 3 puntos
    assert compare_models.is_worse(old, {"val_acc": 0.95, "test_acc": 0.73})  # test cae 3 puntos
    assert not compare_models.is_worse({}, {"val_acc": 0.1, "test_acc": 0.1})  # sin reporte del activo
    assert not compare_models.is_worse(old, {})


def test_train_accepts_out_dir():
    ap = train.parser()
    a = ap.parse_args(["--out", "classifier_v2", "--out-dir", "D:/x", "--epochs", "2"])
    assert a.out == "classifier_v2" and str(a.out_dir) == "D:/x" and a.epochs == 2
    assert train.parser().parse_args([]).out_dir is None
