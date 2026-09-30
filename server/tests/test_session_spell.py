"""Deletreo en Interpretación: la web reconoce las letras y manda la palabra con {"type": "add_word"}."""
import asyncio
import json

from lsm.context import load_default
from lsm.segmenter import Segmenter
from lsm.sentences import SentenceBuilder
from lsm.session import Session
from tests.test_segmenter import REST, feed, up
from tests.test_session import frame, run

HOLA = [("HOLA", 0.9), ("NO", 0.05), ("SI", 0.02)]


class Clf:
    def __init__(self, *outs):
        self.outs = list(outs)

    def predict(self, norm, k=3):
        return (self.outs.pop(0) if self.outs else HOLA)[:k]


def one_sign(rest=10):
    return [frame((-1.0, 5.0))] * 5 + [frame((-1.0 + 0.05 * i, 1.0)) for i in range(20)] + [frame((-1.0, 5.0))] * rest


def session(clf=None, sentences=None, validate=False):
    s = Session(clf or Clf(), {}, sentences or SentenceBuilder(llm=None, provider="none"), context=load_default())
    asyncio.run(s.handle({"type": "hello", "mode": "translate", "target": None}))
    if validate:
        asyncio.run(s.handle({"type": "validate", "enabled": True}))
    return s


def test_add_word_appends_a_confirmed_spelled_item():
    s = session()
    out = asyncio.run(s.handle({"type": "add_word", "word": "ángel", "spelled": True}))
    assert out == [{"type": "sign", "index": 0, "gloss": "ANGEL", "top3": [], "confident": True, "spelled": True,
                    "confirmed": True}]
    assert s.pending == [{"gloss": "ANGEL", "top3": [], "confident": True, "confirmed": True, "spelled": True}]
    out = asyncio.run(s.handle({"type": "add_word", "word": "Ñoño", "spelled": True}))
    assert out[0]["index"] == 1 and out[0]["gloss"] == "ÑOÑO"


def test_add_word_rejects_invalid_words():
    s = session()
    for bad in ({"type": "add_word"}, {"type": "add_word", "word": ""}, {"type": "add_word", "word": 3},
                {"type": "add_word", "word": "HOLA MUNDO"}, {"type": "add_word", "word": "A1"},
                {"type": "add_word", "word": "A" * 25}, {"type": "add_word", "word": "ANGEL", "spelled": False}):
        assert asyncio.run(s.handle(bad))[0]["type"] == "error", bad
    assert s.pending == []


def test_add_word_only_in_translate_mode():
    s = session()
    asyncio.run(s.handle({"type": "hello", "mode": "practice", "target": "HOLA"}))
    assert asyncio.run(s.handle({"type": "add_word", "word": "ANGEL", "spelled": True}))[0]["type"] == "error"


def test_spelled_word_counts_as_name_for_the_next_sign():
    # tras HOLA YO <NOMBRE> el contexto prefiere SORDO a FUEGO
    s = session(Clf(HOLA, [("YO", 0.9)], [("FUEGO", 0.4), ("SORDO", 0.35)]))
    asyncio.run(run(s, one_sign() + one_sign()))
    asyncio.run(s.handle({"type": "add_word", "word": "ANGEL", "spelled": True}))
    out = [m for m in asyncio.run(run(s, one_sign())) if m["type"] == "sign"]
    assert out[0]["gloss"] == "SORDO" and out[0]["reranked"] is True


def test_sentence_keeps_spelled_position_fixed_and_marks_it_for_the_llm():
    seen = {}

    async def llm(system, user):
        seen["user"] = user
        return json.dumps({"glosas": ["HOLA", "YO", "PEDRO"], "oracion": "Hola, soy Ángel."})

    s = session(sentences=SentenceBuilder(llm=llm))
    s.pending = [{"gloss": "HOLA", "top3": [["HOLA", 0.9]], "confident": True},
                 {"gloss": "YO", "top3": [["YO", 0.9]], "confident": True}]
    asyncio.run(s.handle({"type": "add_word", "word": "ANGEL", "spelled": True}))
    sent = asyncio.run(s.handle({"type": "build_sentence"}))[-1]
    assert sent["glosses"] == ["HOLA", "YO", "ANGEL"] and sent["text"] == "Hola, soy Ángel." and sent["corrected"] == []
    assert "3) ANGEL (deletreo)" in seen["user"] and "Deletreadas: ANGEL" in seen["user"]


def test_template_fallback_capitalizes_the_name():
    s = session()
    s.pending = [{"gloss": "HOLA", "top3": [["HOLA", 0.9]], "confident": True},
                 {"gloss": "YO", "top3": [["YO", 0.9]], "confident": True}]
    asyncio.run(s.handle({"type": "add_word", "word": "ANGEL", "spelled": True}))
    sent = asyncio.run(s.handle({"type": "build_sentence"}))[-1]
    assert sent["source"] == "template" and "Angel" in sent["text"]


def test_spelled_word_is_already_validated():
    s = session(validate=True)
    asyncio.run(s.handle({"type": "add_word", "word": "ANGEL", "spelled": True}))
    sent = asyncio.run(s.handle({"type": "build_sentence"}))
    assert sent[-1]["type"] == "sentence" and sent[-1]["glosses"] == ["ANGEL"]


def test_add_word_arms_the_pause_from_zero():
    # tras la palabra, la oración se forma con la pausa normal (3.5 s de reposo), contando desde cero
    s = session()
    asyncio.run(run(s, [frame((-1.0, 5.0))] * 200))  # reposo largo antes de deletrear
    asyncio.run(s.handle({"type": "add_word", "word": "ANGEL", "spelled": True}))
    out = asyncio.run(run(s, [frame((-1.0, 5.0))] * 60))
    assert "sentence" not in [m["type"] for m in out]
    out = asyncio.run(run(s, [frame((-1.0, 5.0))] * 60))
    sent = [m for m in out if m["type"] == "sentence"]
    assert len(sent) == 1 and sent[0]["glosses"] == ["ANGEL"]


def test_interrupt_drops_active_segment():
    seg = Segmenter()
    feed(seg, [REST] * 5 + [up(0.1 * i) for i in range(10)])
    assert seg.state == "active"
    seg.interrupt()
    assert seg.state == "idle" and seg.idle_count == 0
    assert not [e for e in feed(seg, [REST] * 10, start=20) if e.kind == "end"]
