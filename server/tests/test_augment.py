import numpy as np

from lsm.augment import augment
from lsm.normalize import NormSequence
from tests.conftest import make_hand


def one_hand_seq(T=10):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for t in range(T):
        hands[t, 0] = make_hand(wrist=(-1.0, 2.0), size=1)
        present[t, 0] = True
    return NormSequence(hands, present, "x", "t")


def test_does_not_mutate_input_and_keeps_meta():
    n = one_hand_seq()
    before = n.hands.copy()
    a = augment(n, np.random.default_rng(0))
    np.testing.assert_array_equal(n.hands, before)
    assert (a.sample_id, a.signer) == ("x", "t")
    assert 8 <= a.T <= 10


def test_mirror_swaps_slots_and_flips_x():
    n = one_hand_seq()
    a = augment(n, np.random.default_rng(1), p_mirror=1.0)
    assert a.present[:, 1].sum() >= a.T - 2 and not a.present[:, 0].any()
    assert np.median(a.hands[a.present[:, 1], 1, 0, 0]) > 0


def test_absent_stays_zero():
    n = one_hand_seq()
    a = augment(n, np.random.default_rng(2), p_mirror=0.0)
    assert (a.hands[~a.present] == 0).all()


def test_augment_preserves_finger_flexion():
    from lsm.features import featurize

    hands = np.zeros((12, 2, 21, 3), np.float32)
    present = np.zeros((12, 2), bool)
    for t in range(12):
        hands[t, 0] = make_hand(wrist=(-1.0 + 0.05 * t, 1.0), size=0.3, flex=(10, 80, 80, 20, 20))
        present[t, 0] = True
    n = NormSequence(hands, present, "x", "t")
    f0 = featurize(n)
    rng = np.random.default_rng(0)
    for _ in range(20):
        fa = featurize(augment(n, rng, p_mirror=0.0))
        ok = fa[:, 0] > 0
        # flexión por dedo (columnas 67–71, escala /180): error medio < 5°
        assert np.abs(fa[ok, 67:72] - f0[0, 67:72]).mean() * 180 < 5.0
