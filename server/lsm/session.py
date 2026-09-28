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
from lsm.vocab import canonical

LIVE_EVERY = 2
KEEP = 900
DROP = 300
CONF_MIN = 0.6
NO_HAND_WARN = 60
GLOVE_STALE = 10  # cuadros sin una lectura nueva (seq distinto) → el guante cuenta como ausente
DESCENT_DY = 0.05  # anchos de cabeza por cuadro: la muñeca sigue bajando hacia el reposo
DESCENT_MAX_TRIM = 0.4
SIDE_OF_SLOT = ("R", "L")


def _nanmedian(a: np.ndarray) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(a, axis=0)


def _parse_frame(msg: dict):
    """RawSequence de un cuadro, o None si algún campo tiene tipo o forma inválidos."""
    def num(v) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0

    if not (num(msg.get("w")) and num(msg.get("h"))):
        return None
    for key in ("hands", "pose", "face"):
        if not isinstance(msg.get(key), (list, type(None))):
            return None
    if not isinstance(msg.get("gloves"), (dict, type(None))):
        return None
    try:
        return frame_to_raw(msg)
    except (KeyError, ValueError, TypeError):
        return None


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
        self.normalizer = LiveNormalizer()
        # Práctica: solo cierra al volver al reposo (una seña por intento); Traducción: también por quietud
        self.segmenter = (Segmenter(still_frames=10**6, max_len=150) if self.mode == "practice"
                          else Segmenter(max_len=120))
        self.hands, self.present, self.gflex, self.gcont = [], [], [], []
        self.base, self.idx = 0, -1
        self.gloves: dict[str, GloveReading | None] = {"L": None, "R": None}
        self.glove_seq: dict[str, int | None] = {"L": None, "R": None}
        self.glove_seen = {"L": -1, "R": -1}  # idx del último cuadro con lectura nueva
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
            mode, target = msg.get("mode", "translate"), msg.get("target")
            if mode not in ("practice", "translate") or not isinstance(target, (str, type(None))):
                return [{"type": "error", "message": "hello inválido: mode debe ser practice|translate y target str o null"}]
            self.mode, self.target = mode, target
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
                        self.pending[i].update(gloss=canonical(str(msg["gloss"])), confident=True)
                else:
                    i = int(msg["index"])
                    if 0 <= i < len(self.pending):
                        self.pending.pop(i)
            except (KeyError, ValueError, TypeError):
                return [{"type": "error", "message": f"mensaje inválido: {t}"}]
            return [{"type": "pending", "glosses": [p["gloss"] for p in self.pending]}]
        if t == "build_sentence":
            return await self._sentence() if self.pending else [{"type": "pending", "glosses": []}]
        if t == "reset":
            self.paragraph = []
            self._reset_stream(keep_calib=True)
            return [self._ready()]
        return [{"type": "error", "message": f"tipo de mensaje desconocido: {t}"}]

    async def _frame(self, msg: dict) -> list[dict]:
        raw = _parse_frame(msg)  # valida todo antes de tocar el estado
        if raw is None:
            return [{"type": "error", "message": "cuadro inválido"}]
        hands, present = self.normalizer.push(raw)
        self.idx += 1
        fresh = self._update_gloves(msg.get("gloves") or {})
        gf, gc = np.full((2, 5), np.nan, np.float32), np.full((2, 4), np.nan, np.float32)
        cam = np.full((2, 5), np.nan, np.float32)
        for s, side in enumerate(SIDE_OF_SLOT):
            if present[s]:
                cam[s] = finger_flexion(hands[s])
            r, cal = self.gloves[side], self.calib.get(side)
            if r is not None and cal is not None:
                gf[s], gc[s] = cal.flexion(r), cal.contacts(r)
            if self.calibrator is not None and r is not None and fresh[side]:
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

    def _update_gloves(self, lines: dict) -> dict[str, bool]:
        """Guarda la última lectura por lado; devuelve qué lados trajeron una lectura nueva (seq distinto).
        null/ausente, o ninguna lectura nueva en más de GLOVE_STALE cuadros → guante ausente."""
        fresh = {"L": False, "R": False}
        for side in ("L", "R"):
            line = lines.get(side)
            r = parse_line(line) if isinstance(line, str) else None
            if line is None:
                self.gloves[side] = None
            elif isinstance(r, GloveReading) and r.side == side and r.seq != self.glove_seq[side]:
                self.gloves[side], self.glove_seq[side], self.glove_seen[side] = r, r.seq, self.idx
                fresh[side] = True
            if self.gloves[side] is not None and self.idx - self.glove_seen[side] > GLOVE_STALE:
                self.gloves[side] = None
        return fresh

    def _segment(self, start: int, end: int) -> list[dict]:
        a, b = max(start - self.base, 0), end - self.base
        if b < a:
            return []
        b = self._trim_descent(a, b)
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

    def _top_y(self, i: int) -> float:
        ys = self.hands[i][:, 0, 1][self.present[i]]
        return float(ys.min()) if ys.size else float("nan")

    def _trim_descent(self, a: int, b: int) -> int:
        """Quita del final los cuadros en que la mano solo baja al reposo (≤40 % del segmento)."""
        lo = b - int(DESCENT_MAX_TRIM * (b - a + 1))
        while b > max(a, lo) and self._top_y(b) - self._top_y(b - 1) > DESCENT_DY:
            b -= 1
        return b

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
