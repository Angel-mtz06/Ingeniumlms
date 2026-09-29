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
    assert c.get("/api/health").json() == {"ok": True, "classifier": True, "references": 1, "llm": False,
                                           "model": None}
    r = c.get("/api/reference/HOLA").json()
    assert r["gloss"] == "HOLA" and len(r["example_hands"]) == 16 and r["slots_used"] == [True, False]
    assert c.get("/api/reference/NADA").status_code == 404


def test_health_reports_model_name(tmp_path):
    app = create_app(FakeClassifier(), {}, SentenceBuilder(llm=None, provider="none"), own_dir=tmp_path / "own",
                     model_name="classifier_v2")
    assert TestClient(app).get("/api/health").json()["model"] == "classifier_v2"


def test_vocab_hides_none_class(tmp_path, monkeypatch):
    vocab_csv = tmp_path / "vocab.csv"
    vocab_csv.write_text("gloss,category,sources\nHOLA,saludos,x\nNINGUNA,propias,own\n", encoding="utf-8")
    monkeypatch.setattr("lsm.app.VOCAB_CSV", vocab_csv)
    assert [v["gloss"] for v in client(tmp_path).get("/api/vocab").json()] == ["HOLA"]
    monkeypatch.setattr("lsm.app.VOCAB_CSV", tmp_path / "no.csv")
    app = create_app(FakeClassifier(), {"HOLA": ref(), "NINGUNA": ref()}, SentenceBuilder(llm=None, provider="none"),
                     own_dir=tmp_path / "own")
    assert [v["gloss"] for v in TestClient(app).get("/api/vocab").json()] == ["HOLA"]


def test_vocab_csv_of_active_model(tmp_path):
    v2 = tmp_path / "vocab_v2.csv"
    v2.write_text("gloss,category,sources\nHOLA,saludos,x\nMAÑANA,propias,own\n", encoding="utf-8")
    app = create_app(FakeClassifier(), {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"),
                     own_dir=tmp_path / "own", vocab_csv=v2)
    assert [v["gloss"] for v in TestClient(app).get("/api/vocab").json()] == ["HOLA", "MAÑANA"]


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
    monkeypatch.setattr(app_mod, "LOG_PATH", tmp_path / "logs" / "lsm.log")  # no ensuciar D:/Ingenium/logs
    try:
        app_mod.main()
        assert calls == [2, "run"]
        assert (tmp_path / "logs" / "lsm.log").exists()
    finally:
        import logging
        lg = logging.getLogger("lsm")
        for h in [h for h in lg.handlers if str(tmp_path) in getattr(h, "baseFilename", "")]:
            lg.removeHandler(h)
            h.close()


def test_recording_rejects_bad_frame_size(tmp_path):
    c = client(tmp_path)
    for bad in (float("inf"), 0, -1):
        frames = [frame((0.0, 1.0)) for _ in range(3)]
        frames[1] = dict(frames[1], w=bad)
        assert c.post("/api/recordings", json={"label": "hola", "signer": "angel", "frames": frames}) \
            .status_code == 400, bad
    assert not list((tmp_path / "own").rglob("*.npz"))


def test_index_html_is_not_cached_but_assets_are(tmp_path):
    web = tmp_path / "dist"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>x</title>", encoding="utf-8")
    (web / "assets" / "app-abc123.js").write_text("console.log(1)", encoding="utf-8")
    app = create_app(FakeClassifier(), {"HOLA": ref()}, SentenceBuilder(llm=None, provider="none"),
                     static_dir=web, own_dir=tmp_path / "own")
    c = TestClient(app)
    for path in ("/", "/index.html"):
        r = c.get(path)
        assert r.status_code == 200 and "<title>x</title>" in r.text
        assert r.headers["cache-control"] == "no-cache", path
    r = c.get("/assets/app-abc123.js")
    assert r.status_code == 200 and "no-cache" not in r.headers.get("cache-control", "")
    assert c.get("/api/health").json()["classifier"] is True


def test_setup_logging_writes_rotating_file(tmp_path):
    import logging
    from logging.handlers import RotatingFileHandler

    from lsm.app import setup_logging

    log = tmp_path / "logs" / "lsm.log"
    h = setup_logging(log)
    try:
        assert isinstance(h, RotatingFileHandler)
        assert h.maxBytes == 5 * 1024 * 1024 and h.backupCount == 2
        assert setup_logging(log) is h  # idempotente: no duplica líneas
        logging.getLogger("lsm.session").info("segmento prueba")
        h.flush()
        assert "segmento prueba" in log.read_text(encoding="utf-8")
    finally:
        logging.getLogger("lsm").removeHandler(h)
        h.close()
