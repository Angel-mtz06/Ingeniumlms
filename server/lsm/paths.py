import os
from pathlib import Path

ROOT = Path(os.environ.get("LSM_ROOT", "D:/Ingenium"))
DATASETS = ROOT / "datasets"
RAW_LANDMARKS = DATASETS / "raw_landmarks"
PROCESSED = DATASETS / "processed"
MODELS = ROOT / "models"
MP_MODELS = MODELS / "mediapipe"
