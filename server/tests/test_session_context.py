"""Contexto en Traducción: reordenamiento del top-k por la glosa previa y desambiguación al formar la oración."""
import asyncio
import json

import pytest

from lsm.context import load_default
from lsm.sentences import SentenceBuilder
from lsm.session import Session
from tests.test_session import frame, run


def one_sign(rest=10):
    """Una seña corta que cierra por reposo sin llegar a la pausa de oración."""
    return [frame((-1.0, 5.0))] * 5 + [frame((-1.0 + 0.05 * i, 1.0)) for i in range(20)] + [frame((-1.0, 5.0))] * rest


class SeqClassifier:
    """Devuelve, en cada llamada, la siguiente lista de candidatas; registra la k pedida."""

    def __init__(self, *outputs):
        self.outputs, self.ks = list(outputs), []

    def predict(self, norm, k=3):
        self.ks.append(k)
        return self.outputs.pop(0)[:k]


HOLA = [("HOLA", 0.9), ("NO", 0.05), ("SI", 0.02)]
AMBIG = [("BOMBEROS", 0.40), ("YO", 0.30), ("NO", 0.10), ("DIA", 0.03), ("NINGUNA", 0.02)]


def session(clf, weight=0.5, sentences=None):
    s = Session(clf, {}, sentences or SentenceBuilder(llm=None, provider="none"), context=load_default(),
                context_weight=weight)
    asyncio.run(s.handle({"type": "hello", "mode": "translate", "target": None}))
    return s


def signs(out):
    return [m for m in out if m["type"] == "sign"]


def test_context_reranks_after_hola_and_asks_k5():
    clf = SeqClassifier(HOLA, AMBIG)
    s = session(clf)
    out = asyncio.run(run(s, one_sign() + one_sign()))
    first, second = signs(out)
    assert first["gloss"] == "HOLA" and "reranked" not in first
    assert second["gloss"] == "YO" and second["reranked"] is True
    assert second["top3"] == [["YO", 0.3], ["BOMBEROS", 0.4], ["NO", 0.1]]  # probabilidades originales
    assert second["confident"] is False
    assert clf.ks == [5, 5]


def test_weight_zero_keeps_classifier_order():
    s = session(SeqClassifier(HOLA, AMBIG), weight=0.0)
    second = signs(asyncio.run(run(s, one_sign() + one_sign())))[1]
    assert second["gloss"] == "BOMBEROS" and "reranked" not in second
    assert second["top3"] == [["BOMBEROS", 0.4], ["YO", 0.3], ["NO", 0.1]]


def test_without_context_model_nothing_changes():
    s = Session(SeqClassifier(HOLA, AMBIG), {}, SentenceBuilder(llm=None, provider="none"))
    asyncio.run(s.handle({"type": "hello", "mode": "translate", "target": None}))
    assert signs(asyncio.run(run(s, one_sign() + one_sign())))[1]["gloss"] == "BOMBEROS"


def test_confident_top1_and_low_alternatives_are_respected():
    locked = [("BOMBEROS", 0.7), ("YO", 0.25)]
    low = [("BOMBEROS", 0.5), ("YO", 0.04)]
    s = session(SeqClassifier(HOLA, locked, HOLA, low), weight=3.0)
    out = signs(asyncio.run(run(s, one_sign() * 4)))
    assert [m["gloss"] for m in out] == ["HOLA", "BOMBEROS", "HOLA", "BOMBEROS"]


def test_context_restarts_after_sentence_and_reset():
    # tras HOLA, AMIGO (p 0.3) le gana a DOLOR (p 0.4); al inicio de oración (<s>) no
    cand = [("DOLOR", 0.40), ("AMIGO", 0.30)]
    s = session(SeqClassifier(HOLA, cand))
    asyncio.run(run(s, one_sign() + one_sign()))
    assert [p["gloss"] for p in s.pending] == ["HOLA", "AMIGO"]
    s = session(SeqClassifier(HOLA, cand, HOLA, cand))
    asyncio.run(run(s, one_sign() + [{"type": "build_sentence"}] + one_sign()))
    assert [p["gloss"] for p in s.pending] == ["DOLOR"]
    asyncio.run(run(s, [{"type": "reset"}] + one_sign() + [{"type": "reset"}] + one_sign()))
    assert [p["gloss"] for p in s.pending] == ["DOLOR"]


def test_rerank_is_logged(caplog):
    caplog.set_level("INFO", logger="lsm.session")
    s = session(SeqClassifier(HOLA, AMBIG))
    asyncio.run(run(s, one_sign() + one_sign()))
    msgs = [r.getMessage() for r in caplog.records if r.getMessage().startswith("contexto")]
    assert len(msgs) == 1 and "BOMBEROS->YO" in msgs[0] and "previa=HOLA" in msgs[0]


def test_spelled_previous_counts_as_name():
    s = session(SeqClassifier([("FUEGO", 0.4), ("SORDO", 0.35)]))
    s.pending = [{"gloss": "HOLA", "top3": [["HOLA", 0.9]], "confident": True},
                 {"gloss": "YO", "top3": [["YO", 0.9]], "confident": True},
                 {"gloss": "ANGEL", "top3": [], "confident": True, "spelled": True}]
    out = signs(asyncio.run(run(s, one_sign())))
    assert out[0]["gloss"] == "SORDO" and out[0]["reranked"] is True


def test_sentence_reports_llm_choice_and_corrected_indices():
    seen = {}

    async def llm(system, user):
        seen["user"] = user
        return json.dumps({"glosas": ["HOLA", "YO", "SORDO"], "oracion": "Hola, soy sordo."})

    s = session(SeqClassifier(), weight=0.0, sentences=SentenceBuilder(llm=llm))
    s.pending = [{"gloss": "HOLA", "top3": [["HOLA", 0.36], ["NO", 0.08], ["BOMBEROS", 0.08], ["DIA", 0.01]],
                  "confident": False},
                 {"gloss": "BOMBEROS", "top3": [["BOMBEROS", 0.4], ["YO", 0.35]], "confident": False},
                 {"gloss": "FUEGO", "top3": [["FUEGO", 0.9], ["SORDO", 0.05]], "confident": True}]
    out = asyncio.run(s.handle({"type": "build_sentence"}))
    sent = out[-1]
    assert sent["type"] == "sentence" and sent["source"] == "llm"
    # la posición 3 (p 0.9 ≥ 0.7) va sin alternativas: el LLM no puede cambiarla
    assert sent["glosses"] == ["HOLA", "YO", "FUEGO"] and sent["corrected"] == [1]
    assert "1) HOLA 0.36 | NO 0.08 | BOMBEROS 0.08\n2) BOMBEROS 0.40 | YO 0.35\n3) FUEGO 0.90" in seen["user"]
    assert s.pending == []


def test_sentence_confirmed_and_spelled_positions_are_fixed():
    seen = {}

    async def llm(system, user):
        seen["user"] = user
        return json.dumps({"glosas": ["BOMBEROS", "ANGEL"], "oracion": "Hola, soy Ángel."})

    s = session(SeqClassifier(), sentences=SentenceBuilder(llm=llm))
    s.pending = [{"gloss": "HOLA", "top3": [["HOLA", 0.3], ["BOMBEROS", 0.2]], "confident": False},
                 {"gloss": "ANGEL", "top3": [], "confident": True, "spelled": True}]
    asyncio.run(s.handle({"type": "confirm_gloss", "index": 0, "gloss": "HOLA"}))
    sent = asyncio.run(s.handle({"type": "build_sentence"}))[-1]
    assert sent["glosses"] == ["HOLA", "ANGEL"] and sent["corrected"] == []
    assert "1) HOLA 1.00\n2) ANGEL (deletreo)" in seen["user"]


def test_sentence_fallback_uses_viterbi_with_prior():
    s = session(SeqClassifier())
    s.pending = [{"gloss": "HOLA", "top3": [["HOLA", 0.36], ["NO", 0.08]], "confident": False},
                 {"gloss": "BOMBEROS", "top3": [["BOMBEROS", 0.4], ["YO", 0.35]], "confident": False}]
    sent = asyncio.run(s.handle({"type": "build_sentence"}))[-1]
    assert sent["source"] == "template" and sent["glosses"] == ["HOLA", "YO"] and sent["corrected"] == [1]


def test_llm_choice_can_be_disabled(monkeypatch):
    monkeypatch.setenv("LSM_CONTEXT_LLM", "0")
    seen = {}

    async def llm(system, user):
        seen["user"] = user
        return json.dumps({"glosas": ["HOLA", "YO"], "oracion": "Hola, yo."})

    s = session(SeqClassifier(), sentences=SentenceBuilder(llm=llm))
    s.pending = [{"gloss": "HOLA", "top3": [["HOLA", 0.36], ["NO", 0.08]], "confident": False},
                 {"gloss": "BOMBEROS", "top3": [["BOMBEROS", 0.4], ["YO", 0.35]], "confident": False}]
    sent = asyncio.run(s.handle({"type": "build_sentence"}))[-1]
    assert sent["glosses"] == ["HOLA", "BOMBEROS"] and sent["corrected"] == []
    assert "1) HOLA 0.36\n2) BOMBEROS 0.40" in seen["user"]


@pytest.mark.parametrize("weight", [0.0, 0.5])
def test_practice_mode_is_not_reranked(weight):
    s = Session(SeqClassifier(AMBIG), {}, SentenceBuilder(llm=None, provider="none"), context=load_default(),
                context_weight=weight)
    asyncio.run(s.handle({"type": "hello", "mode": "practice", "target": "HOLA"}))
    ev = next(m for m in asyncio.run(run(s, one_sign(rest=30))) if m["type"] == "evaluation")
    assert [g for g, _ in ev["recognized"]] == ["BOMBEROS", "YO", "NO"]
