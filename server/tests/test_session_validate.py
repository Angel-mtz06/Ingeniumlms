"""Modo "Validar cada seña" ({"type": "validate"}): la pausa no forma la oración con señas sin confirmar."""
import asyncio

from lsm.sentences import SentenceBuilder
from lsm.session import Session
from tests.test_session import frame, run

HOLA = [("HOLA", 0.9), ("NO", 0.05), ("SI", 0.02)]


class CountingSentences(SentenceBuilder):
    def __init__(self):
        super().__init__(llm=None, provider="none")
        self.calls = 0

    async def choose(self, positions, context, **kw):
        self.calls += 1
        return await super().choose(positions, context, **kw)


class Clf:
    def predict(self, norm, k=3):
        return HOLA[:k]


def sign_then_rest(rest=120):
    """Una seña y reposo suficiente para la pausa de oración (3.5 s = 105 cuadros a 30 fps)."""
    return [frame((-1.0, 5.0))] * 5 + [frame((-1.0 + 0.05 * i, 1.0)) for i in range(20)] + [frame((-1.0, 5.0))] * rest


def session(validate):
    sb = CountingSentences()
    s = Session(Clf(), {}, sb)
    asyncio.run(s.handle({"type": "hello", "mode": "translate", "target": None}))
    if validate is not None:
        assert asyncio.run(s.handle({"type": "validate", "enabled": validate})) == [
            {"type": "validate", "enabled": validate}]
    return s, sb


def types(out):
    return [m["type"] for m in out]


def test_validate_is_off_by_default_and_survives_hello_and_reset():
    s, _ = session(None)
    assert s.validate is False
    asyncio.run(s.handle({"type": "validate", "enabled": True}))
    asyncio.run(s.handle({"type": "hello", "mode": "practice", "target": "HOLA"}))
    asyncio.run(s.handle({"type": "reset"}))
    assert s.validate is True
    for bad in ({"type": "validate"}, {"type": "validate", "enabled": "si"}, {"type": "validate", "enabled": 1}):
        assert types(asyncio.run(s.handle(bad))) == ["error"]
    assert s.validate is True


def test_without_validate_the_pause_forms_the_sentence():
    s, sb = session(False)
    out = asyncio.run(run(s, sign_then_rest()))
    assert "sentence" in types(out) and sb.calls == 1


def test_validate_pause_with_unconfirmed_does_not_call_llm():
    s, sb = session(True)
    out = asyncio.run(run(s, sign_then_rest()))
    assert "sentence" not in types(out) and sb.calls == 0
    # ni cuenta regresiva: se muestra solo cuando todo está validado
    assert "pausing" not in types(out)
    # la pausa avisa con la lista vigente y cuáles faltan por confirmar
    pend = [m for m in out if m["type"] == "pending"]
    assert pend[-1] == {"type": "pending", "glosses": ["HOLA"], "confirmed": [False], "awaiting_validation": True}
    assert [p["gloss"] for p in s.pending] == ["HOLA"]
    # build_sentence tampoco la forma mientras falte validar
    out = asyncio.run(s.handle({"type": "build_sentence"}))
    assert types(out) == ["pending"] and out[0]["awaiting_validation"] is True and sb.calls == 0


def test_validate_with_all_confirmed_forms_the_sentence():
    s, sb = session(True)
    asyncio.run(run(s, sign_then_rest(rest=10)))  # la seña, sin llegar a la pausa
    out = asyncio.run(s.handle({"type": "confirm_gloss", "index": 0, "gloss": "HOLA"}))
    assert out == [{"type": "pending", "glosses": ["HOLA"], "confirmed": [True]}]
    out = asyncio.run(run(s, [frame((-1.0, 5.0))] * 120))
    assert "pausing" in types(out) and "sentence" in types(out) and sb.calls == 1
    sent = next(m for m in out if m["type"] == "sentence")
    assert sent["glosses"] == ["HOLA"]


def test_validate_build_sentence_after_confirming_everything():
    s, sb = session(True)
    asyncio.run(run(s, sign_then_rest()))
    asyncio.run(s.handle({"type": "confirm_gloss", "index": 0, "gloss": "NO"}))
    out = asyncio.run(s.handle({"type": "build_sentence"}))
    assert types(out) == ["sentence"] and out[0]["glosses"] == ["NO"] and sb.calls == 1


def test_removing_the_only_unconfirmed_leaves_nothing_to_validate():
    s, sb = session(True)
    asyncio.run(run(s, sign_then_rest()))
    out = asyncio.run(s.handle({"type": "remove_gloss", "index": 0}))
    assert out == [{"type": "pending", "glosses": [], "confirmed": []}]
    assert asyncio.run(s.handle({"type": "build_sentence"})) == [{"type": "pending", "glosses": [], "confirmed": []}]
    assert sb.calls == 0
