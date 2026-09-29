from lsm.splits import TEST_SIGNERS, VAL_SIGNERS, split_of


def test_split_by_signer():
    assert split_of("m02") == "test" and split_of("g02") == "test"
    assert split_of("m03") == "val" and split_of("g03") == "val"
    assert split_of("g11") == "train"  # la persona sorda se queda en entrenamiento (referencias)
    assert not (VAL_SIGNERS & TEST_SIGNERS)


def test_own_recordings_split_by_take():
    # grabaciones propias: toma % 5 == 0 → val (para medir las glosas propias); el resto → train
    assert split_of("angel", "own", "angel_HOLA_000") == "val"
    assert split_of("angel", "own", "angel_HOLA_005") == "val"
    for t in (1, 2, 3, 4, 6, 11):
        assert split_of("angel", "own", f"angel_HOLA_{t:03d}") == "train", t
    # la regla por persona manda primero
    assert split_of("m02", "own", "m02_HOLA_001") == "test"
    # otros datasets no miran la toma
    assert split_of("g11", "glosses", "g11_HOLA_000") == "train"


def test_own_none_class_always_train():
    # NINGUNA se usa entera para aprender a rechazar (sus ventanas se solapan: no sirven para medir)
    assert split_of("angel", "own", "angel_NINGUNA_000_w3", gloss="NINGUNA") == "train"
    assert split_of("angel", "own", "angel_NINGUNA_000", gloss="NINGUNA") == "train"


def test_own_without_take_number_is_train():
    assert split_of("angel", "own", "raro") == "train"
