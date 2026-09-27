import numpy as np

from lsm.glove.calibration import Calibrator, raw_flexion
from lsm.glove.protocol import parse_line
from lsm.glove.simulator import simulate_line


def reading(side="R", flex=(0,) * 5, contact=(False,) * 4, status=0b111111):
    return parse_line(simulate_line(side, 1, 1, flex=flex, contact=contact, status=status))


def test_raw_flexion_wraps_and_masks():
    r = reading(flex=(10, 20, 30, 190, 40), status=0b111011)
    f = raw_flexion(r)
    assert f[0] == 10 and f[2] == 30 and np.isnan(f[1])  # IMU 2 (índice) caído
    assert f[3] == -170


def test_calibration_maps_glove_to_camera_degrees():
    cal = Calibrator()
    cal.step = "open"
    for _ in range(12):
        cal.add("R", reading(flex=(5,) * 5), np.full(5, 12.0))
    cal.step = "fist"
    for _ in range(12):
        cal.add("R", reading(flex=(85,) * 5), np.full(5, 152.0))
    out = cal.finish()
    assert out["L"] is None
    c = out["R"]
    np.testing.assert_allclose(c.flexion(reading(flex=(45,) * 5)), 82.0, atol=1e-3)


def test_calibration_without_camera_uses_defaults():
    cal = Calibrator()
    cal.step = "open"
    for _ in range(10):
        cal.add("L", reading("L", flex=(0,) * 5), None)
    cal.step = "fist"
    for _ in range(10):
        cal.add("L", reading("L", flex=(90,) * 5), None)
    c = cal.finish()["L"]
    np.testing.assert_allclose(c.flexion(reading("L", flex=(90,) * 5)), 150.0, atol=1e-3)


def test_too_few_samples_gives_none():
    cal = Calibrator()
    cal.step = "open"
    cal.add("R", reading(), None)
    assert cal.finish()["R"] is None


def test_contacts_from_hall_baseline():
    cal = Calibrator()
    cal.step = "open"
    for _ in range(10):
        cal.add("R", reading(), None)
    cal.step = "fist"
    for _ in range(10):
        cal.add("R", reading(flex=(90,) * 5), None)
    c = cal.finish()["R"]
    assert c.contacts(reading(contact=(False, True, False, False))).tolist() == [0.0, 1.0, 0.0, 0.0]
