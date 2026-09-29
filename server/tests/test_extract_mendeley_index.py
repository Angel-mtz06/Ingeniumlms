import sys

sys.path.insert(0, "D:/Ingenium/training")
import extract_mendeley  # noqa: E402


def test_merge_index_keeps_other_words():
    old = [{"sample_id": "m01_001", "hand_ratio": 0.5}, {"sample_id": "m01_058", "hand_ratio": 0.1}]
    new = [{"sample_id": "m01_058", "hand_ratio": 0.9}, {"sample_id": "m02_058", "hand_ratio": 0.8}]
    got = extract_mendeley.merge_index(old, new)
    assert [r["sample_id"] for r in got] == ["m01_001", "m01_058", "m02_058"]
    assert got[1]["hand_ratio"] == 0.9  # la extracción nueva reemplaza a la vieja
