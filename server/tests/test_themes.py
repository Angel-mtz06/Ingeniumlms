import csv

import pytest

from lsm.paths import PROCESSED
from lsm.themes import THEME_OF, THEMES, theme_of


def test_saludos_no_quedan_en_salud():
    assert theme_of("HOLA") == "Saludos y cortesía"
    assert theme_of("AMIGO") == "Personas"
    assert theme_of("SI") == "Respuestas y descripciones"
    assert theme_of("DOLOR") == "Salud y síntomas"
    assert theme_of("ACCIDENTE") == "Emergencias"


def test_sin_clasificar_conserva_la_categoria():
    assert theme_of("ZZZ", "propias") == "propias"
    assert theme_of("ZZZ") == ""


def test_cada_glosa_en_un_solo_tema():
    from lsm.themes import _THEMES
    words = [g for w in _THEMES.values() for g in w.split()]
    assert sorted({g for g in words if words.count(g) > 1}) == []
    assert set(THEME_OF.values()) == set(THEMES)


def test_todo_el_vocabulario_real_tiene_tema():
    path = PROCESSED / "vocab.csv"
    if not path.exists():
        pytest.skip("sin datasets/processed/vocab.csv")
    glosses = [r["gloss"] for r in csv.DictReader(open(path, encoding="utf-8")) if r["gloss"] != "NINGUNA"]
    assert [g for g in glosses if g not in THEME_OF] == []
