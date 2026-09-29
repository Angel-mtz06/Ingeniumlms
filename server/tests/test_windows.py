import numpy as np

from lsm.normalize import NormSequence
from lsm.windows import MAX_WINDOWS, NONE_GLOSS, WINDOW_SIZES, window_bounds, windows


def seq(T, present_from=0):
    hands = np.random.default_rng(0).normal(size=(T, 2, 21, 3)).astype(np.float32)
    present = np.zeros((T, 2), bool)
    present[present_from:, 0] = True
    return NormSequence(hands, present, "angel_NINGUNA_000", "angel")


def test_constants():
    assert NONE_GLOSS == "NINGUNA"
    assert WINDOW_SIZES == (20, 30, 45, 60, 90, 120) and MAX_WINDOWS == 8


def test_window_bounds_sizes_and_step():
    b = window_bounds(150)
    assert [(s, e) for s, e in b if e - s == 45] == [(0, 45), (30, 75), (60, 105), (90, 135)]
    assert [(s, e) for s, e in b if e - s == 20] == [(0, 20), (30, 50), (60, 80), (90, 110), (120, 140)]
    assert [(s, e) for s, e in b if e - s == 120] == [(0, 120), (30, 150)]
    assert all(0 <= s < e <= 150 for s, e in b)


def test_window_bounds_300_frames_count():
    # 10 s de NINGUNA: 10 + 10 + 9 + 9 + 8 + 7 ventanas (tamaños 20, 30, 45, 60, 90, 120; paso 30)
    assert len(window_bounds(300)) == 53


def test_short_sequence_is_one_window():
    assert window_bounds(15) == [(0, 15)]
    assert window_bounds(25) == [(0, 20)]
    assert window_bounds(0) == []


def test_windows_capped_and_uniform_deterministic():
    s = seq(300)
    out = windows(s)
    assert len(out) == MAX_WINDOWS
    ks = [int(w.sample_id.rsplit("_w", 1)[1]) for w in out]
    assert ks == sorted(ks) and ks[0] == 0 and ks[-1] == len(window_bounds(300)) - 1  # de punta a punta
    assert {w.T for w in out} >= {20, 120}  # cubre tamaños cortos y largos
    assert [w.sample_id for w in windows(s)] == [w.sample_id for w in out]  # determinista


def test_windows_slice_ids_and_skip_handless():
    s = seq(150, present_from=60)  # sin manos los primeros 60 cuadros (reposo fuera de cuadro)
    out = windows(s, min_hand_ratio=0.3)
    assert 0 < len(out) <= MAX_WINDOWS
    ids = [w.sample_id for w in out]
    assert len(set(ids)) == len(ids) and all(i.startswith("angel_NINGUNA_000_w") for i in ids)
    for w in out:
        assert w.signer == "angel" and w.hands.shape[1:] == (2, 21, 3) and w.T in WINDOW_SIZES
        assert w.present.any(axis=1).mean() >= 0.3
        k = int(w.sample_id.rsplit("_w", 1)[1])
        a, b = window_bounds(150)[k]
        assert np.array_equal(w.hands, s.hands[a:b])
