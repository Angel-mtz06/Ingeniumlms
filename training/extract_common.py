"""Envoltorio de MediaPipe Tasks (0.10.14) que llena un RawSequence cuadro por cuadro."""
from __future__ import annotations

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from lsm.paths import MP_MODELS
from lsm.schema import FACE_IDX, RawSequence


class Extractor:
    def __init__(self, video: bool, pose_model: str = "pose_landmarker_full", use_face: bool = True):
        mode = vision.RunningMode.VIDEO if video else vision.RunningMode.IMAGE
        opt = lambda name: BaseOptions(model_asset_path=str(MP_MODELS / f"{name}.task"))
        self.video = video
        self._ts = 0
        self.hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=opt("hand_landmarker"), running_mode=mode, num_hands=2,
            min_hand_detection_confidence=0.3, min_hand_presence_confidence=0.3, min_tracking_confidence=0.3))
        self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=opt(pose_model), running_mode=mode,
            min_pose_detection_confidence=0.3, min_pose_presence_confidence=0.3, min_tracking_confidence=0.3))
        self.face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=opt("face_landmarker"), running_mode=mode, num_faces=1,
            min_face_detection_confidence=0.3)) if use_face else None

    def _detect(self, model, img):
        return model.detect_for_video(img, self._ts) if self.video else model.detect(img)

    def process(self, rgb: np.ndarray, raw: RawSequence, t: int, dt_ms: int = 33) -> None:
        H, W = rgb.shape[:2]
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        if self.video:
            self._ts += dt_ms
        h = self._detect(self.hands, img)
        for k, lm in enumerate(h.hand_landmarks[:2]):
            raw.hands[t, k] = [[q.x * W, q.y * H, q.z * W] for q in lm]
        p = self._detect(self.pose, img)
        if p.pose_landmarks:
            raw.pose[t] = [[q.x * W, q.y * H, q.z * W, q.visibility] for q in p.pose_landmarks[0]]
        if self.face is not None:
            f = self._detect(self.face, img)
            if f.face_landmarks:
                fl = f.face_landmarks[0]
                raw.face[t] = [[fl[i].x * W, fl[i].y * H, fl[i].z * W] for i in FACE_IDX]

    def close(self) -> None:
        for m in (self.hands, self.pose, self.face):
            if m is not None:
                m.close()


def face_box_from_skin(bgr: np.ndarray) -> np.ndarray:
    """Bloque pixelado de la cara (Mendeley): mayor región color piel en la mitad superior.
    Usar en cuadros de reposo (primero y último), cuando las manos están abajo."""
    H, W = bgr.shape[:2]
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    mask = cv2.inRange(ycrcb, (0, 135, 85), (255, 180, 135))
    mask[H // 2:] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    best = None
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 0.001 * H * W or not 0.5 < w / max(h, 1) < 2.0:
            continue
        if best is None or area > best[4]:
            best = (x, y, w, h, area)
    if best is None:
        return np.full(4, np.nan, np.float32)
    x, y, w, h, _ = best
    return np.array([x, y, x + w, y + h], np.float32)
