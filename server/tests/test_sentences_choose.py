"""Desambiguación al formar la oración: el LLM elige una candidata por posición (JSON) con respaldo Viterbi."""
import asyncio
import json

import pytest

from lsm.context import load_default
from lsm.sentences import CHOOSE_PROMPT, SentenceBuilder, format_positions, parse_choice, template_sentence

POS = [{"candidates": [("HOLA", 0.36), ("NO", 0.08), ("BOMBEROS", 0.08)], "spelled": False},
       {"candidates": [("BOMBEROS", 0.40), ("YO", 0.35)], "spelled": False},
       {"candidates": [("ANGEL", 1.0)], "spelled": True}]


def fake(reply, seen=None):
    async def llm(system, user):
        if seen is not None:
            seen.update(system=system, user=user)
        return reply
    return llm


def choose(llm, positions=POS, prior=None, weight=0.0):
    return asyncio.run(SentenceBuilder(llm=llm).choose(positions, [], prior=prior, weight=weight))


def test_format_positions_lists_candidates_and_marks_spelled():
    assert format_positions(POS) == "1) HOLA 0.36 | NO 0.08 | BOMBEROS 0.08\n2) BOMBEROS 0.40 | YO 0.35\n3) ANGEL (deletreo)"


def test_llm_picks_candidates_and_writes_sentence():
    seen = {}
    reply = json.dumps({"glosas": ["HOLA", "YO", "ANGEL"], "oracion": "Hola, soy Ángel."})
    glosses, text, src = choose(fake(reply, seen))
    assert (glosses, text, src) == (["HOLA", "YO", "ANGEL"], "Hola, soy Ángel.", "llm")
    assert seen["system"] == CHOOSE_PROMPT and "JSON" in CHOOSE_PROMPT
    assert "1) HOLA 0.36 | NO 0.08 | BOMBEROS 0.08" in seen["user"] and "3) ANGEL (deletreo)" in seen["user"]
    assert "Deletreadas: ANGEL" in seen["user"]


def test_llm_json_inside_code_fence_and_case_insensitive():
    reply = '```json\n{"glosas": ["hola", "Yo", "Ángel"], "oracion": "Hola, soy Ángel."}\n```'
    glosses, _, src = choose(fake(reply))
    assert glosses == ["HOLA", "YO", "ANGEL"] and src == "llm"


def test_gloss_outside_candidates_falls_back_to_first():
    reply = json.dumps({"glosas": ["ADIOS", "YO", "PEDRO"], "oracion": "Hola, soy Ángel."})
    glosses, text, src = choose(fake(reply))
    assert glosses == ["HOLA", "YO", "ANGEL"] and src == "llm"


def test_wrong_length_keeps_first_for_missing_positions():
    reply = json.dumps({"glosas": ["HOLA", "YO"], "oracion": "Hola, yo."})
    assert choose(fake(reply))[0] == ["HOLA", "YO", "ANGEL"]
    reply = json.dumps({"glosas": "HOLA", "oracion": "Hola."})
    assert choose(fake(reply))[0] == ["HOLA", "BOMBEROS", "ANGEL"]


@pytest.mark.parametrize("reply", ["Hola, soy Ángel.", "{no es json}", "[1, 2]", '{"glosas": ["HOLA"]}',
                                   '{"glosas": [], "oracion": "   "}', ""])
def test_invalid_json_uses_viterbi_and_template(reply):
    glosses, text, src = choose(fake(reply), prior=load_default(), weight=0.5)
    assert src == "template"
    assert glosses == ["HOLA", "YO", "ANGEL"]  # Viterbi con el prior: tras HOLA, YO y no BOMBEROS
    assert text == template_sentence(["HOLA", "YO", "ANGEL"], {"ANGEL"})


def test_llm_error_or_timeout_uses_fallback():
    async def boom(system, user):
        raise RuntimeError("sin red")

    async def slow(system, user):
        await asyncio.sleep(1)
        return "{}"

    assert choose(boom)[2] == "template"
    b = SentenceBuilder(llm=slow, timeout=0.05)
    assert asyncio.run(b.choose(POS, []))[2] == "template"


def test_without_llm_or_prior_keeps_classifier_top1():
    b = SentenceBuilder(llm=None, provider="none")
    glosses, text, src = asyncio.run(b.choose(POS, [], prior=None, weight=0.5))
    assert glosses == ["HOLA", "BOMBEROS", "ANGEL"] and src == "template"
    assert asyncio.run(b.choose([], [])) == ([], "", "template")


def test_native_clients_request_json_mode(monkeypatch):
    import openai
    calls = []

    class Completions:
        async def create(self, **kw):
            calls.append(kw)

            class R:
                choices = [type("C", (), {"message": type("M", (), {"content": '{"glosas": ["HOLA", "YO", "ANGEL"], "oracion": "Hola."}'})()})()]
            return R()

    class Fake:
        def __init__(self, **kw):
            self.chat = type("Chat", (), {"completions": Completions()})()

    monkeypatch.setattr(openai, "AsyncOpenAI", Fake)
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    monkeypatch.delenv("SENTENCES_MODEL", raising=False)
    b = SentenceBuilder(provider="openai")
    assert asyncio.run(b.choose(POS, []))[0] == ["HOLA", "YO", "ANGEL"]
    assert calls[-1]["response_format"] == {"type": "json_object"}
    assert calls[-1]["model"] == "gpt-4o"  # gpt-4o-mini no se animaba a corregir señas dudosas
    asyncio.run(b.build(["HOLA"], []))
    assert "response_format" not in calls[-1]


def test_parse_choice_rejects_non_string_sentence():
    assert parse_choice('{"glosas": ["HOLA"], "oracion": 3}', POS[:1]) is None
    assert parse_choice('{"glosas": ["HOLA"], "oracion": "Hola."}', POS[:1]) == (["HOLA"], "Hola.")


def test_prompt_prioritizes_coherence_and_conjugates():
    assert "menos de 0.5" in CHOOSE_PROMPT and "coherencia" in CHOOSE_PROMPT
    assert "conjúgalos" in CHOOSE_PROMPT and "HOLA YO <nombre>" in CHOOSE_PROMPT
    assert "No inventes glosas" in CHOOSE_PROMPT
