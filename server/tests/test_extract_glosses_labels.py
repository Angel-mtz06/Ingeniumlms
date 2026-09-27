import sys
from pathlib import Path

sys.path.insert(0, "D:/Ingenium/training")
from extract_glosses import label_of  # noqa: E402


def test_label_of_uses_parent_folder_for_misnamed_file():
    # Error de autoría del dataset: TEMPERATURA/FIEBRE_3.mp4 (nombre de archivo
    # de otra glosa). La glosa canónica debe venir de la carpeta contenedora.
    path = Path("D:/Ingenium/datasets/lsm_glosses/extracted/Mexican Sign Language Glosses"
                "/TEMPERATURA/FIEBRE_3.mp4")
    assert label_of(path) == ("TEMPERATURA", "3")


def test_label_of_matches_filename_when_consistent():
    path = Path("D:/Ingenium/datasets/lsm_glosses/extracted/Mexican Sign Language Glosses"
                "/ACCIDENTE/ACCIDENTE_11.mp4")
    assert label_of(path) == ("ACCIDENTE", "11")
