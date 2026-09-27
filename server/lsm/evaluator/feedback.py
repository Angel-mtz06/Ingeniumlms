"""Correcciones en español por plantilla (instantáneas, sin internet)."""
from __future__ import annotations

from lsm.evaluator.references import GlossRef
from lsm.evaluator.scoring import Evaluation, Issue

SIDE = ("derecha", "izquierda")  # slot 0 = mano derecha del signante
FINGER = ("pulgar", "índice", "medio", "anular", "meñique")


def _msg(i: Issue) -> str:
    lado = SIDE[i.slot]
    if i.param == "mano":
        return f"No veo tu mano {lado}: acércate o mejora la luz"
    if i.param == "configuracion":
        a, t = i.detail["actual"], i.detail["target"]
        verbo = "dobla más" if a < t else "estira más"
        return f"Mano {lado}: {verbo} el {FINGER[i.finger]} (tienes {a:.0f}°, debe ser ~{t:.0f}°)"
    if i.param == "contacto":
        if i.detail["expected"]:
            return f"Mano {lado}: el pulgar debe tocar el {FINGER[i.finger]}"
        return f"Mano {lado}: separa el pulgar del {FINGER[i.finger]}"
    if i.param == "ubicacion":
        dx, dy = i.detail["dx"], i.detail["dy"]
        if abs(dy) >= abs(dx):
            return f"{'Sube' if dy > 0 else 'Baja'} la mano {lado}"
        return f"Mueve la mano {lado} hacia tu {'derecha' if dx > 0 else 'izquierda'}"
    if i.param == "orientacion":
        return f"Gira la palma de la mano {lado}: revisa hacia dónde apunta"
    ratio = i.detail.get("ratio", 1.0)
    if ratio < 0.7:
        return "Haz el movimiento más amplio"
    if ratio > 1.4:
        return "Haz el movimiento más corto"
    return "Revisa la dirección del movimiento"


def messages(ev: Evaluation, ref: GlossRef, max_tips: int = 2) -> list[str]:
    out: list[str] = []
    for i in ev.issues:
        m = _msg(i)
        if m not in out:
            out.append(m)
        if len(out) == max_tips:
            break
    return out
