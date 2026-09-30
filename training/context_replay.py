"""Evidencia del contexto de glosas: encadena grabaciones reales de un signante (una por glosa) en frases del corpus,
las reproduce en una Session de Traducción sin y con contexto, y compara el top-1 de cada seña y la oración.

Uso: python training/context_replay.py [--signer g02] [--weight 0.5] [--gap 20]
Solo lee datasets/raw_landmarks/glosses y el modelo activo; oraciones con plantilla (sin LLM).
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from replay import raw_to_frames  # noqa: E402

from lsm.classifier.infer import Classifier  # noqa: E402
from lsm.context import load_default  # noqa: E402
from lsm.paths import MODELS, RAW_LANDMARKS, active_model_name  # noqa: E402
from lsm.schema import RawSequence  # noqa: E402
from lsm.sentences import SentenceBuilder  # noqa: E402
from lsm.session import Session  # noqa: E402

PHRASES = [
    "HOLA YO", "HOLA COMO ESTAR", "HOLA AMIGO", "HOLA YO SORDO", "MI AMIGO SORDO", "YO SORDO NO_ESCUCHAR",
    "YO TENER DOLOR CABEZA", "YO NECESITAR DOCTOR", "LLAMAR AMBULANCIA POR_FAVOR", "DONDE BAÑO",
    "GRACIAS NOS_VEMOS", "FUEGO EDIFICIO LLAMAR BOMBEROS", "YO SENTIR MAREADO", "MI CABEZA DOLOR",
]


def phrase_frames(glosses: list[str], signer: str, gap: int) -> list[dict]:
    """Cuadros de las grabaciones seguidas, con `gap` cuadros sin manos (reposo) antes y después de cada una y
    marcas de tiempo a los fps de la grabación."""
    frames, t = [], 0.0
    for g in glosses:
        raw = RawSequence.load(RAW_LANDMARKS / "glosses" / f"{signer}_{g}.npz")
        fr = raw_to_frames(raw)
        dt = 1000.0 / (raw.fps or 30.0)
        rest = dict(fr[0], hands=[])
        for f in [rest] * gap + fr + [rest] * gap:
            frames.append(dict(f, t=round(t, 1)))
            t += dt
    return frames


async def run(clf, context, weight: float, glosses: list[str], signer: str, gap: int):
    s = Session(clf, {}, SentenceBuilder(llm=None, provider="none"), context=context, context_weight=weight)
    await s.handle({"type": "hello", "mode": "translate", "target": None})
    signs = []
    for f in phrase_frames(glosses, signer, gap):
        for m in await s.handle(f):
            if m["type"] == "sign":
                signs.append(m)
    sent = [m for m in await s.handle({"type": "build_sentence"}) if m["type"] == "sentence"]
    return signs, (sent[0] if sent else None)


def fmt_sign(m) -> str:
    alts = " ".join(f"{g}:{p:.2f}" for g, p in m["top3"])
    return f"{m['gloss']}{'*' if m.get('reranked') else ''} [{alts}]"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--signer", default="g02")
    ap.add_argument("--weight", type=float, default=0.5)
    ap.add_argument("--gap", type=int, default=20, help="cuadros de reposo entre señas (< pausa de oración)")
    a = ap.parse_args()
    name = active_model_name()
    clf = Classifier.load(MODELS / f"{name}.pt")
    context = load_default(clf.labels)
    print(f"modelo={name} signante={a.signer} lambda={a.weight} (* = top-1 cambiado por contexto)\n")
    tot = {"n": 0, "sin": 0, "con": 0, "ora_sin": 0, "ora_con": 0}
    for phrase in PHRASES:
        gl = phrase.split()
        s0, o0 = asyncio.run(run(clf, context, 0.0, gl, a.signer, a.gap))
        s1, o1 = asyncio.run(run(clf, context, a.weight, gl, a.signer, a.gap))
        print(f"## {phrase}")
        print("  sin contexto: " + " | ".join(fmt_sign(m) for m in s0))
        print("  con contexto: " + " | ".join(fmt_sign(m) for m in s1))
        g0 = o0["glosses"] if o0 else []
        g1 = o1["glosses"] if o1 else []
        print(f"  oración sin: {' '.join(g0)}  →  {o0['text'] if o0 else '-'}")
        print(f"  oración con: {' '.join(g1)} corrected={o1['corrected'] if o1 else []}  →  {o1['text'] if o1 else '-'}\n")
        if len(s0) == len(gl) == len(s1):  # solo cuenta posiciones alineadas (una seña por grabación)
            tot["n"] += len(gl)
            tot["sin"] += sum(m["gloss"] == g for m, g in zip(s0, gl))
            tot["con"] += sum(m["gloss"] == g for m, g in zip(s1, gl))
            tot["ora_sin"] += sum(x == g for x, g in zip(g0, gl))
            tot["ora_con"] += sum(x == g for x, g in zip(g1, gl))
    n = max(tot["n"], 1)
    print(f"Posiciones alineadas: {tot['n']}. Top-1 en vivo: sin {tot['sin']}/{n} ({100 * tot['sin'] / n:.0f} %), "
          f"con {tot['con']}/{n} ({100 * tot['con'] / n:.0f} %). Glosas de la oración (Viterbi): "
          f"sin {tot['ora_sin']}/{n}, con {tot['ora_con']}/{n}.")


if __name__ == "__main__":
    main()
