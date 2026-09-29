"""FastAPI: WebSocket /ws + REST. La lógica vive en Session; aquí solo hay transporte."""
from __future__ import annotations

import csv
import logging
import os
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from lsm.evaluator.references import _to_json, load_references
from lsm.live import frames_to_raw
from lsm.paths import (DATASETS, MODELS, PROCESSED, ROOT, active_model_name, active_references_path,
                       active_vocab_path)
from lsm.sentences import SentenceBuilder
from lsm.session import Session, valid_dim
from lsm.themes import theme_of
from lsm.vocab import canonical
from lsm.windows import NONE_GLOSS

VOCAB_CSV = PROCESSED / "vocab.csv"
INDEX_FIELDS = ["sample_id", "dataset", "source_label", "signer", "path", "n_frames", "hand_ratio"]
SIGNER_RE = re.compile(r"[A-Za-z0-9-]{1,32}")  # sin "_": separa persona_glosa_toma en el nombre
LABEL_RE = re.compile(r"[A-ZÑ0-9_]{1,40}")
MAX_REC_FRAMES = 1800  # 60 s a 30 fps
TAKE_RE = re.compile(r"_(\d+)\.npz")


LOG_PATH = ROOT / "logs" / "lsm.log"
LOG_MAX_BYTES = 5 * 1024 * 1024
LOG_BACKUPS = 2


def setup_logging(path: str | Path) -> RotatingFileHandler:
    """Registro de diagnóstico de `lsm.*` (segmentos cerrados y resúmenes cada ~5 s) en un archivo rotativo.
    Idempotente: si ya hay un manejador para ese archivo, lo devuelve sin duplicarlo."""
    path = Path(path)
    logger = logging.getLogger("lsm")
    for h in logger.handlers:
        if isinstance(h, RotatingFileHandler) and Path(h.baseFilename) == path.resolve():
            return h
    path.parent.mkdir(parents=True, exist_ok=True)
    h = RotatingFileHandler(path, maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUPS, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(h)
    logger.setLevel(logging.INFO)
    return h


class RecordingIn(BaseModel):
    label: str
    signer: str
    frames: list[dict]


class WebFiles(StaticFiles):
    """Archivos de la web. index.html sin caché (siempre la versión nueva); los assets con hash sí se cachean."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        return response


def create_app(classifier=None, references: dict | None = None, sentences: SentenceBuilder | None = None,
               static_dir: str | Path | None = None, own_dir: str | Path | None = None,
               model_name: str | None = None, vocab_csv: str | Path | None = None) -> FastAPI:
    references = references or {}
    sentences = sentences or SentenceBuilder()
    own = Path(own_dir) if own_dir else DATASETS / "own"
    app = FastAPI(title="LSM INGENIUM")

    @app.get("/api/health")
    def health():
        return {"ok": True, "classifier": classifier is not None, "references": len(references),
                "llm": sentences.llm is not None, "model": model_name}

    @app.get("/api/vocab")
    def vocab():
        path = Path(vocab_csv or VOCAB_CSV)  # el catálogo del modelo activo
        if path.exists():
            rows = csv.DictReader(open(path, encoding="utf-8"))
            return [{"gloss": r["gloss"], "category": theme_of(r["gloss"], r["category"]),
                     "has_reference": r["gloss"] in references}
                    for r in rows if r["gloss"] != NONE_GLOSS]  # NINGUNA no es una seña del catálogo
        return [{"gloss": g, "category": theme_of(g), "has_reference": True}
                for g in sorted(references) if g != NONE_GLOSS]

    @app.get("/api/reference/{gloss}")
    def reference(gloss: str):
        r = references.get(gloss)
        if r is None:
            raise HTTPException(404, "sin referencia")
        return {"gloss": r.gloss, "example_hands": _to_json(r.example_hands),
                "example_present": _to_json(r.example_present), "flex_mean": _to_json(r.flex_mean),
                "slots_used": _to_json(r.slots_used), "n_samples": r.n_samples}

    @app.post("/api/recordings")
    def recordings(rec: RecordingIn):
        if not rec.frames:
            raise HTTPException(400, "sin cuadros")
        if len(rec.frames) > MAX_REC_FRAMES:
            raise HTTPException(400, f"demasiados cuadros (máx. {MAX_REC_FRAMES})")
        if not all(valid_dim(f.get("w")) and valid_dim(f.get("h")) for f in rec.frames):
            raise HTTPException(400, "cuadros inválidos: w y h deben ser números finitos > 0")
        if not SIGNER_RE.fullmatch(rec.signer):
            raise HTTPException(400, "glosa o persona inválida")
        label = canonical(rec.label)
        if not LABEL_RE.fullmatch(label):
            raise HTTPException(400, "glosa o persona inválida")
        raw_dir = own / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        raw_root = raw_dir.resolve()
        takes = [int(m.group(1)) for p in raw_dir.glob(f"{rec.signer}_{label}_*.npz")
                 if (m := TAKE_RE.fullmatch(p.name[len(rec.signer) + len(label) + 1:]))]
        n = max(takes, default=-1) + 1
        for _ in range(20):  # "x": nunca sobrescribir una toma (p. ej. dos envíos simultáneos)
            sid = f"{rec.signer}_{label}_{n:03d}"
            path = raw_dir / f"{sid}.npz"
            if raw_root not in path.resolve().parents:
                raise HTTPException(400, "glosa o persona inválida")
            try:
                raw = frames_to_raw(rec.frames, sample_id=sid, dataset="own", source_label=label,
                                    signer=rec.signer)
            except (KeyError, ValueError, TypeError):
                raise HTTPException(400, "cuadros inválidos")
            try:
                with open(path, "xb") as fh:
                    raw.save(fh)
                break
            except FileExistsError:
                n += 1
        else:
            raise HTTPException(409, "no se pudo reservar un número de toma")
        present = (~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1)
        index = own / "index_own.csv"
        new = not index.exists()
        with open(index, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=INDEX_FIELDS)
            if new:
                w.writeheader()
            w.writerow({"sample_id": sid, "dataset": "own", "source_label": label, "signer": rec.signer,
                        "path": str(path), "n_frames": raw.T, "hand_ratio": round(float(present.mean()), 3)})
        return {"sample_id": sid, "frames": raw.T}

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        session = Session(classifier, references, sentences)
        while True:
            try:
                msg = await ws.receive_json()
                if not isinstance(msg, dict):
                    raise ValueError("mensaje no es un objeto JSON")
                for out in await session.handle(msg):
                    await ws.send_json(out)
            except WebSocketDisconnect:
                return
            except Exception as e:
                await ws.send_json({"type": "error", "message": f"error interno: {type(e).__name__}"})

    if static_dir and Path(static_dir).exists():
        app.mount("/", WebFiles(directory=str(static_dir), html=True), name="web")
    return app


def main() -> None:
    import torch
    import uvicorn

    from lsm.classifier.infer import Classifier
    from lsm.envfile import load_env_file

    load_env_file(ROOT / ".env")  # OPENAI_API_KEY, SENTENCES_PROVIDER…; antes de crear SentenceBuilder
    torch.set_num_threads(2)  # inferencia en CPU: deja núcleos libres para el servidor y MediaPipe
    log_path = setup_logging(LOG_PATH).baseFilename
    print(f"registro de diagnóstico: {log_path}", flush=True)

    name = active_model_name()
    clf_path = MODELS / f"{name}.pt"
    ref_path, vocab_path = active_references_path(name), active_vocab_path(name)
    classifier = Classifier.load(clf_path) if clf_path.exists() else None
    references = load_references(ref_path) if ref_path.exists() else {}
    print(f"modelo activo: {name}" + ("" if classifier else " (no encontrado)")
          + f"; referencias: {ref_path.name}; catálogo: {vocab_path.parent.name}/{vocab_path.name}", flush=True)
    app = create_app(classifier, references, SentenceBuilder(), static_dir=ROOT / "web" / "dist",
                     model_name=name if classifier else None, vocab_csv=vocab_path)
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    main()
