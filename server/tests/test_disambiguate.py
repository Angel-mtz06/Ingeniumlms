import numpy as np
import pytest

from lsm.classifier.disambiguate import distinguish_hola_no, distinguish_pairs
from lsm.evaluator.references import build_reference
from lsm.normalize import NormSequence
from lsm.session import Session
from tests.conftest import make_hand


def sequence(flex):
    hands = np.zeros((16, 2, 21, 3), np.float32)
    present = np.zeros((16, 2), bool)
    for t in range(16):
        hands[t, 0] = make_hand(wrist=(-1 + t / 50, 1), flex=flex)
        present[t, 0] = True
    return NormSequence(hands, present)


@pytest.fixture
def examples():
    seqs = {"HOLA": sequence((20, 25, 20, 95, 100)), "NO": sequence((30, 70, 85, 145, 145))}
    return seqs, {g: build_reference(g, [s]) for g, s in seqs.items()}


@pytest.mark.parametrize("actual,other", [("HOLA", "NO"), ("NO", "HOLA")])
def test_ambiguous_pair_uses_finger_shape_without_inflating_confidence(examples, actual, other):
    seqs, refs = examples
    top = [[other, .4], [actual, .3], ["SI", .1]]
    result = distinguish_hola_no(top, seqs[actual], refs)
    assert result == [[actual, .4], [other, .3], ["SI", .1]]
    assert top[0][0] == other


def test_no_override_without_clear_evidence(examples):
    seqs, refs = examples
    ambiguous = [["NO", .4], ["HOLA", .3]]
    assert distinguish_hola_no(ambiguous, seqs["HOLA"], {}) == ambiguous
    for top in ([["NO", .8], ["HOLA", .05]], [["NO", .4], ["SI", .3]],
                [["SI", .5], ["NO", .3], ["HOLA", .2]]):
        assert distinguish_hola_no(top, seqs["HOLA"], refs) == top
    missing = NormSequence(np.zeros((16, 2, 21, 3)), np.zeros((16, 2), bool))
    assert distinguish_hola_no(ambiguous, missing, refs) == ambiguous
    same = {g: build_reference(g, [seqs["HOLA"]]) for g in refs}
    assert distinguish_hola_no(ambiguous, seqs["HOLA"], same) == ambiguous


def test_none_keeps_priority(examples):
    seqs, refs = examples
    top = [["NINGUNA", .5], ["NO", .3], ["HOLA", .15]]
    assert distinguish_hola_no(top, seqs["HOLA"], refs) == [["NINGUNA", .5], ["HOLA", .3], ["NO", .15]]


@pytest.mark.parametrize("mode", ["practice", "translate"])
def test_session_applies_pair_check_in_both_modes(examples, mode):
    seqs, refs = examples

    class AmbiguousClassifier:
        def predict(self, seq, k=4):
            return [("NO", .4), ("HOLA", .3), ("SI", .1)]

    session = Session(AmbiguousClassifier(), refs)
    session.mode, session.target = mode, "NO"  # El objetivo no debe decidir lo reconocido.
    seq = seqs["HOLA"]
    session.hands, session.present = list(seq.hands), list(seq.present)
    session.gflex = [np.full((2, 5), np.nan)] * seq.T
    session.gcont = [np.full((2, 4), np.nan)] * seq.T
    session._span = (0, seq.T - 1)
    out = session._evaluate_segment(0, seq.T - 1)
    if mode == "practice":
        assert out[0]["recognized"][0] == ["HOLA", .4]
    else:
        assert out[0]["gloss"] == "HOLA"
        assert not out[0]["confident"]


def two_hands(flex_dom, flex_other, at_dom, at_other):
    hands = np.zeros((16, 2, 21, 3), np.float32)
    present = np.ones((16, 2), bool)
    for t in range(16):
        hands[t, 0] = make_hand(wrist=(at_dom[0] + t / 50, at_dom[1]), flex=flex_dom)
        hands[t, 1] = make_hand(wrist=(at_other[0] - t / 50, at_other[1]), flex=flex_other)
    return NormSequence(hands, present)


@pytest.fixture
def como_hospital():
    # CÓMO: las dos manos al frente, separadas; HOSPITAL: la dominante sobre el otro brazo, más arriba.
    seqs = {"COMO": two_hands((23, 41, 42, 44, 52), (19, 33, 29, 36, 45), (-0.7, 1.2), (0.7, 1.2)),
            "HOSPITAL": two_hands((27, 29, 99, 108, 110), (48, 63, 65, 86, 96), (0.2, 0.6), (0.4, 2.3))}
    return seqs, {g: build_reference(g, [s]) for g, s in seqs.items()}


@pytest.mark.parametrize("actual,other", [("COMO", "HOSPITAL"), ("HOSPITAL", "COMO")])
def test_como_y_hospital_se_desempatan_con_el_puntaje(como_hospital, actual, other):
    seqs, refs = como_hospital
    top = [[other, .11], [actual, .08], ["CARRO", .06]]
    assert distinguish_pairs(top, seqs[actual], refs) == [[actual, .11], [other, .08], ["CARRO", .06]]


def test_como_hospital_sin_ventaja_clara_no_cambia(como_hospital):
    seqs, refs = como_hospital
    same = {g: build_reference(g, [seqs["COMO"]]) for g in refs}  # las dos referencias iguales: empate
    top = [["HOSPITAL", .11], ["COMO", .08]]
    assert distinguish_pairs(top, seqs["COMO"], same) == top
    assert distinguish_pairs([["HOSPITAL", .5], ["COMO", .08]], seqs["COMO"], refs) == [["HOSPITAL", .5], ["COMO", .08]]
