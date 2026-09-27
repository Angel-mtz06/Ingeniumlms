from lsm import paths


def test_paths_live_under_root_on_d():
    assert str(paths.ROOT).replace("\\", "/").lower().startswith("d:/ingenium")
    for p in (paths.DATASETS, paths.RAW_LANDMARKS, paths.PROCESSED, paths.MODELS, paths.MP_MODELS):
        assert paths.ROOT in p.parents
