from lsm.splits import TEST_SIGNERS, VAL_SIGNERS, split_of


def test_split_by_signer():
    assert split_of("m02") == "test" and split_of("g02") == "test"
    assert split_of("m03") == "val" and split_of("g03") == "val"
    assert split_of("g11") == "train"  # la persona sorda se queda en entrenamiento (referencias)
    assert not (VAL_SIGNERS & TEST_SIGNERS)
