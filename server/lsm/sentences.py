"""Secuencia de glosas LSM → oración en español (LLM con respaldo por plantillas)."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Awaitable, Callable, Sequence

from lsm.context import ContextModel, viterbi
from lsm.vocab import canonical

_RULES = """Reglas de la LSM a considerar:
- El tiempo (AYER, HOY, MAÑANA, AHORA, ANTES, PRÓXIMO) suele ir al inicio y marca el tiempo verbal de toda la oración.
- El orden es tema-comentario; no hay artículos ni conjugación: tú los agregas.
- Los pronombres se señalan (YO, TÚ, ÉL…); si no hay sujeto explícito, infiérelo del contexto.
- Las preguntas (DÓNDE, CÓMO, CUÁNTO, QUÉ) pueden ir al final.
- Los verbos vienen en infinitivo (ESTAR, TENER, IR…): conjúgalos siempre. Saludos y presentaciones frecuentes:
  HOLA COMO ESTAR → "Hola, ¿cómo estás?"; YO + nombre deletreado → "soy …"; MI NOMBRE + nombre → "me llamo …";
  YO SORDO → "soy sordo"; NO_ENTENDER → "no entiendo".
- Las palabras DELETREADAS con el alfabeto manual se indican aparte ("Deletreadas: …"). Casi siempre son nombres
  propios (personas, lugares, marcas): no las traduzcas; escríbelas con mayúscula inicial y la acentuación correcta
  si es obvia (ANGEL → Ángel, MONICA → Mónica). Con MI NOMBRE + un nombre deletreado, lo natural es "me llamo …"."""
_STYLE = """No agregues información que no esté en las glosas o en el contexto. Mantén coherencia de género y número con el contexto."""

SYSTEM_PROMPT = f"""Eres intérprete de Lengua de Señas Mexicana (LSM) a español.
Recibes una secuencia de GLOSAS (palabras en mayúsculas en el orden en que se señaron) y el contexto de oraciones anteriores.
{_RULES}
Responde SOLO con una oración en español natural y correcto, con puntuación.
{_STYLE}"""

# Con candidatas por posición: el LLM desambigua (elige una glosa por seña) y después redacta.
CHOOSE_PROMPT = f"""Eres intérprete de Lengua de Señas Mexicana (LSM) a español.
Un reconocedor visual clasificó cada seña por separado y a veces confunde señas parecidas. Recibes, en el orden en que
se señaron, POSICIONES numeradas; cada una trae sus CANDIDATAS separadas por "|" con la probabilidad del reconocedor
(0 a 1). La primera candidata es la que ya se mostró (el reconocedor ya consideró la seña anterior). También recibes
el contexto de oraciones anteriores.
Paso 1: elige UNA candidata por posición. Las probabilidades bajas (menos de 0.5) indican que el reconocedor dudó: ahí
la coherencia pesa más que la probabilidad. Si la primera no encaja con el resto de la oración o con el contexto (por
ejemplo, HOLA BOMBEROS <nombre> no tiene sentido; HOLA YO <nombre> sí), elige la alternativa que forme la oración
más natural, aunque tenga menor probabilidad. Solo conserva una candidata incoherente si ninguna alternativa encaja.
No inventes glosas, no cambies el orden ni omitas posiciones. Las posiciones marcadas "(deletreo)" se eligen tal cual.
Paso 2: escribe la oración en español con las glosas elegidas.
{_RULES}
{_STYLE}
Responde SOLO con un objeto JSON, sin texto adicional: {{"glosas": ["GLOSA", …], "oracion": "…"}} con exactamente una
glosa por posición, escrita igual que la candidata elegida, y la oración en español natural y correcto, con puntuación."""

TIME = {"AYER": "Ayer", "HOY": "Hoy", "MAÑANA": "Mañana", "AHORA": "Ahora", "ANTES": "Antes",
        "PROXIMO": "Próximamente", "NOCHE": "En la noche", "TARDE": "En la tarde"}
YO_VERBS = {"IR": "voy a ir a", "TENER": "tengo", "NECESITAR": "necesito", "QUERER": "quiero",
            "GUSTAR": "me gusta", "ESTAR": "estoy", "COMER": "como", "DORMIR": "duermo", "AYUDA": "necesito ayuda",
            "NO_ENTENDER": "no entiendo", "NO_PODER": "no puedo", "SENTIR": "siento"}
Llm = Callable[[str, str], Awaitable[str]]
log = logging.getLogger(__name__)


def template_sentence(glosses: list[str], spelled=()) -> str:
    """Respaldo sin LLM. `spelled`: glosas deletreadas (nombres propios): van con mayúscula inicial."""
    spelled = set(spelled)
    time = [TIME[g] for g in glosses if g in TIME]
    rest = [g for g in glosses if g not in TIME]
    has_yo = "YO" in rest
    rest = [g for g in rest if g != "YO"] if has_yo else rest
    verbs = [g for g in rest if has_yo and g in YO_VERBS]
    others = [g for g in rest if g not in verbs]
    words = [YO_VERBS[v] for v in verbs] + [o.capitalize() if o in spelled else o.lower().replace("_", " ")
                                            for o in others]
    if has_yo and not verbs:
        words = ["yo"] + words
    body = " ".join(words)
    text = f"{time[0]} {body}" if time else body
    text = text.strip()
    return (text[:1].upper() + text[1:] + ".") if text else ""


def _openai_llm(model: str, timeout: float) -> Llm:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(timeout=timeout, max_retries=0)

    async def call(system: str, user: str, json_mode: bool = False) -> str:
        extra = {"response_format": {"type": "json_object"}} if json_mode else {}
        r = await client.chat.completions.create(model=model, temperature=0.2, max_tokens=300 if json_mode else 160,
                                                 messages=[{"role": "system", "content": system},
                                                           {"role": "user", "content": user}], **extra)
        return r.choices[0].message.content or ""
    return call


def _anthropic_llm(model: str, timeout: float) -> Llm:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(timeout=timeout, max_retries=0)

    async def call(system: str, user: str, json_mode: bool = False) -> str:
        # Anthropic no tiene modo JSON: basta la instrucción del prompt (parse_choice tolera ```json …```)
        r = await client.messages.create(model=model, max_tokens=300 if json_mode else 160, system=system,
                                         messages=[{"role": "user", "content": user}])
        return "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    return call


class SentenceBuilder:
    def __init__(self, llm: Llm | None = None, provider: str | None = None, model: str | None = None,
                 timeout: float = 5.0):  # la 1a llamada (TLS en frío) tardó 2.6 s
        self.timeout = timeout
        self.llm = llm
        self.native = llm is None  # los clientes propios aceptan json_mode; un llm inyectado recibe (system, user)
        if llm is None:
            # SENTENCES_PROVIDER: openai | anthropic | none (solo plantillas)
            provider = provider or os.environ.get("SENTENCES_PROVIDER", "openai")
            if provider == "openai" and os.environ.get("OPENAI_API_KEY"):
                self.llm = _openai_llm(model or os.environ.get("SENTENCES_MODEL", "gpt-4o"), timeout)  # gpt-4o-mini no se animaba a corregir señas dudosas (HOLA BOMBEROS)
            elif provider == "anthropic" and os.environ.get("ANTHROPIC_API_KEY"):
                self.llm = _anthropic_llm(model or os.environ.get("SENTENCES_MODEL", "claude-haiku-4-5-20251001"), timeout)

    async def build(self, glosses: list[str], context: list[str], spelled=()) -> tuple[str, str]:
        """`spelled`: glosas que la persona deletreó con el alfabeto manual (normalmente nombres propios)."""
        spelled = [g for g in dict.fromkeys(glosses) if g in set(spelled)]
        if self.llm is not None:
            user = "Contexto: " + (" ".join(context) if context else "(inicio de la conversación)") + \
                   "\nGlosas: " + " ".join(glosses)
            if spelled:
                user += "\nDeletreadas: " + " ".join(spelled)
            try:
                text = (await asyncio.wait_for(self.llm(SYSTEM_PROMPT, user), self.timeout)).strip()
                if text:
                    return text, "llm"
                log.warning("el LLM devolvió texto vacío; uso plantilla")
            except Exception as e:
                log.warning("LLM no disponible (%s); uso plantilla", type(e).__name__)
        return template_sentence(glosses, spelled), "template"

    async def choose(self, positions: Sequence[dict], context: list[str], prior: ContextModel | None = None,
                     weight: float = 0.0) -> tuple[list[str], str, str]:
        """Desambigua y redacta. `positions`: una por seña, `{"candidates": [(glosa, p)…], "spelled": bool}`; la
        primera candidata es la que se mostró. El LLM elige una candidata por posición y escribe la oración (JSON).
        Sin LLM, o si su respuesta no sirve, elige Viterbi con el prior de bigramas y redacta la plantilla.
        Devuelve (glosas elegidas, oración, "llm"|"template")."""
        spelled_idx = {i for i, pos in enumerate(positions) if pos.get("spelled")}
        spelled = [g for g in dict.fromkeys(pos["candidates"][0][0] for i, pos in enumerate(positions)
                                            if i in spelled_idx)]
        if self.llm is not None and positions:
            user = ("Contexto: " + (" ".join(context) if context else "(inicio de la conversación)")
                    + "\nPosiciones:\n" + format_positions(positions))
            if spelled:
                user += "\nDeletreadas: " + " ".join(spelled)
            try:
                call = (self.llm(CHOOSE_PROMPT, user, json_mode=True) if self.native
                        else self.llm(CHOOSE_PROMPT, user))
                parsed = parse_choice(await asyncio.wait_for(call, self.timeout), positions)
                if parsed is not None:
                    return parsed[0], parsed[1], "llm"
                log.warning("el LLM no devolvió un JSON válido; uso Viterbi y plantilla")
            except Exception as e:
                log.warning("LLM no disponible (%s); uso Viterbi y plantilla", type(e).__name__)
        chosen = viterbi([pos["candidates"] for pos in positions], prior, weight, spelled=spelled_idx)
        return chosen, template_sentence(chosen, spelled), "template"


def format_positions(positions: Sequence[dict]) -> str:
    """`1) HOLA 0.36 | NO 0.08 | BOMBEROS 0.08` por posición; las deletreadas: `2) ANGEL (deletreo)`."""
    lines = []
    for i, pos in enumerate(positions, 1):
        if pos.get("spelled"):
            lines.append(f"{i}) {pos['candidates'][0][0]} (deletreo)")
        else:
            lines.append(f"{i}) " + " | ".join(f"{g} {float(p):.2f}" for g, p in pos["candidates"]))
    return "\n".join(lines)


def parse_choice(raw: str, positions: Sequence[dict]) -> tuple[list[str], str] | None:
    """(glosas, oración) de la respuesta JSON del LLM, o None si no es JSON con una `oracion` no vacía.
    Cada glosa se valida contra las candidatas de su posición; si falta o no está, queda la primera."""
    text = (raw or "").strip()
    a, b = text.find("{"), text.rfind("}")  # tolera ```json … ``` o texto alrededor
    if a < 0 or b <= a:
        return None
    try:
        data = json.loads(text[a:b + 1])
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    sentence, picks = data.get("oracion"), data.get("glosas")
    if not isinstance(sentence, str) or not sentence.strip():
        return None
    picks = picks if isinstance(picks, list) else []
    if len(picks) != len(positions):
        log.warning("el LLM eligió %d glosas para %d posiciones; las que falten quedan como estaban",
                    len(picks), len(positions))
    chosen = []
    for i, pos in enumerate(positions):
        cands = [g for g, _ in pos["candidates"]]
        pick = picks[i] if i < len(picks) and isinstance(picks[i], str) else None
        match = next((g for g in cands if pick is not None and canonical(g) == canonical(pick)), None)
        if pick is not None and match is None:
            log.warning("el LLM eligió una glosa fuera de las candidatas en la posición %d; queda la primera", i + 1)
        chosen.append(match or cands[0])
    return chosen, sentence.strip()
