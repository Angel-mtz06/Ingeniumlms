import logging
import os
import re
from pathlib import Path

ROOT = Path(os.environ.get("LSM_ROOT", "D:/Ingenium"))
DATASETS = ROOT / "datasets"
RAW_LANDMARKS = DATASETS / "raw_landmarks"
# LSM_PROCESSED: tools/retrain.sh arma el dataset de un modelo candidato en datasets/processed_<modelo>
PROCESSED = Path(os.environ.get("LSM_PROCESSED") or DATASETS / "processed")
MODELS = ROOT / "models"
MP_MODELS = MODELS / "mediapipe"

DEFAULT_MODEL = "classifier_v1"
MODEL_NAME_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
log = logging.getLogger(__name__)


def _read_first_line(f: Path) -> str:
    """Primera línea de un archivo de texto corto en UTF-8 (con o sin BOM) o UTF-16 con BOM
    (PowerShell 5.1 con `>`). Lanza OSError/UnicodeError si no se puede leer."""
    data = f.read_bytes()
    text = data.decode("utf-16") if data[:2] in (b"\xff\xfe", b"\xfe\xff") else data.decode("utf-8-sig")
    lines = text.replace("\0", "").splitlines()
    return lines[0].strip() if lines else ""


def active_model_name() -> str:
    """Nombre del clasificador activo: $LSM_MODEL, si no models/ACTIVE_MODEL, si no classifier_v1.
    Un nombre inválido, ilegible o sin su .pt cae a classifier_v1 con un aviso en el log."""
    name, source = os.environ.get("LSM_MODEL", "").strip(), "LSM_MODEL"
    if not name:
        f, source = MODELS / "ACTIVE_MODEL", "models/ACTIVE_MODEL"
        if f.exists():
            try:
                name = _read_first_line(f)
            except (OSError, UnicodeError) as e:
                log.warning("no pude leer %s (%s); uso %s", source, e, DEFAULT_MODEL)
                return DEFAULT_MODEL
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


def active_references_path(model: str) -> Path:
    """Referencias de Práctica del modelo: models/references_<modelo>.json si existe; si no, references.json
    (las de classifier_v1, que tools/retrain.sh nunca reescribe)."""
    own = MODELS / f"references_{model}.json"
    return own if own.exists() else MODELS / "references.json"


def active_vocab_path(model: str) -> Path:
    """Catálogo del modelo: datasets/processed_<modelo>/vocab.csv si existe; si no, el de PROCESSED."""
    own = DATASETS / f"processed_{model}" / "vocab.csv"
    return own if own.exists() else PROCESSED / "vocab.csv"
