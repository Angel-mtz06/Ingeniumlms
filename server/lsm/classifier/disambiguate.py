"""Desempate conservador de HOLA/NO con las referencias del modelo activo."""
from __future__ import annotations

import numpy as np

from lsm.evaluator.references import GlossRef, sample_stats
from lsm.normalize import NormSequence


def distinguish_hola_no(top: list, seq: NormSequence, references: dict[str, GlossRef]) -> list:
    # Solo disputas entre estas dos candidatas. No inventar una alternativa ausente
    # ni cambiar una predicción firme a partir de una sola medida geométrica.
    pair = {"HOLA", "NO"}
    candidates = {g: p for g, p in top if g in pair}
    signs = [g for g, _ in top if g != "NINGUNA"]
    if (len(candidates) != 2 or not signs or signs[0] not in pair
            or not pair <= references.keys()
            or abs(candidates["HOLA"] - candidates["NO"]) > .2):
        return top
    stats = sample_stats(seq)
    errors = {}
    for gloss in pair:
        ref = references[gloss]
        slot = ref.dom
        if stats["present_frac"][slot] < .75:
            return top
        # Índice a meñique: la flexión distingue las configuraciones de estas
        # referencias; la posición de la mano o el objetivo elegido no decide.
        actual = stats["flex"][slot, 1:]
        expected = ref.flex_mean[slot, 1:]
        spread = np.maximum(ref.flex_std[slot, 1:], 12.)
        z = np.abs(actual - expected) / spread
        if not np.isfinite(z).all():
            return top
        errors[gloss] = float(np.mean(z))
    winner = min(errors, key=errors.get)
    loser = next(g for g in pair if g != winner)
    if errors[winner] > 2. or errors[loser] - errors[winner] < 1. or candidates[winner] >= candidates[loser]:
        return top
    # Conservar la confianza total y su incertidumbre: el desempate no convierte
    # una salida débil del modelo en una seña segura.
    return sorted([[g, candidates[loser] if g == winner else candidates[winner] if g == loser else p]
                   for g, p in top], key=lambda item: -item[1])
