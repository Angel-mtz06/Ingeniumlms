import logging
import os
import re
from pathlib import Path

ROOT = Path(os.environ.get("LSM_ROOT", "D:/Ingenium"))
DATASETS = ROOT / "datasets"
RAW_LANDMARKS = DATASETS / "raw_landmarks"
PROCESSED = DATASETS / "processed"
MODELS = ROOT / "models"
MP_MODELS = MODELS / "mediapipe"

DEFAULT_MODEL = "classifier_v1"
MODEL_NAME_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
log = logging.getLogger(__name__)


def active_model_name() -> str:
    """Nombre del clasificador activo: $LSM_MODEL, si no models/ACTIVE_MODEL, si no classifier_v1.
    Un nombre inválido o sin su .pt cae a classifier_v1 con un aviso en el log."""
    env = os.environ.get("LSM_MODEL", "").strip()
    source = "LSM_MODEL"
    name = env
    if not name:
        f = MODELS / "ACTIVE_MODEL"
        lines = f.read_text(encoding="utf-8-sig").splitlines() if f.exists() else []
        name, source = (lines[0].strip() if lines else ""), "models/ACTIVE_MODEL"
    if not name:
        return DEFAULT_MODEL
    if not MODEL_NAME_RE.fullmatch(name):
        log.warning("%s tiene un nombre de modelo inválido (%r); uso %s", source, name, DEFAULT_MODEL)
        return DEFAULT_MODEL
    if not (MODELS / f"{name}.pt").exists():
        log.warning("%s pide %s pero no existe %s.pt; uso %s", source, name, name, DEFAULT_MODEL)
        return DEFAULT_MODEL
    return name


def active_model_path() -> Path:
    return MODELS / f"{active_model_name()}.pt"
