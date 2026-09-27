"""Líneas de texto del guante (spec §7.4)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

N_IMU = 6
BASE_FIELDS = 20  # D, lado, seq, t, 12 (pitch/roll), 3 gyro, status


@dataclass
class GloveReading:
    side: str
    seq: int
    t_ms: int
    pitch: np.ndarray
    roll: np.ndarray
    gyro: np.ndarray
    hall: np.ndarray
    status: int

    def imu_ok(self, i: int) -> bool:
        return bool((self.status >> i) & 1)


@dataclass
class GloveId:
    side: str
    fw: str
    imus: int
    halls: int


def parse_line(line: str) -> GloveReading | GloveId | None:
    if not isinstance(line, str):
        return None
    parts = line.strip().split(",")
    try:
        if parts[0] == "ID" and len(parts) >= 2:
            kv = dict(p.split("=", 1) for p in parts[2:] if "=" in p)
            return GloveId(parts[1], kv.get("fw", ""), int(kv.get("imus", N_IMU)), int(kv.get("halls", 0)))
        if parts[0] == "D" and len(parts) >= BASE_FIELDS and parts[1] in ("L", "R"):
            seq, t_ms = int(parts[2]), int(parts[3])
            pr = np.array([float(x) for x in parts[4:16]], np.float32).reshape(N_IMU, 2)
            gyro = np.array([float(x) for x in parts[16:19]], np.float32)
            hall = np.array([float(x) for x in parts[19:-1]], np.float32)
            return GloveReading(parts[1], seq, t_ms, pr[:, 0].copy(), pr[:, 1].copy(), gyro, hall, int(parts[-1]))
    except ValueError:
        return None
    return None
