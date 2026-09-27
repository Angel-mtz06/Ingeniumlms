import numpy as np

from lsm.evaluator.feedback import messages
from lsm.evaluator.references import build_reference
from lsm.evaluator.scoring import evaluate, finger_status, z_to_score
from lsm.normalize import NormSequence
from tests.conftest import make_hand

TARGET = (0, 90, 90, 90, 90)


def seq(flex=TARGET, y=1.0, x0=0.0, T=12, signer="m01", step=0.1):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for t in range(T):
        hands[t, 0] = make_hand(wrist=(x0 + step * t, y), flex=flex)
        present[t, 0] = True
    return NormSequence(hands, present, f"{signer}_X", signer)


REF = build_reference("X", [seq(signer="a"), seq(signer="b", x0=0.02), seq(signer="c", x0=-0.02)])


def test_z_to_score():
    assert z_to_score(0) == 100 and 60 < z_to_score(1) < 61


def test_perfect_execution_scores_high_without_tips():
    ev = evaluate(REF, seq())
    assert ev.total > 90 and all(v > 85 for v in ev.scores.values())
    assert messages(ev, REF) == []


def test_bent_index_is_reported_in_spanish():
    ev = evaluate(REF, seq(flex=(0, 20, 90, 90, 90)))
    assert ev.scores["configuracion"] < ev.scores["ubicacion"]
    tips = messages(ev, REF)
    assert tips and tips[0].startswith("Mano derecha: dobla más el índice")


def test_glove_flex_overrides_camera():
    ev = evaluate(REF, seq(flex=(0, 20, 90, 90, 90)), glove_flex=np.array([[0, 90, 90, 90, 90], [np.nan] * 5]))
    assert ev.scores["configuracion"] > 90


def test_location_tip_says_raise_hand():
    ev = evaluate(REF, seq(y=3.0))
    assert any(t.startswith("Sube la mano derecha") for t in messages(ev, REF))


def test_missing_hand_is_reported():
    s = seq()
    s.present[:] = False
    s.hands[:] = 0
    ev = evaluate(REF, s)
    assert ev.total < 50
    assert messages(ev, REF)[0].startswith("No veo tu mano derecha")


def test_finger_status_codes():
    st = finger_status(REF, np.array([[0, 90, 40, 90, 90], [np.nan] * 5]))
    assert st[0].tolist()[:3] == [0, 0, 2] and (st[1] == -1).all()


def test_max_two_tips():
    ev = evaluate(REF, seq(flex=(90, 0, 0, 0, 0), y=3.5, step=0.4))
    assert len(messages(ev, REF)) == 2


def two_hand_seq(flex=TARGET, x0=0.0, T=12, signer="m01", step=0.1, present1=True):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for t in range(T):
        hands[t, 0] = make_hand(wrist=(x0 + step * t, 1.0), flex=flex)
        present[t, 0] = True
        if present1:
            hands[t, 1] = make_hand(wrist=(1.0, 1.0), flex=flex)
            present[t, 1] = True
    return NormSequence(hands, present, f"{signer}_Y", signer)


REF2 = build_reference("Y", [two_hand_seq(signer="a"), two_hand_seq(signer="b", x0=0.02),
                              two_hand_seq(signer="c", x0=-0.02)])


def test_missing_non_dominant_hand_keeps_movement_score():
    ev = evaluate(REF2, two_hand_seq(present1=False))
    assert ev.scores["movimiento"] > 90
    tips = messages(ev, REF2)
    assert tips and tips[0].startswith("No veo tu mano izquierda")


def test_horizontal_location_tip_direction():
    ev = evaluate(REF, seq(x0=3.0))
    tips = messages(ev, REF)
    assert any(t.startswith("Mueve la mano derecha hacia tu derecha") for t in tips)
