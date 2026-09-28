import numpy as np
import pytest

from lsm.anchor import EAR_TO_CHEEK, FACEBOX_TO_HEAD, AnchorError, frame_anchor, head_anchor
from lsm.schema import RawSequence
from tests.conftest import raw_with_head


def test_pose_anchor_uses_nose_and_ear_distance():
    # orejas ≈ 0.83 × mejillas: el respaldo por pose se escala a la misma unidad que la malla facial
    raw = raw_with_head(T=3, head=(320, 100), head_w=30)
    cx, cy, s = frame_anchor(raw, 0)
    assert EAR_TO_CHEEK == 1.21
    assert (cx, cy) == pytest.approx((320, 100)) and s == pytest.approx(30 * 1.21)


def test_face_mesh_has_priority_over_pose():
    raw = raw_with_head(T=1, head=(320, 100), head_w=30)
    raw.face[0, 0] = [300, 90, 0]
    raw.face[0, 1] = [280, 95, 0]
    raw.face[0, 2] = [320, 95, 0]
    assert frame_anchor(raw, 0) == pytest.approx((300, 90, 40))


def test_low_visibility_pose_is_ignored_and_face_box_is_used():
    raw = raw_with_head(T=1)
    raw.pose[0, :, 3] = 0.1
    raw.face_box[0] = [100, 50, 140, 100]
    cx, cy, s = frame_anchor(raw, 0)
    assert (cx, cy) == pytest.approx((120, 75)) and s == pytest.approx(40 * FACEBOX_TO_HEAD)


def test_missing_frames_take_median():
    raw = raw_with_head(T=4, head=(320, 100), head_w=30)
    raw.pose[2] = np.nan
    a = head_anchor(raw)
    assert a.shape == (4, 3)
    np.testing.assert_allclose(a[2], [320, 100, 30 * 1.21], rtol=1e-6)


def test_no_anchor_anywhere_raises():
    raw = RawSequence.empty(3, 640, 480)
    with pytest.raises(AnchorError):
        head_anchor(raw)
