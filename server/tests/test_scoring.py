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
    # mismo margen que los consejos: 0 si z − Z_MARGIN < 1, 1 si < 2, 2 si no (FLEX_FLOOR = 12°)
    st = finger_status(REF, np.array([[0, 90, 40, 72, 60], [np.nan] * 5]))
    assert st[0].tolist() == [0, 0, 2, 0, 1] and (st[1] == -1).all()  # z: 0, 0, 4.2, 1.5, 2.5


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


def test_deviation_within_one_z_is_not_penalized():
    # variación natural (≤1 z respecto a la referencia) = 100; los consejos empiezan cuando el z
    # con margen (z − Z_MARGIN) pasa de ISSUE_Z, es decir z > 3
    from lsm.evaluator.scoring import ISSUE_Z, Z_MARGIN
    assert (Z_MARGIN, ISSUE_Z) == (1.0, 2.0)
    ev = evaluate(REF, seq(y=1.3))  # 0.3 / LOC_FLOOR(0.35) ≈ 0.86 z
    assert ev.scores["ubicacion"] == 100.0
    assert messages(ev, REF) == []


def test_tip_needs_margin_adjusted_z_above_issue_z():
    ev = evaluate(REF, seq(y=1.0 + 2.5 * 0.35))  # z = 2.5 → z con margen 1.5 < 2: sin consejo
    assert not any(t.startswith("Sube la mano") for t in messages(ev, REF))
    ev = evaluate(REF, seq(y=1.0 + 3.5 * 0.35))  # z = 3.5 → 2.5 > 2: consejo
    assert any(t.startswith("Sube la mano derecha") for t in messages(ev, REF))


def test_tolerance_divides_z_of_that_parameter_only():
    from dataclasses import replace
    s = seq(y=1.0 + 3.5 * 0.35, flex=(0, 60, 90, 90, 90))  # ubicación z = 3.5; índice a 30° de la referencia
    base = evaluate(REF, s)
    loose = evaluate(replace(REF, tolerance={"ubicacion": 2.0}), s)
    assert loose.scores["ubicacion"] > base.scores["ubicacion"] + 30  # z 3.5 → 1.75
    assert loose.scores["configuracion"] == base.scores["configuracion"]  # el resto no cambia
    assert any(t.startswith("Sube la mano") for t in messages(base, REF))
    assert not any(t.startswith("Sube la mano") for t in messages(loose, replace(REF, tolerance={"ubicacion": 2.0})))


def test_tolerance_none_or_empty_changes_nothing():
    from dataclasses import replace
    s = seq(y=2.0, flex=(0, 60, 90, 90, 90))
    a = evaluate(REF, s)
    for tol in (None, {}, {"movimiento": 1.0}):
        b = evaluate(replace(REF, tolerance=tol), s)
        assert (b.scores, b.total) == (a.scores, a.total)


def test_tolerance_also_applies_to_live_finger_status():
    from dataclasses import replace
    flex = np.array([[0, 90, 40, 72, 60], [np.nan] * 5])
    strict = finger_status(REF, flex)[0]
    loose = finger_status(replace(REF, tolerance={"configuracion": 3.0}), flex)[0]
    assert (loose <= strict).all() and loose.sum() < strict.sum()


def test_one_hand_sign_in_the_other_slot_is_still_evaluated():
    from lsm.evaluator.scoring import align_one_hand
    s = seq()
    other = NormSequence(s.hands[:, ::-1].copy(), s.present[:, ::-1].copy(), s.sample_id, s.signer)
    assert any(i.param == "mano" for i in evaluate(REF, other).issues)  # sin alinear: "no veo tu mano"
    a = evaluate(REF, *align_one_hand(REF, other))
    b = evaluate(REF, s)
    assert a.scores == b.scores and not any(i.param == "mano" for i in a.issues)
    # si la mano ya está en su lado no cambia nada
    assert align_one_hand(REF, s)[0] is s


def test_one_hand_sign_made_with_the_other_hand_scores_the_same():
    from lsm.evaluator.scoring import evaluate_either_hand
    from lsm.normalize import mirror
    s = seq()
    assert evaluate_either_hand(REF, mirror(s)).total == evaluate(REF, s).total  # como persona zurda
    assert evaluate_either_hand(REF, s).total == evaluate(REF, s).total
