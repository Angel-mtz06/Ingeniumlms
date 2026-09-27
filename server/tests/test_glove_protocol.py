import numpy as np

from lsm.glove.protocol import GloveId, GloveReading, parse_line
from lsm.glove.simulator import simulate_line, wave_flex


def test_parse_id():
    r = parse_line("ID,R,fw=1.0,imus=6,halls=8\n")
    assert isinstance(r, GloveId) and (r.side, r.fw, r.imus, r.halls) == ("R", "1.0", 6, 8)


def test_simulated_line_roundtrip():
    line = simulate_line("L", 7, 1234, flex=(10, 20, 30, 40, 50), contact=(False, True, False, False))
    r = parse_line(line)
    assert isinstance(r, GloveReading)
    assert (r.side, r.seq, r.t_ms) == ("L", 7, 1234)
    np.testing.assert_allclose(r.pitch, [0, 10, 20, 30, 40, 50])
    assert r.hall.shape == (8,) and r.hall[1] > r.hall[0]
    assert all(r.imu_ok(i) for i in range(6))


def test_status_bits():
    r = parse_line(simulate_line("R", 1, 1, status=0b111101))
    assert r.imu_ok(0) and not r.imu_ok(1)


def test_garbage_and_truncated_lines_are_none():
    assert parse_line("") is None
    assert parse_line("hola mundo") is None
    assert parse_line("D,R,1,2,3") is None
    assert parse_line("D,R,x,2" + ",0" * 20) is None


def test_zero_halls_is_valid():
    r = parse_line(simulate_line("R", 1, 1, halls=0))
    assert isinstance(r, GloveReading) and r.hall.shape == (0,)


def test_wave_flex_range():
    for t in range(0, 4000, 250):
        f = wave_flex(t)
        assert len(f) == 5 and all(5 <= v <= 85 for v in f)


def test_non_string_is_none():
    assert parse_line(None) is None
    assert parse_line(123) is None
