import numpy as np
import pytest

from lsm.features import F_DIM, T_OUT, active_span, featurize, finger_flexion, hand_local, resample
from lsm.normalize import NormSequence
from tests.conftest import make_hand


def seq(T, slot0=None, slot1=None):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for s, spec in ((0, slot0), (1, slot1)):
        if spec is None:
            continue
        for t in range(T):
            h = spec(t)
            if h is not None:
                hands[t, s] = h
                present[t, s] = True
    return NormSequence(hands=hands, present=present, sample_id="x", signer="t")


def test_finger_flexion_matches_synthetic_angles():
    h = make_hand(flex=(0, 30, 60, 90, 120))
    np.testing.assert_allclose(finger_flexion(h), [0, 30, 60, 90, 120], atol=1e-3)


def test_hand_local_origin_and_scale():
    h = make_hand(wrist=(5, 7), size=3)
    loc = hand_local(h)
    np.testing.assert_allclose(loc[0], 0, atol=1e-6)
    assert np.linalg.norm(loc[9]) == pytest.approx(1.0)


def test_active_span_ignores_rest_frames():
    up = lambda t: make_hand(wrist=(0, 1.0), size=1)
    rest = lambda t: make_hand(wrist=(0, 5.0), size=1)
    n = seq(6, slot0=lambda t: up(t) if 2 <= t <= 3 else rest(t))
    assert active_span(n) == (1, 4)  # ±1 cuadro de margen


def test_active_span_without_activity_is_whole_sequence():
    n = seq(4)
    assert active_span(n) == (0, 3)


def test_resample_interpolates_and_keeps_presence():
    n = seq(3, slot0=lambda t: make_hand(wrist=(float(t), 0.0), size=1))
    hands, present = resample(n, 0, 2, t_out=5)
    assert hands.shape == (5, 2, 21, 3) and present[:, 0].all() and not present[:, 1].any()
    np.testing.assert_allclose(hands[:, 0, 0, 0], [0, 0.5, 1, 1.5, 2], atol=1e-5)
    assert (hands[:, 1] == 0).all()


def test_featurize_shape_and_layout():
    n = seq(10, slot0=lambda t: make_hand(wrist=(0.1 * t, 1.0), size=1, flex=(0, 90, 0, 0, 0)))
    f = featurize(n)
    assert f.shape == (T_OUT, F_DIM) and f.dtype == np.float32
    assert (f[:, 0] == 1).all() and (f[:, 72] == 0).all()
    assert f[0, 68] == pytest.approx(0.5, abs=1e-3)       # flexión del índice = 90/180
    assert (f[:, 72:144] == 0).all() and (f[:, 147:150] == 0).all()
    assert f[5, 144] > 0                                   # la muñeca se mueve a +x


def test_finger_flexion_with_nonplanar_3d_vectors():
    """Regression test: finger_flexion must work correctly for non-planar 3D hand landmarks."""
    from lsm.features import _angle

    # Test case 1: vectors with nonzero z components
    v1 = np.array([0.0, -1.0, 0.1], dtype=np.float64)
    v2 = np.array([0.3, 0.3, 0.9], dtype=np.float64)

    # Reference: arccos formula in float64
    n1 = np.linalg.norm(v1)
    n2 = np.linalg.norm(v2)
    c = np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0)
    expected = float(np.degrees(np.arccos(c)))

    actual = _angle(v1.astype(np.float32), v2.astype(np.float32))
    np.testing.assert_allclose(actual, expected, atol=1e-3)

    # Test case 2: perpendicular vectors in 3D (should give 90°)
    v1 = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    v2 = np.array([0.0, 1.0, 0.0], dtype=np.float64)

    # Reference
    n1 = np.linalg.norm(v1)
    n2 = np.linalg.norm(v2)
    c = np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0)
    expected = float(np.degrees(np.arccos(c)))

    actual = _angle(v1.astype(np.float32), v2.astype(np.float32))
    np.testing.assert_allclose(actual, expected, atol=1e-3)
    assert actual == pytest.approx(90.0, abs=1e-3)
