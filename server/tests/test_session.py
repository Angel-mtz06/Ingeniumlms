import asyncio

import numpy as np

from lsm.evaluator.references import build_reference
from lsm.glove.simulator import simulate_line
from lsm.normalize import NormSequence
from lsm.sentences import SentenceBuilder
from lsm.session import Session
from tests.conftest import make_hand

HEAD = (320.0, 100.0)


def pose():
    p = [[0.0, 0.0, 0.0, 0.0] for _ in range(33)]
    p[0] = [HEAD[0], HEAD[1], 0.0, 0.99]
    p[7] = [HEAD[0] + 15, HEAD[1], 0.0, 0.99]
    p[8] = [HEAD[0] - 15, HEAD[1], 0.0, 0.99]
    return p


def frame(wrist_units=None, glove=None):
    hands = []
    if wrist_units is not None:
        wx, wy = HEAD[0] + 30 * wrist_units[0], HEAD[1] + 30 * wrist_units[1]
        hands = [make_hand(wrist=(wx, wy), size=30, flex=(0, 90, 90, 90, 90)).tolist()]
    return {"type": "frame", "w": 640, "h": 480, "hands": hands, "pose": pose(), "face": None,
            "gloves": {"R": glove, "L": None}}


def sign_frames():
    # 120 cuadros de reposo (4 s a 30 fps): alcanzan para la pausa de oración por defecto (3.5 s)
    return [frame((-1.0, 5.0))] * 5 + [frame((-1.0 + 0.05 * i, 1.0)) for i in range(20)] + [frame((-1.0, 5.0))] * 120


class FakeClassifier:
    def predict(self, norm, k=3):
        return [("HOLA", 0.9), ("ADIOS", 0.05), ("SI", 0.02)][:k]


def ref():
    hands = np.zeros((12, 2, 21, 3), np.float32)
    present = np.zeros((12, 2), bool)
    for t in range(12):
        hands[t, 0] = make_hand(wrist=(-1.0 + 0.1 * t, 1.0), flex=(0, 90, 90, 90, 90))
        present[t, 0] = True
    return build_reference("HOLA", [NormSequence(hands, present, f"s{i}", f"s{i}") for i in range(3)])


async def run(session, msgs):
    out = []
    for m in msgs:
        out += await session.handle(m)
    return out


def test_translate_flow_sign_then_sentence():
    async def fake_llm(system, user):
        return "Hola."

    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=fake_llm))
    out = asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}] + sign_frames()))
    kinds = [m["type"] for m in out]
    assert kinds[0] == "ready"
    sign = next(m for m in out if m["type"] == "sign")
    assert sign["gloss"] == "HOLA" and sign["confident"] and sign["index"] == 0
    sent = next(m for m in out if m["type"] == "sentence")
    assert sent["text"] == "Hola." and sent["glosses"] == ["HOLA"] and sent["paragraph"] == "Hola."


def test_practice_flow_live_and_evaluation():
    s = Session(FakeClassifier(), {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"))
    out = asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}] + sign_frames()))
    assert out[0]["has_reference"] is True
    live = [m for m in out if m["type"] == "live"]
    assert live and len(live[0]["fingers"]) == 2
    ev = next(m for m in out if m["type"] == "evaluation")
    assert ev["target"] == "HOLA" and ev["recognized"][0][0] == "HOLA"
    assert set(ev["scores"]) == {"configuracion", "ubicacion", "movimiento", "orientacion"}
    assert isinstance(ev["tips"], list)


def test_confirm_and_remove_gloss():
    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"))
    s.pending = [{"gloss": "HOLA", "top3": [], "confident": False}, {"gloss": "SI", "top3": [], "confident": True}]
    out = asyncio.run(run(s, [{"type": "confirm_gloss", "index": 0, "gloss": "ADIOS"}, {"type": "remove_gloss", "index": 1}]))
    assert out[-1] == {"type": "pending", "glosses": ["ADIOS"]}


def test_no_hand_warning_once():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    out = asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}] + [frame(None)] * 130))
    assert [m["code"] for m in out if m["type"] == "warning"] == ["no_hand"]


def test_calibration_with_simulated_glove():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    msgs = [{"type": "hello", "mode": "practice", "target": None}, {"type": "calibrate", "step": "open"}]
    msgs += [frame((0, 1.0), simulate_line("R", i, i, flex=(0,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "fist"}]
    msgs += [frame((0, 1.0), simulate_line("R", i, i, flex=(80,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "done"}]
    out = asyncio.run(run(s, msgs))
    assert out[-1] == {"type": "calibration", "step": "done", "sides": {"L": False, "R": True}}


def test_unknown_message_is_error():
    out = asyncio.run(Session().handle({"type": "zzz"}))
    assert out[0]["type"] == "error"


def test_malformed_confirm_is_error():
    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"))
    out = asyncio.run(run(s, [{"type": "confirm_gloss"}]))
    assert len(out) == 1 and out[0]["type"] == "error"
    out = asyncio.run(run(s, [{"type": "remove_gloss", "index": "x"}]))
    assert len(out) == 1 and out[0]["type"] == "error"


def test_calibration_survives_hello_and_reset():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    msgs = [{"type": "hello", "mode": "practice", "target": None}, {"type": "calibrate", "step": "open"}]
    msgs += [frame((0, 1.0), simulate_line("R", i, i, flex=(0,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "fist"}]
    msgs += [frame((0, 1.0), simulate_line("R", i, i, flex=(80,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "done"}]
    asyncio.run(run(s, msgs))
    asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": None}]))
    assert s.calib["R"] is not None
    asyncio.run(run(s, [{"type": "reset"}]))
    assert s.calib["R"] is not None


def test_segmenter_depends_on_mode():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}]))
    assert (s.segmenter.still_frames, s.segmenter.max_len) == (10**6, 150)
    asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}]))
    assert s.segmenter.max_len == 120 and s.segmenter.still_frames < 100


class LenClassifier(FakeClassifier):
    def __init__(self):
        self.lengths = []

    def predict(self, norm, k=3):
        self.lengths.append(norm.T)
        return super().predict(norm, k)


def test_final_descent_is_trimmed_from_segment():
    clf = LenClassifier()
    s = Session(clf, {}, SentenceBuilder(llm=None, provider="none"))
    sign = [frame((-1.0 + 0.1 * i, 1.0)) for i in range(20)]
    lower = [frame((0.9, 1.0 + 0.4 * k)) for k in range(1, 11)]  # 6 cuadros bajando aún "activos"
    asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}]
                    + [frame((-1.0, 5.0))] * 5 + sign + lower + [frame((-1.0, 5.0))] * 10))
    assert clf.lengths == [20]


def test_descent_trim_is_capped_at_40_percent():
    clf = LenClassifier()
    s = Session(clf, {}, SentenceBuilder(llm=None, provider="none"))
    fall = [frame((0.1 * i, 0.15 * i)) for i in range(20)]  # todo el segmento baja
    asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}]
                    + [frame((-1.0, 5.0))] * 5 + fall + [frame((-1.0, 5.0))] * 10))
    assert clf.lengths == [12]


def calibrated_session():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    msgs = [{"type": "hello", "mode": "practice", "target": None}, {"type": "calibrate", "step": "open"}]
    msgs += [frame((0, 1.0), simulate_line("R", i, i, flex=(0,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "fist"}]
    msgs += [frame((0, 1.0), simulate_line("R", 100 + i, i, flex=(80,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "done"}]
    asyncio.run(run(s, msgs))
    assert s.calib["R"] is not None
    return s


def test_stale_glove_stops_influencing_after_10_frames():
    s = calibrated_session()
    line = simulate_line("R", 500, 0, flex=(40,) * 5)
    asyncio.run(run(s, [frame((0, 1.0), line)] * 16))
    used = [not np.isnan(g[0]).all() for g in s.gflex[-16:]]
    assert used == [True] * 11 + [False] * 5


def test_null_glove_is_absent_immediately():
    s = calibrated_session()
    asyncio.run(run(s, [frame((0, 1.0), simulate_line("R", 500, 0, flex=(40,) * 5)), frame((0, 1.0), None)]))
    assert not np.isnan(s.gflex[-2][0]).all() and np.isnan(s.gflex[-1][0]).all()


def test_repeated_line_is_not_a_new_calibration_sample():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    line = simulate_line("R", 7, 0, flex=(0,) * 5)
    asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": None}, {"type": "calibrate", "step": "open"}]
                    + [frame((0, 1.0), line)] * 12))
    assert len(s.calibrator.samples["R"]["open"]) == 1


def test_glove_line_for_wrong_side_is_ignored():
    s = calibrated_session()
    asyncio.run(run(s, [frame((0, 1.0), None), frame((0, 1.0), simulate_line("L", 500, 0, flex=(40,) * 5))]))
    assert np.isnan(s.gflex[-1][0]).all() and s.gloves["R"] is None


def test_invalid_frame_is_error_without_touching_state():
    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"))
    asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}, frame((0, 1.0))]))
    good = frame((0, 1.0))
    bad = [dict(good, gloves=["x"]), dict(good, w="640"), dict(good, h=None), dict(good, hands=[[1, 2]]),
           dict(good, hands="x"), dict(good, pose=[[0, 0]]), dict(good, face=7), {"type": "frame"}]
    for b in bad:
        out = asyncio.run(s.handle(b))
        assert out == [{"type": "error", "message": "cuadro inválido"}], b
    assert s.idx == 0 and len(s.hands) == 1 and len(s.normalizer.anchors) == 1


def test_confirm_gloss_is_canonical_string():
    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"))
    s.pending = [{"gloss": "HOLA", "top3": [], "confident": False}]
    out = asyncio.run(run(s, [{"type": "confirm_gloss", "index": 0, "gloss": "buenos días"}]))
    assert out[-1] == {"type": "pending", "glosses": ["BUENOS_DIAS"]}
    asyncio.run(run(s, [{"type": "confirm_gloss", "index": 0, "gloss": {"a": 1}}]))
    assert isinstance(s.pending[0]["gloss"], str)
    out = asyncio.run(run(s, [{"type": "build_sentence"}]))
    assert out[0]["type"] == "sentence"


def test_hello_validates_mode_and_target():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}]))
    for bad in ({"type": "hello", "mode": "xyz", "target": None},
                {"type": "hello", "mode": "practice", "target": ["HOLA"]}):
        out = asyncio.run(s.handle(bad))
        assert len(out) == 1 and out[0]["type"] == "error"
        assert (s.mode, s.target) == ("practice", "HOLA")


def test_build_sentence_without_pending_returns_empty_pending():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    assert asyncio.run(s.handle({"type": "build_sentence"})) == [{"type": "pending", "glosses": []}]


def two_hand_ref():
    hands = np.zeros((12, 2, 21, 3), np.float32)
    present = np.ones((12, 2), bool)
    for t in range(12):
        hands[t, 0] = make_hand(wrist=(-1.0 + 0.1 * t, 1.0), flex=(0, 90, 90, 90, 90))
        hands[t, 1] = make_hand(wrist=(1.0, 1.0), flex=(0, 90, 90, 90, 90))
    return build_reference("DOS", [NormSequence(hands, present, f"s{i}", f"s{i}") for i in range(3)])


def test_evaluation_marks_evaluable():
    refs = {"HOLA": ref(), "DOS": two_hand_ref()}
    for target, expected in (("HOLA", True), ("DOS", False), ("NADA", False)):
        s = Session(FakeClassifier(), refs, SentenceBuilder(llm=None, provider="none"))
        out = asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": target}] + sign_frames()))
        ev = next(m for m in out if m["type"] == "evaluation")
        assert ev["evaluable"] is expected, target


def test_frame_with_non_finite_or_non_positive_size_is_error():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    good = frame((0, 1.0))
    for b in (dict(good, w=float("inf")), dict(good, h=float("nan")), dict(good, w=0), dict(good, h=-480)):
        assert asyncio.run(s.handle(b)) == [{"type": "error", "message": "cuadro inválido"}], b
    assert s.idx == -1 and s.hands == []


def test_calibrate_open_restarts_after_cancel():
    """Cancelar a media calibración y volver a empezar no mezcla muestras del intento anterior."""
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    msgs = [{"type": "hello", "mode": "practice", "target": None}, {"type": "calibrate", "step": "open"}]
    msgs += [frame((0, 1.0), simulate_line("R", i, i, flex=(0,) * 5)) for i in range(12)]
    msgs += [{"type": "calibrate", "step": "fist"}]
    msgs += [frame((0, 1.0), simulate_line("R", 100 + i, i, flex=(80,) * 5)) for i in range(12)]
    asyncio.run(run(s, msgs))  # se cancela aquí (sin "done")
    out = asyncio.run(run(s, [{"type": "calibrate", "step": "open"}]))
    assert out == [{"type": "calibration", "step": "open", "status": "recording"}]
    assert s.calibrator.samples["R"] == {"open": [], "fist": []}


def test_rounded_frame_is_accepted():
    """El navegador redondea coordenadas (x, y, z a 1 decimal) y ángulos del guante: el servidor lo acepta."""
    s = calibrated_session()
    f = frame((0.3, 1.0), simulate_line("R", 900, 0, flex=(40,) * 5))
    f["hands"] = [[[round(v, 1) for v in p] for p in hand] for hand in f["hands"]]
    f["pose"] = [[round(p[0], 1), round(p[1], 1), round(p[2], 1), round(p[3], 2)] for p in f["pose"]]
    out = asyncio.run(run(s, [f]))
    assert all(m["type"] != "error" for m in out)
    assert not np.isnan(s.gflex[-1][0]).all()


class NoneClassifier:
    """Clasificador falso con NINGUNA (probabilidad `p_none`) en la posición `pos` (0 = top-1)."""

    def __init__(self, pos=0, p_none=0.8):
        self.pos, self.p_none = pos, p_none

    def predict(self, norm, k=3):
        others = [("HOLA", 0.3), ("ADIOS", 0.2), ("SI", 0.1), ("NO", 0.05)]
        out = others[:self.pos] + [("NINGUNA", self.p_none)] + others[self.pos:]
        return out[:k]


def _translate(clf):
    s = Session(clf, {}, SentenceBuilder(llm=None, provider="none"))
    return s, asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}] + sign_frames()))


def test_translate_discards_confident_none_silently():
    s, out = _translate(NoneClassifier(0, p_none=0.5))
    assert [m["type"] for m in out] == ["ready"]  # ni seña ni oración
    assert s.pending == []


def test_translate_weak_none_uses_first_real_alternative():
    s, out = _translate(NoneClassifier(0, p_none=0.45))
    sign = next(m for m in out if m["type"] == "sign")
    assert sign["gloss"] == "HOLA" and [g for g, _ in sign["top3"]] == ["HOLA", "ADIOS", "SI"]
    assert sign["confident"] is False  # 0.3 < CONF_MIN
    assert next(m for m in out if m["type"] == "sentence")["glosses"] == ["HOLA"]


def test_translate_filters_none_from_alternatives():
    s, out = _translate(NoneClassifier(1, p_none=0.15))
    sign = next(m for m in out if m["type"] == "sign")
    assert sign["gloss"] == "HOLA" and [g for g, _ in sign["top3"]] == ["HOLA", "ADIOS", "SI"]


def _practice(clf):
    s = Session(clf, {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"))
    out = asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}] + sign_frames()))
    return next(m for m in out if m["type"] == "evaluation")


def test_practice_none_top1_shows_as_not_recognized():
    # la UI no muestra "La app reconoció: NINGUNA": con lista vacía no muestra reconocimiento
    ev = _practice(NoneClassifier(0, p_none=0.8))
    assert ev["recognized"] == [] and "total" in ev


def test_practice_none_removed_from_alternatives():
    ev = _practice(NoneClassifier(1, p_none=0.15))
    assert [g for g, _ in ev["recognized"]] == ["HOLA", "ADIOS", "SI"]


# --- tasa de cuadros real (campo opcional "t" en ms) ---

from lsm.session import FrameRate  # noqa: E402


def test_frame_rate_defaults_to_30_and_estimates_from_dt():
    r = FrameRate()
    assert r.fps == 30.0
    r.push(None)
    assert r.fps == 30.0
    for k in range(20):
        r.push(1000.0 + k * 1000 / 15)
    assert abs(r.fps - 15.0) < 0.01


def test_frame_rate_is_clamped_and_ignores_gaps_and_bad_values():
    r = FrameRate()
    for k in range(10):
        r.push(k * 2.0)  # 500 fps → 60
    assert r.fps == 60.0
    r = FrameRate()
    for k in range(10):
        r.push(k * 400.0)  # 2.5 fps → 5
    assert r.fps == 5.0
    r = FrameRate()
    for t in (0.0, 66.7, 133.3, 5000.0, 5066.7, 5066.7, 100.0, float("nan"), "x", True):
        r.push(t)  # hueco de 5 s (pestaña oculta), repetido, hacia atrás y basura: se ignoran
    assert abs(r.fps - 15.0) < 0.1


def timed(frames, fps, t0=1000.0):
    return [dict(f, t=round(t0 + k * 1000 / fps, 1)) for k, f in enumerate(frames)]


def test_session_uses_frame_timestamps_for_segmenter_rate():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}] + timed([frame(None)] * 20, 15)))
    assert abs(s.rate.fps - 15.0) < 0.1 and abs(s.segmenter.rate - 0.5) < 0.01
    # el cambio de modo conserva la tasa medida
    asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}]))
    assert abs(s.segmenter.rate - 0.5) < 0.01


def test_invalid_timestamp_is_ignored_not_an_error():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    for t in ("x", None, float("inf"), True, [1]):
        out = asyncio.run(s.handle(dict(frame((0, 1.0)), t=t)))
        assert all(m["type"] != "error" for m in out), t
    assert s.rate.fps == 30.0


def timed_sign(fps):
    """Reposo 0.3 s, seña de 1 s, reposo 2 s, muestreados a `fps` con su marca de tiempo."""
    n = lambda sec: int(round(sec * fps))  # noqa: E731
    frames = [frame((-1.0, 5.0))] * n(0.3) + [frame((-1.0 + 2.0 * k / n(1.0), 1.0)) for k in range(n(1.0))]
    return timed(frames + [frame((-1.0, 5.0))] * n(2.0), fps), n(0.3) + n(1.0)


def test_practice_evaluation_arrives_as_fast_at_15_fps():
    for fps in (30, 15):
        s = Session(FakeClassifier(), {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"))
        frames, first_rest = timed_sign(fps)
        asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}]))
        for i, f in enumerate(frames):
            if any(m["type"] == "evaluation" for m in asyncio.run(s.handle(f))):
                break
        latency = (i - first_rest + 1) / fps  # desde que la mano deja de verse arriba
        assert latency <= 4 / 15 + 1e-6, (fps, latency)  # 0.2 s a 30 fps, 0.27 s a 15 (antes 0.4 s)


def test_no_hand_warning_after_same_time_at_15_fps():
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}]))
    at = [i for i, f in enumerate(timed([frame(None)] * 70, 15))
          if any(m["type"] == "warning" for m in asyncio.run(s.handle(f)))]
    assert len(at) == 1 and 28 <= at[0] <= 31  # ~2 s, como 60 cuadros a 30 fps


# --- registro de diagnóstico ---

def test_segment_is_logged_with_reason_fps_and_top3(caplog):
    caplog.set_level("INFO", logger="lsm.session")
    s = Session(FakeClassifier(), {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"))
    frames, _ = timed_sign(15)
    asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}] + frames))
    seg = [r.getMessage() for r in caplog.records if r.getMessage().startswith("segmento")]
    assert len(seg) == 1
    for part in ("modo=practice", "objetivo=HOLA", "motivo=reposo", "fps=15.0", "top3=HOLA:0.9",
                 "total=", "top_y_min=", "top_y_fin=", "seg="):
        assert part in seg[0], (part, seg[0])


def test_logs_never_contain_sentence_text(caplog):
    caplog.set_level("INFO", logger="lsm")

    async def fake_llm(system, user):
        return "Texto privado de la oración."

    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=fake_llm))
    out = asyncio.run(run(s, [{"type": "hello", "mode": "translate", "target": None}] + sign_frames()))
    assert any(m["type"] == "sentence" for m in out)
    assert any("motivo=reposo" in r.getMessage() for r in caplog.records)
    assert not any("privado" in r.getMessage() for r in caplog.records)


def test_periodic_summary_every_5_seconds(caplog):
    caplog.set_level("INFO", logger="lsm.session")
    s = Session(None, {}, SentenceBuilder(llm=None, provider="none"))
    frames = [frame((0.0, 1.0))] * 45 + [frame(None)] * 45  # 6 s a 15 fps: la mitad sin manos
    asyncio.run(run(s, [{"type": "hello", "mode": "practice", "target": "HOLA"}] + timed(frames, 15)))
    summ = [r.getMessage() for r in caplog.records if r.getMessage().startswith("resumen")]
    assert len(summ) == 1
    for part in ("fps=15.0", "manos=", "activos=", "top_y_med=", "top_y_p90=", "rest_y=3.5", "estado="):
        assert part in summ[0], (part, summ[0])


# --- pausa de oración (3.5 s por defecto) y aviso "pausing" ---

def rest_after_sign(fps, rest_s, t0=1000.0):
    """Reposo 0.3 s, seña de 1 s y `rest_s` s de reposo, con marca de tiempo. Devuelve (cuadros, índice del
    primer cuadro en reposo tras la seña)."""
    n = lambda sec: int(round(sec * fps))  # noqa: E731
    frames = [frame((-1.0, 5.0))] * n(0.3) + [frame((-1.0 + 2.0 * k / n(1.0), 1.0)) for k in range(n(1.0))]
    return timed(frames + [frame((-1.0, 5.0))] * n(rest_s), fps, t0), n(0.3) + n(1.0)


def per_frame(s, frames):
    return [asyncio.run(s.handle(f)) for f in frames]


def test_sentence_waits_3_5_s_of_rest_at_15_and_30_fps(monkeypatch):
    monkeypatch.delenv("LSM_PAUSE_S", raising=False)
    for fps in (30, 15):
        s = Session(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"))
        asyncio.run(s.handle({"type": "hello", "mode": "translate", "target": None}))
        frames, down = rest_after_sign(fps, 5.0)
        outs = per_frame(s, frames)
        at = [i for i, o in enumerate(outs) if any(m["type"] == "sentence" for m in o)]
        assert len(at) == 1, fps
        waited = (at[0] - down + 1) / fps
        assert waited > 1.5 and 3.5 - 1 / fps <= waited <= 3.5 + 2 / fps, (fps, waited)


def test_pausing_countdown_every_half_second(monkeypatch):
    monkeypatch.delenv("LSM_PAUSE_S", raising=False)
    for fps in (30, 15):
        s = Session(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"))
        asyncio.run(s.handle({"type": "hello", "mode": "translate", "target": None}))
        frames, down = rest_after_sign(fps, 5.0)
        outs = per_frame(s, frames)
        ticks = [(i, m) for i, o in enumerate(outs) for m in o if m["type"] == "pausing"]
        sign_at = next(i for i, o in enumerate(outs) if any(m["type"] == "sign" for m in o))
        sent_at = next(i for i, o in enumerate(outs) if any(m["type"] == "sentence" for m in o))
        assert ticks and ticks[0][0] == sign_at  # el aviso empieza con la seña cerrada por reposo
        assert all(m["total"] == 3.5 and m["remaining"] is not None for _, m in ticks)
        assert 2.9 <= ticks[0][1]["remaining"] <= 3.5
        gaps = [(b - a) / fps for (a, _), (b, _) in zip(ticks, ticks[1:])]
        assert gaps and all(abs(g - 0.5) <= 1 / fps + 1e-9 for g in gaps), (fps, gaps)
        rem = [m["remaining"] for _, m in ticks]
        assert rem == sorted(rem, reverse=True) and rem[-1] <= 0.6
        assert ticks[-1][0] < sent_at
        # tras la oración no hay aviso de cancelación ni más cuenta regresiva
        assert not [m for o in outs[sent_at:] for m in o if m["type"] == "pausing"]


def test_raising_hands_cancels_pausing():
    fps = 30
    s = Session(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"))
    asyncio.run(s.handle({"type": "hello", "mode": "translate", "target": None}))
    frames, _ = rest_after_sign(fps, 1.5)
    outs = per_frame(s, frames)
    assert any(m["type"] == "pausing" and m["remaining"] is not None for o in outs for m in o)
    again = timed([frame((-1.0 + 0.1 * k, 1.0)) for k in range(10)], fps, t0=frames[-1]["t"] + 1000 / fps)
    outs = per_frame(s, again)
    msgs = [m for o in outs for m in o if m["type"] == "pausing"]
    assert msgs == [{"type": "pausing", "remaining": None}]
    assert not any(m["type"] == "sentence" for o in outs for m in o)


def test_no_pausing_without_pending_glosses():
    s, out = _translate(NoneClassifier(0, p_none=0.5))  # la seña se descarta: nada que formar
    assert not [m for m in out if m["type"] == "pausing"]
