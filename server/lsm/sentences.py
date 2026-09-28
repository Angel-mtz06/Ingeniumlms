"""Secuencia de glosas LSM → oración en español (LLM con respaldo por plantillas)."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Awaitable, Callable

SYSTEM_PROMPT = """Eres intérprete de Lengua de Señas Mexicana (LSM) a español.
Recibes una secuencia de GLOSAS (palabras en mayúsculas en el orden en que se señaron) y el contexto de oraciones anteriores.
Reglas de la LSM a considerar:
- El tiempo (AYER, HOY, MAÑANA, AHORA, ANTES, PRÓXIMO) suele ir al inicio y marca el tiempo verbal de toda la oración.
- El orden es tema-comentario; no hay artículos ni conjugación: tú los agregas.
- Los pronombres se señalan (YO, TÚ, ÉL…); si no hay sujeto explícito, infiérelo del contexto.
- Las preguntas (DÓNDE, CÓMO, CUÁNTO, QUÉ) pueden ir al final.
Responde SOLO con una oración en español natural y correcto, con puntuación.
No agregues información que no esté en las glosas o en el contexto. Mantén coherencia de género y número con el contexto."""

TIME = {"AYER": "Ayer", "HOY": "Hoy", "MAÑANA": "Mañana", "AHORA": "Ahora", "ANTES": "Antes",
        "PROXIMO": "Próximamente", "NOCHE": "En la noche", "TARDE": "En la tarde"}
YO_VERBS = {"IR": "voy a ir a", "TENER": "tengo", "NECESITAR": "necesito", "QUERER": "quiero",
            "GUSTAR": "me gusta", "ESTAR": "estoy", "COMER": "como", "DORMIR": "duermo", "AYUDA": "necesito ayuda",
            "NO_ENTENDER": "no entiendo", "NO_PODER": "no puedo", "SENTIR": "siento"}
Llm = Callable[[str, str], Awaitable[str]]
log = logging.getLogger(__name__)


def template_sentence(glosses: list[str]) -> str:
    time = [TIME[g] for g in glosses if g in TIME]
    rest = [g for g in glosses if g not in TIME]
    has_yo = "YO" in rest
    rest = [g for g in rest if g != "YO"] if has_yo else rest
    verbs = [g for g in rest if has_yo and g in YO_VERBS]
    others = [g for g in rest if g not in verbs]
    words = [YO_VERBS[v] for v in verbs] + [o.lower().replace("_", " ") for o in others]
    if has_yo and not verbs:
        words = ["yo"] + words
    body = " ".join(words)
    text = f"{time[0]} {body}" if time else body
    text = text.strip()
    return (text[:1].upper() + text[1:] + ".") if text else ""


def _openai_llm(model: str, timeout: float) -> Llm:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(timeout=timeout, max_retries=0)

    async def call(system: str, user: str) -> str:
        r = await client.chat.completions.create(model=model, temperature=0.2, max_tokens=160,
                                                 messages=[{"role": "system", "content": system},
                                                           {"role": "user", "content": user}])
        return r.choices[0].message.content or ""
    return call


def _anthropic_llm(model: str, timeout: float) -> Llm:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(timeout=timeout, max_retries=0)

    async def call(system: str, user: str) -> str:
        r = await client.messages.create(model=model, max_tokens=160, system=system,
                                         messages=[{"role": "user", "content": user}])
        return "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    return call


class SentenceBuilder:
    def __init__(self, llm: Llm | None = None, provider: str | None = None, model: str | None = None,
                 timeout: float = 5.0):  # la 1a llamada (TLS en frío) tardó 2.6 s
        self.timeout = timeout
        self.llm = llm
        if llm is None:
            # SENTENCES_PROVIDER: openai | anthropic | none (solo plantillas)
            provider = provider or os.environ.get("SENTENCES_PROVIDER", "openai")
            if provider == "openai" and os.environ.get("OPENAI_API_KEY"):
                self.llm = _openai_llm(model or os.environ.get("SENTENCES_MODEL", "gpt-4o-mini"), timeout)
            elif provider == "anthropic" and os.environ.get("ANTHROPIC_API_KEY"):
                self.llm = _anthropic_llm(model or os.environ.get("SENTENCES_MODEL", "claude-haiku-4-5-20251001"), timeout)

    async def build(self, glosses: list[str], context: list[str]) -> tuple[str, str]:
        if self.llm is not None:
            user = "Contexto: " + (" ".join(context) if context else "(inicio de la conversación)") + \
                   "\nGlosas: " + " ".join(glosses)
            try:
                text = (await asyncio.wait_for(self.llm(SYSTEM_PROMPT, user), self.timeout)).strip()
                if text:
                    return text, "llm"
                log.warning("el LLM devolvió texto vacío; uso plantilla")
            except Exception as e:
                log.warning("LLM no disponible (%s); uso plantilla", type(e).__name__)
        return template_sentence(glosses), "template"
