import csv

from fastapi.testclient import TestClient

from lsm.app import create_app
from lsm.sentences import SentenceBuilder
from lsm.vocab import lookup
from tests.test_session import FakeClassifier, frame, ref


def client(tmp_path):
    app = create_app(FakeClassifier(), {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"),
                     static_dir=None, own_dir=tmp_path / "own")
    return TestClient(app)


def test_health_and_reference(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/health").json() == {"ok": True, "classifier": True, "references": 1, "llm": False}
    r = c.get("/api/reference/HOLA").json()
    assert r["gloss"] == "HOLA" and len(r["example_hands"]) == 16 and r["slots_used"] == [True, False]
    assert c.get("/api/reference/NADA").status_code == 404


def test_vocab_falls_back_to_references(tmp_path, monkeypatch):
    monkeypatch.setattr("lsm.app.VOCAB_CSV", tmp_path / "no.csv")
    assert client(tmp_path).get("/api/vocab").json() == [{"gloss": "HOLA", "category": "", "has_reference": True}]


def test_recording_saved_and_indexed(tmp_path):
    c = client(tmp_path)
    frames = [frame((0.0, 1.0)) for _ in range(5)]
    r = c.post("/api/recordings", json={"label": "hola", "signer": "angel", "frames": frames}).json()
    assert r["frames"] == 5 and r["sample_id"].startswith("angel_HOLA_")
    rows = list(csv.DictReader(open(tmp_path / "own" / "index_own.csv", encoding="utf-8")))
    assert rows[0]["dataset"] == "own" and rows[0]["source_label"] == "HOLA" and rows[0]["signer"] == "angel"


def test_websocket_hello(tmp_path):
    with client(tmp_path).websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello", "mode": "practice", "target": "HOLA"})
        assert ws.receive_json() == {"type": "ready", "mode": "practice", "target": "HOLA", "has_reference": True}


def test_lookup_own():
    assert lookup("own", "Mañana") == "MAÑANA"


def test_recording_rejects_path_traversal(tmp_path):
    c = client(tmp_path)
    frames = [frame((0.0, 1.0)) for _ in range(5)]
    assert c.post("/api/recordings", json={"label": "hola", "signer": "../../evil", "frames": frames}) \
        .status_code == 400
    assert c.post("/api/recordings", json={"label": "hola", "signer": "C:/evil", "frames": frames}) \
        .status_code == 400
    assert c.post("/api/recordings", json={"label": "../x", "signer": "angel", "frames": frames}) \
        .status_code == 400
    raw_dir = tmp_path / "own" / "raw"
    written = list(raw_dir.glob("*.npz")) if raw_dir.exists() else []
    assert written == []
    assert not list(tmp_path.rglob("evil*"))


def test_websocket_survives_bad_frame(tmp_path):
    with client(tmp_path).websocket_connect("/ws") as ws:
        ws.send_json({"type": "frame"})
        err = ws.receive_json()
        assert err["type"] == "error"
        ws.send_json({"type": "hello", "mode": "practice", "target": "HOLA"})
        assert ws.receive_json() == {"type": "ready", "mode": "practice", "target": "HOLA", "has_reference": True}


def test_recording_rejects_bad_signer_names(tmp_path):
    c = client(tmp_path)
    frames = [frame((0.0, 1.0)) for _ in range(3)]
    for signer in ("angel_x", "angel\n", "", "a" * 33):
        assert c.post("/api/recordings", json={"label": "hola", "signer": signer, "frames": frames}) \
            .status_code == 400, signer
    assert c.post("/api/recordings", json={"label": "hola", "signer": "ana-2", "frames": frames}).status_code == 200


def test_recording_too_long_is_rejected(tmp_path):
    c = client(tmp_path)
    frames = [{"w": 640, "h": 480}] * 1801
    assert c.post("/api/recordings", json={"label": "hola", "signer": "angel", "frames": frames}).status_code == 400


def test_recording_take_number_never_overwrites(tmp_path):
    c = client(tmp_path)
    raw_dir = tmp_path / "own" / "raw"
    raw_dir.mkdir(parents=True)
    (raw_dir / "angel_HOLA_003.npz").write_bytes(b"previa")
    frames = [frame((0.0, 1.0)) for _ in range(3)]
    r = c.post("/api/recordings", json={"label": "hola", "signer": "angel", "frames": frames}).json()
    assert r["sample_id"] == "angel_HOLA_004"
    assert (raw_dir / "angel_HOLA_003.npz").read_bytes() == b"previa"


def test_main_limits_torch_threads(tmp_path, monkeypatch):
    import torch
    import uvicorn

    import lsm.app as app_mod
    calls = []
    monkeypatch.setattr(torch, "set_num_threads", lambda n: calls.append(n))
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: calls.append("run"))
    monkeypatch.setattr(app_mod, "MODELS", tmp_path)  # sin modelo: no carga nada
    app_mod.main()
    assert calls == [2, "run"]


def test_recording_rejects_bad_frame_size(tmp_path):
    c = client(tmp_path)
    for bad in (float("inf"), 0, -1):
        frames = [frame((0.0, 1.0)) for _ in range(3)]
        frames[1] = dict(frames[1], w=bad)
        assert c.post("/api/recordings", json={"label": "hola", "signer": "angel", "frames": frames}) \
            .status_code == 400, bad
    assert not list((tmp_path / "own").rglob("*.npz"))
