from dataclasses import replace

import numpy as np
import pytest

from lsm.body import Body, body_from_raw, hand_over_face, zone
from lsm.evaluator.feedback import messages
from lsm.live import HOLD_NEAR_FACE, LiveNormalizer
from lsm.schema import FACE_IDX, RawSequence
from tests.conftest import make_hand
from tests.test_scoring import REF, seq

# Cara en px con ancla (320, 100) y 40 px por unidad de cabeza.
ANCHOR = (320.0, 100.0, 40.0)
FACE_PX = {1: (320, 100), 234: (300, 95), 454: (340, 95), 0: (320, 110), 17: (320, 118), 152: (320, 130)}
for i in (70, 63, 105, 66, 107, 336, 296, 334, 293, 300):
    FACE_PX[i] = (320, 82)


def raw_frame(face=True, shoulders=True, hips=True, hands=()):
    r = RawSequence.empty(1, 640, 480)
    if face:
        for k, i in enumerate(FACE_IDX):
            if i in FACE_PX:
                r.face[0, k, :2] = FACE_PX[i]
                r.face[0, k, 2] = 0
    r.pose[0, 0] = (320, 100, 0, 0.99)
    r.pose[0, 7] = (340, 100, 0, 0.99)
    r.pose[0, 8] = (300, 100, 0, 0.99)
    if shoulders:
        r.pose[0, 11] = (380, 160, 0, 0.99)
        r.pose[0, 12] = (260, 160, 0, 0.99)
    if hips:
        r.pose[0, 23] = (370, 300, 0, 0.99)
        r.pose[0, 24] = (270, 300, 0, 0.99)
    for k, h in enumerate(hands):
        r.hands[0, k] = h
    return r


BODY = body_from_raw(raw_frame(), 0, ANCHOR)


def test_body_in_head_units():
    b = BODY
    assert b.face_x == pytest.approx(0) and b.face_half == pytest.approx(0.5)
    assert b.brow_y == pytest.approx(-0.45) and b.chin_y == pytest.approx(0.75)
    assert b.shoulder_y == pytest.approx(1.5) and b.waist_y == pytest.approx(5.0)


@pytest.mark.parametrize("x,y,expected", [
    (0, -1.5, "arriba"), (0, -0.7, "frente"), (0, -0.1, "nariz"), (0.45, -0.1, "ojo"), (0.45, 0.1, "mejilla"),
    (0, 0.35, "boca"), (0, 0.65, "barbilla"), (0.8, 0.1, "oreja"), (0.8, -0.5, "sien"), (0, 1.1, "cuello"),
    (1.5, 1.5, "hombro"), (0, 2.2, "pecho"), (0, 4.0, "estomago"), (0, 5.8, "cintura"), (3.0, 2.5, "lado"),
])
def test_zones(x, y, expected):
    assert zone(BODY, x, y) == expected


def test_body_without_face_or_torso_uses_typical_proportions():
    b = body_from_raw(raw_frame(face=False, shoulders=False, hips=False), 0, ANCHOR)
    assert b is not None and b.shoulders is None and b.hips_y is None
    assert zone(b, 0, 0.35) == "boca" and zone(b, 0, 2.5) == "pecho"


def test_hand_over_face():
    on_face = make_hand((320, 115), 12)
    low = make_hand((250, 300), 12)
    assert hand_over_face(raw_frame(hands=[on_face]), 0)
    assert not hand_over_face(raw_frame(hands=[low]), 0)
    assert not hand_over_face(raw_frame(face=False, hands=[on_face]), 0)


def test_anchor_does_not_move_while_a_hand_covers_the_face():
    ln = LiveNormalizer(window=3)
    for _ in range(3):
        ln.push(raw_frame(hands=[make_hand((250, 300), 12)]))
    before = np.median(np.array(ln.anchors), axis=0)
    covered = raw_frame(hands=[make_hand((320, 115), 12)])
    covered.face[0, :, 1] += 8  # la malla se deforma bajo la mano
    for _ in range(5):
        ln.push(covered)
    assert ln.occluded
    np.testing.assert_allclose(np.median(np.array(ln.anchors), axis=0), before)


def test_hand_lost_in_front_of_face_is_kept_a_few_frames():
    ln = LiveNormalizer()
    _, p = ln.push(raw_frame(hands=[make_hand((320, 112), 10)]))
    assert p.any()
    kept = [ln.push(raw_frame())[1].any() for _ in range(HOLD_NEAR_FACE + 1)]
    assert kept == [True] * HOLD_NEAR_FACE + [False]


def test_hand_lost_away_from_face_is_not_kept():
    ln = LiveNormalizer()
    ln.push(raw_frame(hands=[make_hand((320, 400), 10)]))
    assert not ln.push(raw_frame())[1].any()


def test_location_tip_names_the_body_zone():
    ev = evaluate_low()  # palma en (0.5, 2.2); la referencia la pone en (0.54, 0.2)
    tips = messages(ev, REF, body=replace(BODY, face_x=0.5, mouth_top=0.1))
    assert any(t.startswith("Mano derecha: llévala a la boca (ahora está a la altura del pecho)") for t in tips), tips
    # Sin cuerpo: el consejo de dirección de siempre.
    assert any(t.startswith("Sube la mano derecha") for t in messages(ev, REF))


def test_same_zone_falls_back_to_direction():
    ev = evaluate_low()
    wide = Body(0.5, 0.5, 0, -0.45, -0.3, 3.5, 3.6, None, None)  # boca enorme: las dos quedan en "boca"
    assert any(t.startswith("Sube la mano derecha") for t in messages(ev, REF, body=wide))


def evaluate_low():
    from lsm.evaluator.scoring import evaluate
    return evaluate(REF, seq(y=3.0))
