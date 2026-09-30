"""Orquesta una conexión: cuadros → segmentos → evaluación/traducción. Sin red: probable en aislamiento."""
from __future__ import annotations

import logging
import math
import os
import warnings
from collections import deque

import numpy as np

from lsm.context import LOCK_P, MIN_P, START, ContextModel, rerank, token
from lsm.context import context_weight as env_context_weight
from lsm.evaluator.feedback import messages
from lsm.evaluator.scoring import evaluate, finger_status
from lsm.features import finger_flexion
from lsm.glove.calibration import Calibrator
from lsm.glove.protocol import GloveReading, parse_line
from lsm.live import LiveNormalizer, frame_to_raw
from lsm.normalize import NormSequence
from lsm.segmenter import BASE_FPS, SegEvent, Segmenter, scale_frames, trim_descent
from lsm.sentences import SentenceBuilder
from lsm.topics import ALL as ALL_TOPICS
from lsm.topics import NAMES as TOPIC_NAMES
from lsm.topics import topic_boost, topic_glosses
from lsm.vocab import canonical
from lsm.windows import NONE_GLOSS

LIVE_EVERY = 2
KEEP = 900
DROP = 300
CONF_MIN = 0.6
NONE_MIN = 0.5  # Traducción descarta un segmento solo si NINGUNA es top-1 con al menos esta probabilidad
TOP_K = 5  # candidatas que se piden al clasificador; el contexto solo reordena dentro de ellas
NO_HAND_WARN = 60  # cuadros a 30 fps (2 s); se escala con la tasa real
GLOVE_STALE = 10  # cuadros sin una lectura nueva (seq distinto) → el guante cuenta como ausente
SIDE_OF_SLOT = ("R", "L")
SUMMARY_FRAMES = 150  # un resumen de diagnóstico cada ~5 s (cuadros a 30 fps)
PAUSING_EVERY = 15  # aviso "pausing" cada ~0.5 s (cuadros a 30 fps)

log = logging.getLogger("lsm.session")


FPS_MIN, FPS_MAX = 5.0, 60.0
FPS_WINDOW = 30  # dt promediados
MAX_GAP_MS = 1000.0  # un hueco mayor (pestaña oculta, pausa) no cuenta para la tasa


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class FrameRate:
    """FPS estimados con la media móvil de los dt entre marcas de tiempo `t` (ms) de los cuadros.
    Sin marcas de tiempo se asume BASE_FPS (30): todo se comporta como antes."""

    def __init__(self):
        self.last: float | None = None
        self.dts: deque[float] = deque(maxlen=FPS_WINDOW)

    def push(self, t) -> None:
        if not _is_num(t):
            return
        t = float(t)
        if self.last is not None:
            dt = t - self.last
            if dt == 0:
                return  # cuadro repetido
            if 0 < dt <= MAX_GAP_MS:
                self.dts.append(dt)
        self.last = t

    @property
    def fps(self) -> float:
        if not self.dts:
            return BASE_FPS
        return min(FPS_MAX, max(FPS_MIN, 1000.0 * len(self.dts) / sum(self.dts)))


def _nanmedian(a: np.ndarray) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(a, axis=0)


def valid_dim(v) -> bool:
    """Ancho/alto de cuadro válido: número finito > 0 (no bool)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0


def _parse_frame(msg: dict):
    """RawSequence de un cuadro, o None si algún campo tiene tipo o forma inválidos."""
    if not (valid_dim(msg.get("w")) and valid_dim(msg.get("h"))):
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
    def __init__(self, classifier=None, references: dict | None = None, sentences: SentenceBuilder | None = None,
                 context: ContextModel | None = None, context_weight: float | None = None):
        self.classifier = classifier
        # Prior de contexto (bigramas de glosas). λ de LSM_CONTEXT_WEIGHT (0.5; 0 = sin reordenar ni Viterbi).
        self.context = context
        self.ctx_weight = env_context_weight() if context_weight is None else max(0.0, float(context_weight))
        # LSM_CONTEXT_LLM=0: al formar la oración el LLM solo recibe la glosa mostrada (sin candidatas)
        self.llm_choose = os.environ.get("LSM_CONTEXT_LLM", "1").strip() != "0"
        # Tema de conversación (mensaje "topic"): sus glosas reciben log(boost) en el reordenamiento.
        # Es una preferencia de la conexión: sobrevive a hello y reset.
        self.topic = ALL_TOPICS
        self.topic_boost = topic_boost()
        self.references = references or {}
        self.sentences = sentences or SentenceBuilder()
        self.mode, self.target = "translate", None
        self.paragraph: list[str] = []
        self.rate = FrameRate()  # la tasa de la cámara no cambia con el modo: sobrevive a hello/reset
        self._reset_stream()

    def _reset_stream(self, keep_calib: bool = False) -> None:
        calib = self.calib if keep_calib else {"L": None, "R": None}
        self.normalizer = LiveNormalizer()
        # Práctica: solo cierra al volver al reposo (una seña por intento); Traducción: también por quietud
        rate = self.rate.fps / BASE_FPS
        self.segmenter = (Segmenter(still_frames=10**6, max_len=150, rate=rate) if self.mode == "practice"
                          else Segmenter(max_len=120, rate=rate))
        self.hands, self.present, self.gflex, self.gcont = [], [], [], []
        self.base, self.idx = 0, -1
        self.gloves: dict[str, GloveReading | None] = {"L": None, "R": None}
        self.glove_seq: dict[str, int | None] = {"L": None, "R": None}
        self.glove_seen = {"L": -1, "R": -1}  # idx del último cuadro con lectura nueva
        self.calib: dict = calib
        self.calibrator: Calibrator | None = None
        self.pending: list[dict] = []
        self.pausing_at: int | None = None  # idx del último aviso "pausing"; None = sin cuenta regresiva
        self.no_hand = 0
        self.warned = False
        self._new_window()

    def _new_window(self) -> None:
        self.win_n = self.win_hands = self.win_active = 0
        self.win_ys: list[float] = []

    def _observe(self, hands: np.ndarray, present: np.ndarray) -> None:
        """Acumula estadísticas del cuadro y cada ~5 s registra un resumen (sin datos sensibles)."""
        self.win_n += 1
        if present.any():
            self.win_hands += 1
            y = float(hands[:, 0, 1][present].min())
            self.win_ys.append(y)
            self.win_active += y < self.segmenter.rest_y
        if self.win_n < scale_frames(SUMMARY_FRAMES, self.segmenter.rate, 2):
            return
        if log.isEnabledFor(logging.INFO):
            ys = np.array(self.win_ys) if self.win_ys else np.array([np.nan])
            log.info("resumen modo=%s fps=%.1f cuadros=%d manos=%.0f%% activos=%.0f%% top_y_med=%.2f "
                     "top_y_p90=%.2f rest_y=%.2f estado=%s", self.mode, self.rate.fps, self.win_n,
                     100 * self.win_hands / self.win_n, 100 * self.win_active / self.win_n,
                     float(np.median(ys)), float(np.percentile(ys, 90)), self.segmenter.rest_y,
                     self.segmenter.state)
        self._new_window()

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
        if t == "topic":
            topic = msg.get("topic")
            if not isinstance(topic, str) or topic not in TOPIC_NAMES:
                return [{"type": "error", "message": "topic inválido: " + "|".join(TOPIC_NAMES)}]
            self.topic = topic
            return [{"type": "topic", "topic": topic}]
        if t == "calibrate":
            return self._calibrate(msg.get("step"))
        if t in ("confirm_gloss", "remove_gloss"):
            try:
                if t == "confirm_gloss":
                    i = int(msg["index"])
                    if 0 <= i < len(self.pending):
                        # confirmed: la persona la eligió; ni el contexto ni el LLM la cambian
                        self.pending[i].update(gloss=canonical(str(msg["gloss"])), confident=True, confirmed=True)
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
        self.rate.push(msg.get("t"))  # opcional: marca de tiempo en ms; sin ella, 30 fps
        self.segmenter.set_rate(self.rate.fps / BASE_FPS)
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
        if not self.no_hand:
            self.warned = False
        elif (not self.warned and self.no_hand >= scale_frames(NO_HAND_WARN, self.segmenter.rate, 2)
              and self.mode == "practice"):
            self.warned = True
            out.append({"type": "warning", "code": "no_hand",
                        "message": "No veo tus manos: acércate a la cámara o mejora la luz"})
        self._observe(hands, present)
        for ev in self.segmenter.update(self.idx, hands, present):
            if ev.kind == "end":
                out += self._segment(ev)
            elif ev.kind == "pause" and self.mode == "translate":
                out += await self._sentence()
        return out + self._pausing()

    def _pause_left(self) -> float | None:
        """Segundos que faltan para formar la oración por pausa, o None si no hay cuenta regresiva (sin glosas
        pendientes, manos arriba o en otro modo)."""
        seg = self.segmenter
        if self.mode != "translate" or not self.pending or not seg.pending or seg.state != "idle" or seg.idle_count <= 0:
            return None
        return max(0.0, (seg.frames("pause") - seg.idle_count) / self.rate.fps)

    def _pausing(self) -> list[dict]:
        """Aviso de la cuenta regresiva cada ~0.5 s; `remaining: null` si se cancela (la persona subió las manos)."""
        left = self._pause_left()
        if left is None:
            if self.pausing_at is None:
                return []
            self.pausing_at = None
            return [{"type": "pausing", "remaining": None}]
        if self.pausing_at is not None and self.idx - self.pausing_at < scale_frames(PAUSING_EVERY, self.segmenter.rate):
            return []
        self.pausing_at = self.idx
        return [{"type": "pausing", "remaining": round(left, 1), "total": round(self.segmenter.pause_s, 1)}]

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

    def _segment(self, ev: SegEvent) -> list[dict]:
        a, b = max(ev.start - self.base, 0), ev.end - self.base
        if b < a:
            return []
        out = self._evaluate_segment(a, b)
        if log.isEnabledFor(logging.INFO):
            ys = np.array([self._top_y(i) for i in range(a, b + 1)])
            ev_out = next((m for m in out if m["type"] == "evaluation"), None)
            fps = self.rate.fps
            log.info("segmento modo=%s objetivo=%s cuadros=%d seg=%.2f motivo=%s fps=%.1f top3=%s total=%s "
                     "top_y_min=%.2f top_y_fin=%.2f rest_y=%.2f", self.mode, self.target, b - a + 1,
                     (b - a + 1) / fps, ev.reason, fps,
                     ",".join(f"{g}:{p:.2f}" for g, p in self._last_top[:3]) or "-",
                     f"{ev_out['total']:.2f}" if ev_out else "-",
                     float(np.nanmin(ys)) if np.isfinite(ys).any() else float("nan"), float(ys[-1]),
                     self.segmenter.rest_y)
        return out

    def _evaluate_segment(self, a: int, b: int) -> list[dict]:
        self._last_top: list = []
        b = self._trim_descent(a, b)
        seq = NormSequence(np.stack(self.hands[a:b + 1]), np.stack(self.present[a:b + 1]))
        # k=5: NINGUNA nunca se muestra como alternativa; quitándola quedan ≥4 para el contexto
        top = [[g, round(float(p), 3)] for g, p in self.classifier.predict(seq, k=TOP_K)] if self.classifier else []
        self._last_top = top  # para el registro (incluye NINGUNA si salió)
        none_top1 = bool(top) and top[0][0] == NONE_GLOSS
        cands = [t for t in top if t[0] != NONE_GLOSS]
        top3 = cands[:3]
        if self.mode == "practice":
            recognized = [] if none_top1 else top3  # NINGUNA arriba = "no se reconoció ninguna seña"
            ref = self.references.get(self.target)
            if ref is None:
                return [{"type": "evaluation", "target": self.target, "recognized": recognized, "scores": {},
                         "total": 0.0, "tips": ["No hay referencia para esta seña"], "fingers": [],
                         "evaluable": False}]
            q = (b - a) // 4
            gflex = _nanmedian(np.stack(self.gflex[a + q:b - q + 1]))
            gcont = _nanmedian(np.stack(self.gcont[a + q:b - q + 1]))
            ev = evaluate(ref, seq, gflex, gcont)
            return [{"type": "evaluation", "target": self.target, "recognized": recognized, "scores": ev.scores,
                     "total": ev.total, "tips": messages(ev, ref),
                     "fingers": finger_status(ref, ev.finger_flex).tolist(),
                     # False si una mano que la seña requiere no se vio (el puntaje no es comparable)
                     "evaluable": not any(i.param == "mano" for i in ev.issues)}]
        if not top3 or (none_top1 and top[0][1] >= NONE_MIN):
            return []  # NINGUNA segura (movimiento que no es seña): se descarta en silencio
        prev = self._ctx_prev()
        ranked, changed = rerank(cands, prev, self.context, self.ctx_weight, favored=topic_glosses(self.topic),
                                 boost=self.topic_boost)
        top3 = [[g, p] for g, p in ranked[:3]]
        item = {"gloss": top3[0][0], "top3": top3, "confident": top3[0][1] >= CONF_MIN}
        if changed:
            item["reranked"] = True
            log.info("contexto top1 %s->%s previa=%s p=%.2f->%.2f lambda=%.2f tema=%s", cands[0][0], top3[0][0], prev,
                     cands[0][1], top3[0][1], self.ctx_weight, self.topic)
        self.pending.append(item)
        return [{"type": "sign", "index": len(self.pending) - 1, **item}]

    def _top_y(self, i: int) -> float:
        ys = self.hands[i][:, 0, 1][self.present[i]]
        return float(ys.min()) if ys.size else float("nan")

    def _trim_descent(self, a: int, b: int) -> int:
        """Quita del final los cuadros en que la mano solo baja al reposo (≤40 % del segmento)."""
        return a + trim_descent([self._top_y(i) for i in range(a, b + 1)], self.segmenter.rate)

    def _ctx_prev(self) -> str:
        """Glosa previa para el contexto: la última pendiente (deletreada = <NOMBRE>) o <s> al empezar oración.
        Así el contexto se reinicia solo al formar la oración o con reset (ambos vacían `pending`)."""
        if not self.pending:
            return START
        last = self.pending[-1]
        return token(last["gloss"], bool(last.get("spelled")))

    def _position(self, item: dict) -> dict:
        """Candidatas de una seña pendiente para formar la oración. La mostrada va primero; las alternativas
        solo si p ≥ MIN_P. Sin alternativas: deletreadas, confirmadas por la persona, top-1 con p ≥ LOCK_P y
        todas si LSM_CONTEXT_LLM=0 y hay LLM."""
        g = item["gloss"]
        if item.get("spelled"):
            return {"candidates": [(g, 1.0)], "spelled": True}
        top = [(str(a), float(q)) for a, q in item.get("top3") or []]
        p = dict(top).get(g)
        if item.get("confirmed") or p is None:
            return {"candidates": [(g, 1.0)], "spelled": False}
        if p >= LOCK_P or (not self.llm_choose and self.sentences.llm is not None):
            return {"candidates": [(g, p)], "spelled": False}
        return {"candidates": [(g, p)] + [(a, q) for a, q in top if a != g and q >= MIN_P], "spelled": False}

    async def _sentence(self) -> list[dict]:
        if not self.pending:
            return []
        shown = [p["gloss"] for p in self.pending]
        positions = [self._position(p) for p in self.pending]
        glosses, text, source = await self.sentences.choose(
            positions, self.paragraph[-3:], prior=self.context, weight=self.ctx_weight,
            topic=None if self.topic == ALL_TOPICS else self.topic, favored=topic_glosses(self.topic),
            boost=self.topic_boost)
        corrected = [i for i, (a, b) in enumerate(zip(shown, glosses)) if a != b]
        if corrected:  # una deletreada nunca cambia: no se registra ningún nombre
            log.info("oración corregida por contexto fuente=%s cambios=%s", source,
                     ",".join(f"{i}:{shown[i]}->{glosses[i]}" for i in corrected))
        self.paragraph.append(text)
        self.pending = []
        self.pausing_at = None  # la oración reemplaza al aviso: no hace falta cancelarlo
        return [{"type": "sentence", "glosses": glosses, "text": text,
                 "paragraph": " ".join(self.paragraph), "source": source, "corrected": corrected}]

    def _calibrate(self, step: str | None) -> list[dict]:
        if step in ("open", "fist"):
            # "open" es siempre el primer paso: empieza de cero (p. ej. tras Cancelar a media calibración).
            if step == "open" or self.calibrator is None:
                self.calibrator = Calibrator()
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
