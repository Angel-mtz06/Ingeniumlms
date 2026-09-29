"""Separación por persona: el modelo se mide con signantes que nunca vio.

Grabaciones propias (dataset "own"): pocas personas, así que además se separa por toma: las tomas con
número % 5 == 0 (000, 005, …) van a val para medir las glosas propias; el resto a train. La clase NINGUNA
va siempre a train (sus ventanas se solapan y solo sirve para aprender a rechazar)."""
import re

VAL_SIGNERS = {"m03", "g03"}
TEST_SIGNERS = {"m02", "g02"}
OWN_VAL_EVERY = 5
_TAKE_RE = re.compile(r"_(\d+)(?:_w\d+)?$")


def split_of(signer: str, dataset: str = "", sample_id: str = "", gloss: str = "") -> str:
    if signer in TEST_SIGNERS:
        return "test"
    if signer in VAL_SIGNERS:
        return "val"
    if dataset == "own" and gloss != "NINGUNA":
        m = _TAKE_RE.search(sample_id)
        if m and int(m.group(1)) % OWN_VAL_EVERY == 0:
            return "val"
    return "train"
