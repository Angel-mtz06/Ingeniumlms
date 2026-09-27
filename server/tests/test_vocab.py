from lsm.vocab import MENDELEY_ES, build_vocab, canonical, lookup, mendeley_category


def test_mendeley_has_249_unique_canonical_glosses():
    assert sorted(MENDELEY_ES) == list(range(1, 250))
    assert len(set(MENDELEY_ES.values())) == 249
    assert all(g == canonical(g) for g in MENDELEY_ES.values())


def test_canonical_strips_accents_keeps_enye():
    assert canonical("Año próximo") == "AÑO_PROXIMO"
    assert canonical("corazón") == "CORAZON"


def test_lookup_both_datasets():
    assert lookup("mendeley", "036") == "ESCUELA"
    assert lookup("mendeley", "238") == "OAXACA"
    assert lookup("glosses", "POR_FAVOR") == "POR_FAVOR"


def test_overlaps_are_merged():
    rows = build_vocab(["HOLA", "AYUDA", "YO", "DOCTOR"])
    by = {r["gloss"]: r for r in rows}
    assert by["AYUDA"]["sources"] == "mendeley:185;glosses:AYUDA"
    assert by["HOLA"]["sources"] == "glosses:HOLA"
    assert len(rows) == 249 + 1  # solo HOLA es nueva


def test_categories():
    assert mendeley_category(36) == "escuela"
    assert mendeley_category(170) == "pronombres"
