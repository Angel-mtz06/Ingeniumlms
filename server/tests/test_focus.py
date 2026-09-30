import numpy as np

from lsm.classifier.focus import ALT_MARGIN, extra_hands, focus, without
from lsm.features import REST_Y
from lsm.normalize import NormSequence

T = 20


def _hand(x: float, y: float) -> np.ndarray:
    h = np.zeros((21, 3), np.float32)
    h[:, 0], h[:, 1] = x, y - np.linspace(0, 0.8, 21)  # muñeca en (x, y), dedos hacia arriba
    return h


def seq(slot0=True, slot1=True, rest1=True, move1=False) -> NormSequence:
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for t in range(T):
        if slot0:  # la que hace la seña: arriba y moviéndose
            hands[t, 0], present[t, 0] = _hand(-1.0 + 0.15 * t, 1.5), True
        if slot1:
            y = REST_Y + 1.0 if rest1 else 1.5
            hands[t, 1], present[t, 1] = _hand(1.5 + (0.15 * t if move1 else 0.0), y), True
    return NormSequence(hands, present)


def test_la_otra_mano_en_reposo_o_quieta_puede_sobrar():
    assert extra_hands(seq()) == [1]
    assert extra_hands(seq(rest1=False)) == [1]  # arriba pero quieta mientras la otra se mueve
    assert extra_hands(seq(rest1=False, move1=True)) == []  # seña de dos manos: las dos se mueven
    assert extra_hands(seq(slot1=False)) == []  # una sola mano: nada que quitar


def test_without_quita_esa_mano():
    n = without(seq(), 1)
    assert not n.present[:, 1].any() and n.present[:, 0].all()
    assert np.all(n.hands[:, 1] == 0)


LABELS = ["NINGUNA", "HOLA", "ADIOS"]


def _probs(with_both, alone):
    return lambda n: np.array(alone if not n.present[:, 1].any() else with_both, np.float32)


def test_sin_la_mano_de_mas_se_usa_si_la_sena_sale_mas_clara():
    p, used = focus(_probs([0.5, 0.3, 0.2], [0.1, 0.8, 0.1]), LABELS, seq())
    assert LABELS[int(np.argmax(p))] == "HOLA"
    assert not used.present[:, 1].any()


def test_se_queda_con_las_dos_si_empata_o_si_sin_ella_es_ninguna():
    base = [0.2, 0.5, 0.3]
    p, used = focus(_probs(base, [0.2, 0.5 + ALT_MARGIN / 2, 0.3 - ALT_MARGIN / 2]), LABELS, seq())
    assert used.present[:, 1].any() and np.allclose(p, base)
    p, used = focus(_probs([0.3, 0.4, 0.3], [0.9, 0.05, 0.05]), LABELS, seq())
    assert used.present[:, 1].any()


def test_senas_de_dos_manos_no_se_tocan():
    calls = []
    def probs(n):
        calls.append(n)
        return np.array([0.1, 0.2, 0.7], np.float32)
    focus(probs, LABELS, seq(rest1=False, move1=True))
    assert len(calls) == 1
