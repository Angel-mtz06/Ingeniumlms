"""Calibración por usuario: grados del guante → grados de la cámara (escala del dataset)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lsm.glove.protocol import GloveReading

DEFAULT_CAM_OPEN = 10.0
DEFAULT_CAM_FIST = 150.0
HALL_MIN_DELTA = 150.0
N_CONTACTS = 4


def raw_flexion(r: GloveReading) -> np.ndarray:
    f = (r.pitch[1:6] - r.pitch[0] + 180.0) % 360.0 - 180.0
    f = f.astype(np.float32)
    if not r.imu_ok(0):
        return np.full(5, np.nan, np.float32)
    for i in range(5):
        if not r.imu_ok(i + 1):
            f[i] = np.nan
    return f


@dataclass
class GloveCalibration:
    raw_open: np.ndarray
    raw_fist: np.ndarray
    cam_open: np.ndarray
    cam_fist: np.ndarray
    hall_open_mean: np.ndarray
    hall_open_std: np.ndarray

    def flexion(self, r: GloveReading) -> np.ndarray:
        span = self.raw_fist - self.raw_open
        with np.errstate(divide="ignore", invalid="ignore"):
            out = self.cam_open + (raw_flexion(r) - self.raw_open) * (self.cam_fist - self.cam_open) / span
        out[np.abs(span) < 5.0] = np.nan
        return out.astype(np.float32)

    def contacts(self, r: GloveReading) -> np.ndarray:
        out = np.full(N_CONTACTS, np.nan, np.float32)
        n = min(N_CONTACTS, len(r.hall), len(self.hall_open_mean))
        thr = np.maximum(6.0 * self.hall_open_std[:n], HALL_MIN_DELTA)
        out[:n] = (np.abs(r.hall[:n] - self.hall_open_mean[:n]) > thr).astype(np.float32)
        return out


class Calibrator:
    def __init__(self, min_samples: int = 10):
        self.step: str | None = None
        self.min_samples = min_samples
        self.samples = {s: {"open": [], "fist": []} for s in ("L", "R")}

    def add(self, side: str, reading: GloveReading, cam_flex: np.ndarray | None) -> None:
        if self.step in ("open", "fist") and side in self.samples:
            self.samples[side][self.step].append((reading, cam_flex))

    def _one(self, side: str) -> GloveCalibration | None:
        s = self.samples[side]
        if len(s["open"]) < self.min_samples or len(s["fist"]) < self.min_samples:
            return None

        def med_raw(items):
            return np.nanmedian(np.stack([raw_flexion(r) for r, _ in items]), axis=0)

        def med_cam(items, default):
            cams = [c for _, c in items if c is not None]
            return np.nanmedian(np.stack(cams), axis=0) if cams else np.full(5, default, np.float32)

        halls = np.stack([r.hall for r, _ in s["open"]])
        return GloveCalibration(med_raw(s["open"]), med_raw(s["fist"]),
                                med_cam(s["open"], DEFAULT_CAM_OPEN), med_cam(s["fist"], DEFAULT_CAM_FIST),
                                halls.mean(axis=0), halls.std(axis=0))

    def finish(self) -> dict[str, GloveCalibration | None]:
        return {side: self._one(side) for side in ("L", "R")}
