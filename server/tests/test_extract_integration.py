import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, "D:/Ingenium/training")
from extract_common import Extractor, face_box_from_skin  # noqa: E402

from lsm.anchor import head_anchor
from lsm.schema import RawSequence

MV = Path("D:/Ingenium/datasets/mendeley_verify/09238")
GV = Path("D:/Ingenium/datasets/lsm_glosses_verify/Mexican Sign Language Glosses/HOLA/HOLA_0.mp4")


@pytest.mark.slow
def test_mendeley_frames_hands_and_face_box():
    files = sorted(MV.glob("*.jpg"))
    raw = RawSequence.empty(len(files), 640, 480)
    ex = Extractor(video=False, pose_model="pose_landmarker_heavy", use_face=False)
    for t, f in enumerate(files):
        bgr = cv2.imread(str(f))
        ex.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), raw, t)
    ex.close()
    hand_frames = (~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1).mean()
    assert hand_frames >= 0.8
    box = face_box_from_skin(cv2.imread(str(files[0])))
    assert not np.isnan(box).any() and 10 < box[2] - box[0] < 120


@pytest.mark.slow
def test_glosses_video_pose_and_anchor():
    cap = cv2.VideoCapture(str(GV))
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(cv2.resize(fr, (960, 544)))
    raw = RawSequence.empty(len(frames), 960, 544, fps=30.0)
    ex = Extractor(video=True)
    for t, fr in enumerate(frames):
        ex.process(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB), raw, t)
    ex.close()
    assert (~np.isnan(raw.pose[:, 0, 0])).mean() >= 0.9
    assert (~np.isnan(raw.face[:, 0, 0])).mean() >= 0.9
    a = head_anchor(raw)
    assert 20 < np.median(a[:, 2]) < 300
