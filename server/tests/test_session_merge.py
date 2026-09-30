"""Interpretación: los pedazos débiles de una seña que se detuvo a la mitad se leen junto con el siguiente."""
import asyncio

from lsm.sentences import SentenceBuilder
from lsm.session import Session
from tests.test_session import frame, run


class LenClassifier:
    """Un pedazo corto (< 25 cuadros) es débil; el tramo completo es MAMÁ clara."""

    def __init__(self, short=(("NINGUNA", 0.30), ("BOMBEROS", 0.20), ("MAMA", 0.10))):
        self.short, self.lens = list(short), []

    def predict(self, norm, k=3):
        self.lens.append(norm.T)
        return (self.short if norm.T < 25 else [("MAMA", 0.70), ("BUENO", 0.10), ("HOLA", 0.05)])[:k]


def piece(x0):
    """Se mueve 8 cuadros y se queda quieta 14: cierra por quietud (un pedazo de ~0.7 s)."""
    return [frame((x0 + 0.1 * i, 1.0)) for i in range(8)] + [frame((x0 + 0.8, 1.0))] * 14


def session(clf):
    s = Session(clf, {}, SentenceBuilder(llm=None, provider="none"))
    asyncio.run(s.handle({"type": "hello", "mode": "translate", "target": None}))
    return s


def signs(out):
    return [m["gloss"] for m in out if m["type"] == "sign"]


def test_dos_pedazos_debiles_seguidos_se_leen_juntos():
    clf = LenClassifier()
    s = session(clf)
    out = asyncio.run(run(s, [frame((-1.0, 5.0))] * 5 + piece(-1.0) + piece(-0.2) + [frame((-1.0, 5.0))] * 10))
    assert signs(out) == ["MAMA"]
    assert max(clf.lens) >= 25  # se leyó el tramo unido


def test_un_pedazo_debil_solo_no_entra_como_sena():
    s = session(LenClassifier())
    out = asyncio.run(run(s, [frame((-1.0, 5.0))] * 5 + piece(-1.0) + [frame((-1.0, 5.0))] * 10))
    assert signs(out) == []


def test_un_pedazo_corto_pero_claro_si_entra():
    s = session(LenClassifier(short=(("HOLA", 0.6), ("NO", 0.1))))
    out = asyncio.run(run(s, [frame((-1.0, 5.0))] * 5 + piece(-1.0) + [frame((-1.0, 5.0))] * 10))
    assert signs(out) == ["HOLA"]
