import numpy as np

from lsm.live import LiveNormalizer, frame_to_raw, frames_to_raw
from tests.conftest import make_hand


def frame(hands_px, head=(320.0, 100.0), head_w=30.0, with_pose=True):
    pose = None
    if with_pose:
        pose = [[0.0, 0.0, 0.0, 0.0] for _ in range(33)]
        pose[0] = [head[0], head[1], 0.0, 0.99]
        pose[7] = [head[0] + head_w / 2, head[1], 0.0, 0.99]
        pose[8] = [head[0] - head_w / 2, head[1], 0.0, 0.99]
    return {"w": 640, "h": 480, "hands": [h.tolist() for h in hands_px], "pose": pose, "face": None, "gloves": {}}


def test_frame_to_raw_fills_arrays():
    r = frame_to_raw(frame([make_hand((300, 200), 30)]))
    assert r.T == 1 and r.width == 640
    assert not np.isnan(r.hands[0, 0, 0, 0]) and np.isnan(r.hands[0, 1, 0, 0])
    assert r.pose[0, 0, 3] > 0.9


def test_frames_to_raw_stacks_and_keeps_meta():
    r = frames_to_raw([frame([]), frame([make_hand((300, 200), 30)])], sample_id="x", dataset="own", source_label="HOLA", signer="a")
    assert r.T == 2 and r.sample_id == "x" and np.isnan(r.hands[0]).all()


def test_live_normalizer_units_and_median_anchor():
    ln = LiveNormalizer(window=5)
    h, p = ln.push(frame_to_raw(frame([make_hand((260, 190), 30)])))
    assert p.tolist() == [True, False]
    np.testing.assert_allclose(h[0, 0, :2], [-2.0, 3.0], atol=1e-4)
    # cuadro sin pose: usa la mediana previa
    h2, p2 = ln.push(frame_to_raw(frame([make_hand((260, 190), 30)], with_pose=False)))
    np.testing.assert_allclose(h2[0, 0, :2], [-2.0, 3.0], atol=1e-4)


def test_live_normalizer_without_any_anchor_returns_absent():
    ln = LiveNormalizer()
    h, p = ln.push(frame_to_raw(frame([make_hand((260, 190), 30)], with_pose=False)))
    assert not p.any() and (h == 0).all()
