"""Prior de contexto: bigramas de glosas (Kneser-Ney interpolado) para reordenar las candidatas del clasificador.

El clasificador ve cada seña aislada; aquí se usa la glosa anterior para preferir, entre sus candidatas más
probables, la que tiene sentido en una conversación (tras HOLA: YO, COMO, AMIGO… y no BOMBEROS).

- `ContextModel`: modelo de bigramas entrenado con `data/corpus_glosas.txt` (una oración en glosas por línea).
- `rerank`: reordena el top-k de una seña con score = log p_clf + λ·log p_ctx(g | glosa previa), con límites.
- `viterbi`: mejor secuencia de glosas sobre las candidatas de cada posición (respaldo sin LLM al formar oración).

NINGUNA (la clase "no es seña" de classifier_v2) no es una palabra: queda fuera del vocabulario del prior y nunca
compite en el reordenamiento. Una palabra deletreada cuenta como <NOMBRE>.
"""
from __future__ import annotations

import logging
import math
import os
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Sequence

from lsm.windows import NONE_GLOSS

START, END, NAME = "<s>", "</s>", "<NOMBRE>"
CORPUS_PATH = Path(__file__).parent / "data" / "corpus_glosas.txt"
DEFAULT_WEIGHT = 0.5
MAX_WEIGHT = 3.0
MIN_P = 0.05  # el contexto nunca elige una candidata con menos probabilidad del clasificador…
LOCK_P = 0.7  # …ni cambia un top-1 con al menos esta
DISCOUNT = 0.75
P_FLOOR = 1e-9

log = logging.getLogger(__name__)

Cands = Sequence[Sequence]  # [(glosa, p_clf), …]


def read_corpus(path: str | Path = CORPUS_PATH) -> list[list[str]]:
    """Oraciones del corpus (listas de glosas). Ignora líneas vacías y comentarios (#)."""
    out = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line.split())
    return out


class ContextModel:
    """Bigramas con Kneser-Ney interpolado. La continuación se suaviza con +1 sobre el vocabulario, así que una
    glosa que el corpus no vio (o una glosa previa desconocida) tiene probabilidad baja pero nunca cero."""

    def __init__(self, sentences: Iterable[Sequence[str]], vocab: Iterable[str] = (), discount: float = DISCOUNT):
        self.d = discount
        self.big: dict[str, Counter] = defaultdict(Counter)
        for s in sentences:
            toks = [START, *s, END]
            for v, w in zip(toks, toks[1:]):
                self.big[v][w] += 1
        self.count = {v: sum(c.values()) for v, c in self.big.items()}
        self.follow = {v: len(c) for v, c in self.big.items()}  # N1+(v•)
        self.cont: Counter = Counter()  # N1+(•w)
        for c in self.big.values():
            for w in c:
                self.cont[w] += 1
        self.types = sum(self.follow.values())  # N1+(••)
        words = set(vocab) | {w for c in self.big.values() for w in c}
        words.discard(START)
        words.discard(NONE_GLOSS)  # NINGUNA no es una glosa de conversación
        self.vocab = frozenset(words)
        self.V = max(1, len(self.vocab))

    def p_cont(self, w: str) -> float:
        return (self.cont[w] + 1) / (self.types + self.V)

    def prob(self, w: str, prev: str | None) -> float:
        """p(w | prev). prev=None equivale al inicio de oración."""
        prev = START if prev is None else prev
        c = self.count.get(prev, 0)
        if not c:
            return self.p_cont(w)
        cw = self.big[prev][w]
        return max(cw - self.d, 0) / c + self.d * self.follow[prev] / c * self.p_cont(w)

    def logp(self, w: str, prev: str | None) -> float:
        return math.log(max(self.prob(w, prev), P_FLOOR))


@lru_cache(maxsize=4)
def _load(path: str, vocab: frozenset) -> ContextModel:
    return ContextModel(read_corpus(path), vocab)


def load_default(vocab: Iterable[str] = (), path: str | Path = CORPUS_PATH) -> ContextModel | None:
    """Modelo del corpus del repositorio (en caché), o None si el corpus no se puede leer."""
    try:
        return _load(str(path), frozenset(vocab))
    except OSError as e:
        log.warning("sin prior de contexto: no pude leer %s (%s)", path, e)
        return None


def context_weight(env: dict | None = None) -> float:
    """λ del prior desde LSM_CONTEXT_WEIGHT (por defecto 0.5; 0 lo desactiva; acotado a 0–3)."""
    raw = (os.environ if env is None else env).get("LSM_CONTEXT_WEIGHT", "").strip()
    if not raw:
        return DEFAULT_WEIGHT
    try:
        w = float(raw)
    except ValueError:
        log.warning("LSM_CONTEXT_WEIGHT inválido (%r); uso %.1f", raw, DEFAULT_WEIGHT)
        return DEFAULT_WEIGHT
    if not math.isfinite(w):
        return DEFAULT_WEIGHT
    return min(MAX_WEIGHT, max(0.0, w))


def token(gloss: str, spelled: bool = False) -> str:
    """Token del modelo para una glosa: una palabra deletreada cuenta como <NOMBRE>."""
    return NAME if spelled else gloss


def _lp(p: float) -> float:
    return math.log(max(float(p), P_FLOOR))


def _bonus(g: str, favored: frozenset | set, boost: float) -> float:
    """log(boost) si la glosa es del tema elegido (ver lsm.topics); 0 si no."""
    return math.log(boost) if g in favored else 0.0


def rerank(cands: Cands, prev: str | None, model: ContextModel | None, weight: float,
           favored: frozenset | set = frozenset(), boost: float = 1.0) -> tuple[list, bool]:
    """Reordena las candidatas [(glosa, p_clf)…] (ordenadas por p) con el contexto `prev` y el tema:
    score = log p_clf + λ·log p_ctx(g | prev) + log(boost)·[g del tema].

    Solo compiten el top-1 y las candidatas con p ≥ MIN_P; un top-1 con p ≥ LOCK_P no se cambia y NINGUNA nunca
    compite. Las demás quedan al final en su orden. Las probabilidades no se modifican. Devuelve (lista, ¿cambió
    el top-1?)."""
    cands = [(g, p) for g, p in cands]
    use_ctx = model is not None and weight > 0
    use_topic = bool(favored) and boost > 1.0
    if not cands or not (use_ctx or use_topic) or cands[0][1] >= LOCK_P or cands[0][0] == NONE_GLOSS:
        return cands, False
    ok = [(i == 0 or c[1] >= MIN_P) and c[0] != NONE_GLOSS for i, c in enumerate(cands)]
    eligible = [c for c, e in zip(cands, ok) if e]
    rest = [c for c, e in zip(cands, ok) if not e]
    score = {g: _lp(p) + (weight * model.logp(g, prev) if use_ctx else 0.0) + _bonus(g, favored, boost)
             for g, p in eligible}
    eligible.sort(key=lambda c: -score[c[0]])  # estable: ante empate queda el orden del clasificador
    out = eligible + rest
    return out, out[0][0] != cands[0][0]


def viterbi(positions: Sequence[Cands], model: ContextModel | None, weight: float,
            spelled: Iterable[int] = (), favored: frozenset | set = frozenset(), boost: float = 1.0) -> list[str]:
    """Mejor secuencia (una glosa por posición) maximizando Σ log p_clf + λ·log p_ctx(g_i | g_{i-1}) (+ log(boost)
    para las glosas del tema), de <s> a </s>. `spelled`: índices de posiciones deletreadas (token <NOMBRE>).
    Posición vacía → ""."""
    spelled = set(spelled)
    boost = boost if boost > 1.0 else 1.0
    use_ctx = model is not None and weight > 0
    # cada estado: (score, camino de glosas, token previo)
    beams: list[tuple[float, list[str], str]] = [(0.0, [], START)]
    for i, cands in enumerate(positions):
        cands = [(g, p) for g, p in cands] or [("", 1.0)]
        nxt = []
        for g, p in cands:
            tok = token(g, i in spelled)
            best = None
            for sc, path, prev in beams:
                s = sc + _lp(p) + (weight * model.logp(tok, prev) if use_ctx else 0.0) + _bonus(g, favored, boost)
                if best is None or s > best[0]:
                    best = (s, path + [g], tok)
            nxt.append(best)
        beams = nxt
    if use_ctx:
        beams = [(sc + weight * model.logp(END, prev), path, prev) for sc, path, prev in beams]
    return max(beams, key=lambda b: b[0])[1]  # max devuelve el primero ante empate: el orden de entrada
