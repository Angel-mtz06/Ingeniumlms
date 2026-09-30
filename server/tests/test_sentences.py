import asyncio

from lsm.sentences import SYSTEM_PROMPT, SentenceBuilder, template_sentence


def test_template_moves_time_first_and_conjugates_yo():
    assert template_sentence(["YO", "ESCUELA", "IR", "MAÑANA"]) == "Mañana voy a ir a escuela."
    assert template_sentence(["YO", "DOCTOR", "NECESITAR"]) == "Necesito doctor."
    assert template_sentence(["HOLA"]) == "Hola."
    # Deletreo con el alfabeto: la palabra, no las letras.
    assert template_sentence(["HOLA", "A-N-A"]) == "Hola Ana."
    assert template_sentence(["PEÑA"]) == "Peña."


def test_llm_used_and_context_passed():
    seen = {}

    async def fake(system, user):
        seen["system"], seen["user"] = system, user
        return "  Mañana voy a ir a la escuela.  "

    text, src = asyncio.run(SentenceBuilder(llm=fake).build(["YO", "ESCUELA", "IR", "MAÑANA"], ["Hola, soy sordo."]))
    assert (text, src) == ("Mañana voy a ir a la escuela.", "llm")
    assert seen["system"] == SYSTEM_PROMPT and "YO ESCUELA IR MAÑANA" in seen["user"] and "Hola, soy sordo." in seen["user"]


def test_llm_error_falls_back_to_template():
    async def boom(system, user):
        raise RuntimeError("sin red")

    text, src = asyncio.run(SentenceBuilder(llm=boom).build(["HOLA"], []))
    assert (text, src) == ("Hola.", "template")


def test_no_api_key_uses_template(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    text, src = asyncio.run(SentenceBuilder(provider="openai").build(["GRACIAS"], []))
    assert (text, src) == ("Gracias.", "template")


def test_default_timeout_is_short():
    assert SentenceBuilder(llm=None, provider="none").timeout == 5.0


def test_provider_none_uses_only_templates(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    monkeypatch.setenv("SENTENCES_PROVIDER", "none")
    assert SentenceBuilder().llm is None


def test_clients_do_not_retry(monkeypatch):
    import anthropic
    import openai
    seen = []

    class Fake:
        def __init__(self, **kw):
            seen.append(kw)

    monkeypatch.setattr(openai, "AsyncOpenAI", Fake)
    monkeypatch.setattr(anthropic, "AsyncAnthropic", Fake)
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    assert SentenceBuilder(provider="openai").llm is not None
    assert SentenceBuilder(provider="anthropic").llm is not None
    assert seen == [{"timeout": 5.0, "max_retries": 0}] * 2


def test_fallback_is_logged(caplog):
    async def boom(system, user):
        raise RuntimeError("sin red")

    with caplog.at_level("WARNING", logger="lsm.sentences"):
        asyncio.run(SentenceBuilder(llm=boom).build(["HOLA"], []))
    assert any("plantilla" in r.getMessage() for r in caplog.records)


def test_template_capitalizes_spelled_words():
    assert template_sentence(["HOLA", "MI", "NOMBRE", "ANGEL"], spelled={"ANGEL"}) == "Hola mi nombre Angel."
    assert template_sentence(["ANGEL", "SORDO"], spelled={"ANGEL"}) == "Angel sordo."


def test_llm_gets_spelled_words_and_rule():
    seen = {}

    async def fake(system, user):
        seen["system"], seen["user"] = system, user
        return "Hola, me llamo Ángel."

    text, src = asyncio.run(SentenceBuilder(llm=fake).build(["HOLA", "MI", "NOMBRE", "ANGEL"], [], spelled={"ANGEL"}))
    assert (text, src) == ("Hola, me llamo Ángel.", "llm")
    assert "Glosas: HOLA MI NOMBRE ANGEL" in seen["user"] and "Deletreadas: ANGEL" in seen["user"]
    assert "deletreada" in SYSTEM_PROMPT.lower() and "Ángel" in SYSTEM_PROMPT
    asyncio.run(SentenceBuilder(llm=fake).build(["HOLA"], []))
    assert "Deletreadas" not in seen["user"]
