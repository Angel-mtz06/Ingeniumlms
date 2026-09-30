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


def test_active_model_file_utf16_bom(tmp_path, monkeypatch):
    # PowerShell 5.1 con `>` escribe UTF-16 LE con BOM
    m = _models(tmp_path, monkeypatch, "classifier_v1", "classifier_v2")
    (m / "ACTIVE_MODEL").write_bytes("classifier_v2\r\n".encode("utf-16"))
    assert paths.active_model_name() == "classifier_v2"


def test_unreadable_active_model_file_falls_back(tmp_path, monkeypatch, caplog):
    m = _models(tmp_path, monkeypatch, "classifier_v1")
    (m / "ACTIVE_MODEL").write_bytes(b"\xff\xfe\x00\xd8")  # UTF-16 inválido (sustituto suelto)
    with caplog.at_level("WARNING"):
        assert paths.active_model_name() == "classifier_v1"
    (m / "ACTIVE_MODEL").write_bytes(b"\x80\x81classifier")  # UTF-8 inválido
    assert paths.active_model_name() == "classifier_v1"
    (m / "ACTIVE_MODEL").unlink()
    (m / "ACTIVE_MODEL").mkdir()  # no se puede leer como archivo: OSError
    assert paths.active_model_name() == "classifier_v1"


def test_references_and_vocab_follow_active_model(tmp_path, monkeypatch):
    _models(tmp_path, monkeypatch, "classifier_v1", "classifier_v2")
    monkeypatch.setattr(paths, "DATASETS", tmp_path / "datasets")
    monkeypatch.setattr(paths, "PROCESSED", tmp_path / "datasets" / "processed")
    # sin archivos propios del modelo: los de siempre (los de v1)
    assert paths.active_references_path("classifier_v2") == tmp_path / "references.json"
    assert paths.active_vocab_path("classifier_v2") == tmp_path / "datasets" / "processed" / "vocab.csv"
    (tmp_path / "references_classifier_v2.json").write_text("{}", encoding="utf-8")
    (tmp_path / "datasets" / "processed_classifier_v2").mkdir(parents=True)
    (tmp_path / "datasets" / "processed_classifier_v2" / "vocab.csv").write_text("gloss\n", encoding="utf-8")
    assert paths.active_references_path("classifier_v2") == tmp_path / "references_classifier_v2.json"
    assert paths.active_vocab_path("classifier_v2") == tmp_path / "datasets" / "processed_classifier_v2" / "vocab.csv"
    assert paths.active_references_path("classifier_v1") == tmp_path / "references.json"


def test_processed_dir_can_be_overridden(monkeypatch):
    import importlib
    monkeypatch.setenv("LSM_PROCESSED", "D:/Ingenium/tools/tmp/otro_processed")
    try:
        importlib.reload(paths)
        assert str(paths.PROCESSED).replace("\\", "/") == "D:/Ingenium/tools/tmp/otro_processed"
    finally:
        monkeypatch.delenv("LSM_PROCESSED")
        importlib.reload(paths)
    assert paths.PROCESSED == paths.DATASETS / "processed"


def test_ensemble_uses_references_and_vocab_of_its_base_model(tmp_path, monkeypatch):
    # classifier_v2e = ensamble de semillas de classifier_v2: mismas clases, mismas referencias y catálogo
    _models(tmp_path, monkeypatch, "classifier_v1", "classifier_v2", "classifier_v2e")
    monkeypatch.setattr(paths, "DATASETS", tmp_path / "datasets")
    monkeypatch.setattr(paths, "PROCESSED", tmp_path / "datasets" / "processed")
    (tmp_path / "references_classifier_v2.json").write_text("{}", encoding="utf-8")
    (tmp_path / "datasets" / "processed_classifier_v2").mkdir(parents=True)
    (tmp_path / "datasets" / "processed_classifier_v2" / "vocab.csv").write_text("gloss\n", encoding="utf-8")
    assert paths.base_model("classifier_v2e") == "classifier_v2"
    assert paths.base_model("classifier_v2") == "classifier_v2"
    assert paths.base_model("classifier_v1") == "classifier_v1"
    assert paths.active_references_path("classifier_v2e") == tmp_path / "references_classifier_v2.json"
    assert paths.active_vocab_path("classifier_v2e") == tmp_path / "datasets" / "processed_classifier_v2" / "vocab.csv"
    # un archivo propio del ensamble manda
    (tmp_path / "references_classifier_v2e.json").write_text("{}", encoding="utf-8")
    assert paths.active_references_path("classifier_v2e") == tmp_path / "references_classifier_v2e.json"
