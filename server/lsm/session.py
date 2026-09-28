"""Orquesta una conexión: cuadros → segmentos → evaluación/traducción. Sin red: probable en aislamiento."""
from __future__ import annotations

import warnings

import numpy as np

from lsm.evaluator.feedback import messages
from lsm.evaluator.scoring import evaluate, finger_status
from lsm.features import finger_flexion
from lsm.glove.calibration import Calibrator
from lsm.glove.protocol import GloveReading, parse_line
from lsm.live import LiveNormalizer, frame_to_raw
from lsm.normalize import NormSequence
from lsm.segmenter import Segmenter
from lsm.sentences import SentenceBuilder

LIVE_EVERY = 2
KEEP = 900
DROP = 300
CONF_MIN = 0.6
NO_HAND_WARN = 60
SIDE_OF_SLOT = ("R", "L")


def _nanmedian(a: np.ndarray) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(a, axis=0)


class Session:
    def __init__(self, classifier=None, references: dict | None = None, sentences: SentenceBuilder | None = None):
        self.classifier = classifier
        self.references = references or {}
        self.sentences = sentences or SentenceBuilder()
        self.mode, self.target = "translate", None
        self.paragraph: list[str] = []
        self._reset_stream()

    def _reset_stream(self, keep_calib: bool = False) -> None:
        calib = self.calib if keep_calib else {"L": None, "R": None}
        self.normalizer, self.segmenter = LiveNormalizer(), Segmenter()
        self.hands, self.present, self.gflex, self.gcont = [], [], [], []
        self.base, self.idx = 0, -1
        self.gloves: dict[str, GloveReading | None] = {"L": None, "R": None}
        self.calib: dict = calib
        self.calibrator: Calibrator | None = None
        self.pending: list[dict] = []
        self.no_hand = 0

    def _ready(self) -> dict:
        return {"type": "ready", "mode": self.mode, "target": self.target,
                "has_reference": self.target in self.references}

    async def handle(self, msg: dict) -> list[dict]:
        t = msg.get("type")
        if t == "hello":
            self.mode, self.target = msg.get("mode", "translate"), msg.get("target")
            self._reset_stream(keep_calib=True)  # la calibración sobrevive al cambio de modo
            return [self._ready()]
        if t == "frame":
            return await self._frame(msg)
        if t == "calibrate":
            return self._calibrate(msg.get("step"))
        if t in ("confirm_gloss", "remove_gloss"):
            try:
                if t == "confirm_gloss":
                    i = int(msg["index"])
                    if 0 <= i < len(self.pending):
                        self.pending[i].update(gloss=msg["gloss"], confident=True)
                else:
                    i = int(msg["index"])
                    if 0 <= i < len(self.pending):
                        self.pending.pop(i)
            except (KeyError, ValueError, TypeError):
                return [{"type": "error", "message": f"mensaje inválido: {t}"}]
            return [{"type": "pending", "glosses": [p["gloss"] for p in self.pending]}]
        if t == "build_sentence":
            return await self._sentence()
        if t == "reset":
            self.paragraph = []
            self._reset_stream(keep_calib=True)
            return [self._ready()]
        return [{"type": "error", "message": f"tipo de mensaje desconocido: {t}"}]

    async def _frame(self, msg: dict) -> list[dict]:
        hands, present = self.normalizer.push(frame_to_raw(msg))
        self.idx += 1
        for side, line in (msg.get("gloves") or {}).items():
            r = parse_line(line) if isinstance(line, str) else None
            if isinstance(r, GloveReading) and side in self.gloves:
                self.gloves[side] = r
        gf, gc = np.full((2, 5), np.nan, np.float32), np.full((2, 4), np.nan, np.float32)
        cam = np.full((2, 5), np.nan, np.float32)
        for s, side in enumerate(SIDE_OF_SLOT):
            if present[s]:
                cam[s] = finger_flexion(hands[s])
            r, cal = self.gloves[side], self.calib.get(side)
            if r is not None and cal is not None:
                gf[s], gc[s] = cal.flexion(r), cal.contacts(r)
            if self.calibrator is not None and r is not None:
                self.calibrator.add(side, r, cam[s] if present[s] else None)
        self.hands.append(hands)
        self.present.append(present)
        self.gflex.append(gf)
        self.gcont.append(gc)
        if len(self.hands) > KEEP:
            del self.hands[:DROP], self.present[:DROP], self.gflex[:DROP], self.gcont[:DROP]
            self.base += DROP
        out: list[dict] = []
        ref = self.references.get(self.target) if self.mode == "practice" else None
        if ref is not None and self.idx % LIVE_EVERY == 0:
            flex = np.where(np.isnan(gf), cam, gf)
            out.append({"type": "live", "fingers": finger_status(ref, flex).tolist(),
                        "hands": present.tolist(), "segment": self.segmenter.state})
        self.no_hand = 0 if present.any() else self.no_hand + 1
        if self.no_hand == NO_HAND_WARN and self.mode == "practice":
            out.append({"type": "warning", "code": "no_hand",
                        "message": "No veo tus manos: acércate a la cámara o mejora la luz"})
        for ev in self.segmenter.update(self.idx, hands, present):
            if ev.kind == "end":
                out += self._segment(ev.start, ev.end)
            elif ev.kind == "pause" and self.mode == "translate":
                out += await self._sentence()
        return out

    def _segment(self, start: int, end: int) -> list[dict]:
        a, b = max(start - self.base, 0), end - self.base
        if b < a:
            return []
        seq = NormSequence(np.stack(self.hands[a:b + 1]), np.stack(self.present[a:b + 1]))
        top3 = [[g, round(float(p), 3)] for g, p in self.classifier.predict(seq, k=3)] if self.classifier else []
        if self.mode == "practice":
            ref = self.references.get(self.target)
            if ref is None:
                return [{"type": "evaluation", "target": self.target, "recognized": top3, "scores": {},
                         "total": 0.0, "tips": ["No hay referencia para esta seña"], "fingers": []}]
            q = (b - a) // 4
            gflex = _nanmedian(np.stack(self.gflex[a + q:b - q + 1]))
            gcont = _nanmedian(np.stack(self.gcont[a + q:b - q + 1]))
            ev = evaluate(ref, seq, gflex, gcont)
            return [{"type": "evaluation", "target": self.target, "recognized": top3, "scores": ev.scores,
                     "total": ev.total, "tips": messages(ev, ref),
                     "fingers": finger_status(ref, ev.finger_flex).tolist()}]
        if not top3:
            return []
        item = {"gloss": top3[0][0], "top3": top3, "confident": top3[0][1] >= CONF_MIN}
        self.pending.append(item)
        return [{"type": "sign", "index": len(self.pending) - 1, **item}]

    async def _sentence(self) -> list[dict]:
        if not self.pending:
            return []
        glosses = [p["gloss"] for p in self.pending]
        text, source = await self.sentences.build(glosses, self.paragraph[-3:])
        self.paragraph.append(text)
        self.pending = []
        return [{"type": "sentence", "glosses": glosses, "text": text,
                 "paragraph": " ".join(self.paragraph), "source": source}]

    def _calibrate(self, step: str | None) -> list[dict]:
        if step in ("open", "fist"):
            self.calibrator = self.calibrator or Calibrator()
            self.calibrator.step = step
            return [{"type": "calibration", "step": step, "status": "recording"}]
        if step == "done" and self.calibrator is not None:
            res = self.calibrator.finish()
            self.calibrator = None
            for side, cal in res.items():
                if cal is not None:
                    self.calib[side] = cal
            return [{"type": "calibration", "step": "done", "sides": {s: res[s] is not None for s in ("L", "R")}}]
        return [{"type": "error", "message": f"paso de calibración inválido: {step}"}]
