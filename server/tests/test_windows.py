import numpy as np

from lsm.normalize import NormSequence
from lsm.windows import NONE_GLOSS, window_bounds, windows


def seq(T, present_from=0):
    hands = np.random.default_rng(0).normal(size=(T, 2, 21, 3)).astype(np.float32)
    present = np.zeros((T, 2), bool)
    present[present_from:, 0] = True
    return NormSequence(hands, present, "angel_NINGUNA_000", "angel")


def test_none_gloss_name():
    assert NONE_GLOSS == "NINGUNA"


def test_window_bounds_sizes_and_step():
    b = window_bounds(150)
    assert [(s, e) for s, e in b if e - s == 45] == [(0, 45), (30, 75), (60, 105), (90, 135)]
    assert [(s, e) for s, e in b if e - s == 60] == [(0, 60), (30, 90), (60, 120), (90, 150)]
    assert [(s, e) for s, e in b if e - s == 90] == [(0, 90), (30, 120), (60, 150)]
    assert all(0 <= s < e <= 150 for s, e in b)


def test_window_bounds_300_frames_count():
    # 10 s de NINGUNA: (300-45)//30+1 + (300-60)//30+1 + (300-90)//30+1 = 9 + 9 + 8
    assert len(window_bounds(300)) == 26


def test_short_sequence_is_one_window():
    assert window_bounds(40) == [(0, 40)]
    assert window_bounds(0) == []


def test_windows_slice_ids_and_skip_handless():
    s = seq(150, present_from=60)  # sin manos los primeros 60 cuadros (reposo fuera de cuadro)
    out = windows(s, min_hand_ratio=0.3)
    assert out, "debe haber ventanas con manos"
    ids = [w.sample_id for w in out]
    assert len(set(ids)) == len(ids) and all(i.startswith("angel_NINGUNA_000_w") for i in ids)
    for w in out:
        assert w.signer == "angel" and w.hands.shape[1:] == (2, 21, 3) and w.T in (45, 60, 90)
        assert w.present.any(axis=1).mean() >= 0.3
    # la ventana (0,45) no tiene manos: se omite
    assert all(not np.array_equal(w.hands, s.hands[0:45]) for w in out)
    k = int(out[0].sample_id.rsplit("_w", 1)[1])
    s0, e0 = window_bounds(150)[k]
    assert np.array_equal(out[0].hands, s.hands[s0:e0])
