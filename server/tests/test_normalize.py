import numpy as np
import pytest

from lsm.anchor import EAR_TO_CHEEK  # el respaldo por pose escala orejas → mejillas
from lsm.normalize import NormSequence, normalize
from tests.conftest import make_hand, raw_with_head


def test_units_are_head_widths_from_head_center():
    h = make_hand(wrist=(320 - 60, 100 + 90), size=30)  # 2 cabezas a la izq., 3 abajo
    raw = raw_with_head(T=1, head=(320, 100), head_w=30, hands_px=[[h]])
    n = normalize(raw)
    assert n.present[0].tolist() == [True, False]
    np.testing.assert_allclose(n.hands[0, 0, 0, :2], np.array([-2.0, 3.0]) / EAR_TO_CHEEK, atol=1e-5)


def test_two_hands_sorted_by_image_x():
    left = make_hand(wrist=(250, 200), size=30)
    right = make_hand(wrist=(400, 200), size=30)
    raw = raw_with_head(T=1, hands_px=[[right, left]])  # orden de detección invertido
    n = normalize(raw)
    assert n.hands[0, 0, 0, 0] < n.hands[0, 1, 0, 0]
    assert n.present[0].all()


def test_single_hand_keeps_slot_by_continuity_when_crossing_midline():
    frames = [[make_hand(wrist=(300, 200), size=30)],   # izq. del centro → slot 0
              [make_hand(wrist=(335, 200), size=30)]]   # cruza el centro, sigue siendo la misma mano
    raw = raw_with_head(T=2, head=(320, 100), hands_px=frames)
    n = normalize(raw)
    assert n.present[:, 0].all() and not n.present[:, 1].any()


def test_absent_hands_are_zero():
    raw = raw_with_head(T=2)
    n = normalize(raw)
    assert not n.present.any() and (n.hands == 0).all()


def test_norm_roundtrip(tmp_path):
    raw = raw_with_head(T=2, hands_px=[[make_hand((300, 200), 30)], []])
    n = normalize(raw)
    n.save(tmp_path / "n.npz")
    m = NormSequence.load(tmp_path / "n.npz")
    np.testing.assert_array_equal(m.hands, n.hands)
    np.testing.assert_array_equal(m.present, n.present)
    assert (m.sample_id, m.signer) == (n.sample_id, n.signer)


def test_normalize_with_fixed_anchor_ignores_pose():
    h = make_hand(wrist=(300 + 40, 90 + 60), size=20)
    raw = raw_with_head(T=2, head=(320, 100), head_w=30, hands_px=[[h], [h]])
    n = normalize(raw, anchor=np.array([300.0, 90.0, 20.0]))
    # wrist normaliza a (+2, +3) respecto al ancla fija: x>0 -> lado derecho -> slot 1
    # (misma convención que test_units_are_head_widths_from_head_center, donde x<0 -> slot 0).
    np.testing.assert_allclose(n.hands[:, 1, 0, :2], [[2.0, 3.0], [2.0, 3.0]], atol=1e-5)


from lsm.normalize import assign_slots, to_head_units


def test_to_head_units():
    h = make_hand(wrist=(350, 160), size=30)
    u = to_head_units(h, 320, 100, 30)
    np.testing.assert_allclose(u[0, :2], [1.0, 2.0], atol=1e-5)
    assert u.dtype == np.float32


def test_assign_slots_two_hands_sorted_and_single_by_side():
    a, b = make_hand(wrist=(-1, 2)), make_hand(wrist=(1, 2))
    assert assign_slots([b, a], [None, None]) == [1, 0]
    assert assign_slots([make_hand(wrist=(0.5, 2))], [None, None]) == [1]
    assert assign_slots([make_hand(wrist=(0.2, 2))], [np.array([-0.1, 2, 0]), None]) == [0]


def test_mirror_flips_x_and_swaps_slots():
    from lsm.normalize import NormSequence, mirror
    h = np.zeros((3, 2, 21, 3), np.float32)
    h[:, 0, :, 0], h[:, 0, :, 1], h[:, 1, :, 0] = 1.5, 2.0, -4.0
    p = np.array([[True, False]] * 3)
    m = mirror(NormSequence(hands=h, present=p, sample_id="s", signer="x"))
    assert m.present[:, 1].all() and not m.present[:, 0].any()  # la mano del slot 0 pasa al slot 1
    assert np.allclose(m.hands[:, 1, :, 0], -1.5) and np.allclose(m.hands[:, 1, :, 1], 2.0)
    assert np.allclose(m.hands[:, 0, :, 0], 4.0)
    assert (m.sample_id, m.signer) == ("s", "x") and h[0, 0, 0, 0] == 1.5  # no modifica la original
