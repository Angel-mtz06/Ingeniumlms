from lsm import paths


def test_paths_live_under_root_on_d():
    assert str(paths.ROOT).replace("\\", "/").lower().startswith("d:/ingenium")
    for p in (paths.DATASETS, paths.RAW_LANDMARKS, paths.PROCESSED, paths.MODELS, paths.MP_MODELS):
        assert paths.ROOT in p.parents


def _models(tmp_path, monkeypatch, *names):
    monkeypatch.setattr(paths, "MODELS", tmp_path)
    monkeypatch.delenv("LSM_MODEL", raising=False)
    for n in names:
        (tmp_path / f"{n}.pt").write_bytes(b"x")
    return tmp_path


def test_active_model_defaults_to_v1(tmp_path, monkeypatch):
    _models(tmp_path, monkeypatch, "classifier_v1")
    assert paths.active_model_name() == "classifier_v1"
    assert paths.active_model_path() == tmp_path / "classifier_v1.pt"


def test_active_model_reads_file(tmp_path, monkeypatch):
    m = _models(tmp_path, monkeypatch, "classifier_v1", "classifier_v2")
    (m / "ACTIVE_MODEL").write_text("classifier_v2\n", encoding="utf-8")
    assert paths.active_model_name() == "classifier_v2"
    assert paths.active_model_path() == tmp_path / "classifier_v2.pt"


def test_env_var_has_priority(tmp_path, monkeypatch):
    m = _models(tmp_path, monkeypatch, "classifier_v1", "classifier_v2", "classifier_v3")
    (m / "ACTIVE_MODEL").write_text("classifier_v2", encoding="utf-8")
    monkeypatch.setenv("LSM_MODEL", "classifier_v3")
    assert paths.active_model_name() == "classifier_v3"


def test_invalid_or_missing_model_falls_back_to_v1(tmp_path, monkeypatch, caplog):
    m = _models(tmp_path, monkeypatch, "classifier_v1")
    for bad in ("../evil", "classifier_v9", "a b", "x" * 65, ""):
        (m / "ACTIVE_MODEL").write_text(bad, encoding="utf-8")
        assert paths.active_model_name() == "classifier_v1", bad
    monkeypatch.setenv("LSM_MODEL", "no_existe")
    with caplog.at_level("WARNING"):
        assert paths.active_model_name() == "classifier_v1"
    assert "no_existe" in caplog.text
