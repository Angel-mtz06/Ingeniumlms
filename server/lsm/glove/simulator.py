"""Guante simulado para desarrollar y probar sin hardware."""
from __future__ import annotations

import math

HALL_BASE = 2048
HALL_CONTACT = 600


def simulate_line(side: str, seq: int, t_ms: int, flex=(0, 0, 0, 0, 0), contact=(False,) * 4,
                  halls: int = 8, status: int = 0b111111) -> str:
    pitch = [0.0, *[float(f) for f in flex]]
    pr = [f"{p:.1f},0.0" for p in pitch]
    hall = [HALL_BASE + (HALL_CONTACT if i < 4 and contact[i] else 0) for i in range(halls)]
    fields = ["D", side, str(seq), str(t_ms), *pr, "0.0,0.0,0.0", *[str(h) for h in hall], str(status)]
    return ",".join(fields)


def wave_flex(t_ms: int) -> tuple[float, ...]:
    return tuple(45.0 + 40.0 * math.sin(2 * math.pi * (t_ms / 2000.0 + f / 5.0)) for f in range(5))
