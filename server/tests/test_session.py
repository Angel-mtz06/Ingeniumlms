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
    return [frame((-1.0, 5.0))] * 5 + [frame((-1.0 + 0.05 * i, 1.0)) for i in range(20)] + [frame((-1.0, 5.0))] * 60


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
