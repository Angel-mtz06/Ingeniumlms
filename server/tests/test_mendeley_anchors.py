import sys

import numpy as np
import pytest

sys.path.insert(0, "D:/Ingenium/training")
from mendeley_anchors import hand_to_head_ratio, hand_scale, plausible_box, signer_anchor  # noqa: E402

from lsm.schema import RawSequence
from tests.conftest import make_hand, raw_with_head


def test_plausible_box_filters():
    assert plausible_box(np.array([300, 80, 350, 140]))          # 50×60 centrado arriba
    assert not plausible_box(np.array([88, 0, 560, 240]))        # media imagen
    assert not plausible_box(np.array([1, 0, 62, 54]))           # esquina
    assert not plausible_box(np.array([300, 300, 340, 340]))     # demasiado abajo
    assert not plausible_box(np.array([np.nan] * 4))


def test_hand_scale():
    assert hand_scale(make_hand(size=25)) == pytest.approx(25)


def test_hand_to_head_ratio_from_real_faces():
    h = make_hand(wrist=(300, 200), size=21)
    raw = raw_with_head(T=3, head=(320, 100), head_w=30, hands_px=[[h]] * 3)
    assert hand_to_head_ratio([raw]) == pytest.approx(0.7)


def test_signer_anchor_uses_plausible_boxes_and_hand_size():
    good, bad = RawSequence.empty(2, 640, 480), RawSequence.empty(2, 640, 480)
    good.face_box[:] = [300, 80, 350, 140]
    bad.face_box[:] = [88, 0, 560, 240]
    for r in (good, bad):
        r.hands[:, 0] = make_hand(wrist=(300, 300), size=20)
    cx, cy, s = signer_anchor([good, bad, good], ratio=0.5)
    assert (cx, cy) == pytest.approx((325, 110)) and s == pytest.approx(40)


def test_signer_anchor_none_without_boxes_or_hands():
    r = RawSequence.empty(2, 640, 480)
    assert signer_anchor([r], ratio=0.7) is None
