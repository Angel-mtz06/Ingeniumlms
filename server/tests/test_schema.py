import numpy as np

from lsm.schema import FACE_IDX, N_FACE, RawSequence


def test_face_idx_has_22_points_starting_with_nose_and_cheeks():
    assert N_FACE == 22 and len(FACE_IDX) == 22
    assert FACE_IDX[:3] == (1, 234, 454)


def test_empty_is_all_nan_with_shapes():
    r = RawSequence.empty(4, 640, 480, fps=10.0, sample_id="a", dataset="mendeley", source_label="036", signer="m01")
    assert r.T == 4
    assert r.hands.shape == (4, 2, 21, 3) and np.isnan(r.hands).all()
    assert r.pose.shape == (4, 33, 4) and r.face.shape == (4, 22, 3) and r.face_box.shape == (4, 4)


def test_save_load_roundtrip(tmp_path):
    r = RawSequence.empty(3, 960, 540, fps=30.0, sample_id="g00_HOLA", dataset="glosses", source_label="HOLA", signer="g00")
    r.hands[1, 0] = 5.0
    p = tmp_path / "x.npz"
    r.save(p)
    q = RawSequence.load(p)
    assert (q.width, q.height, q.fps, q.sample_id, q.dataset, q.source_label, q.signer) == (960, 540, 30.0, "g00_HOLA", "glosses", "HOLA", "g00")
    np.testing.assert_array_equal(np.nan_to_num(q.hands, nan=-1), np.nan_to_num(r.hands, nan=-1))
