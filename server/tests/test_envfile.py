import os

from lsm.envfile import load_env_file


def test_carga_claves_comillas_y_comentarios(tmp_path, monkeypatch):
    for k in ("LSM_T_A", "LSM_T_B", "LSM_T_C"):
        monkeypatch.delenv(k, raising=False)
    env = tmp_path / ".env"
    env.write_text('# comentario\nLSM_T_A=uno\nexport LSM_T_B="dos = tres"\n\nbasura\nLSM_T_C=\'x\'\n', encoding="utf-8")
    assert load_env_file(env) == ["LSM_T_A", "LSM_T_B", "LSM_T_C"]
    assert os.environ["LSM_T_A"] == "uno"
    assert os.environ["LSM_T_B"] == "dos = tres"
    assert os.environ["LSM_T_C"] == "x"


def test_no_sobrescribe_el_entorno(tmp_path, monkeypatch):
    monkeypatch.setenv("LSM_T_A", "real")
    env = tmp_path / ".env"
    env.write_text("LSM_T_A=archivo\n", encoding="utf-8")
    assert load_env_file(env) == []
    assert os.environ["LSM_T_A"] == "real"


def test_archivo_inexistente(tmp_path):
    assert load_env_file(tmp_path / "no.env") == []


def test_bom_de_notepad(tmp_path, monkeypatch):
    monkeypatch.delenv("LSM_T_A", raising=False)
    env = tmp_path / ".env"
    env.write_bytes("﻿LSM_T_A=ok\n".encode("utf-8"))
    assert load_env_file(env) == ["LSM_T_A"]
    assert os.environ["LSM_T_A"] == "ok"
