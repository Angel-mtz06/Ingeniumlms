import numpy as np

from lsm.segmenter import Segmenter
from tests.conftest import make_hand

REST = make_hand(wrist=(0.0, 5.0))


def up(x):
    return make_hand(wrist=(x, 1.0))


def feed(seg, frames, start=0):
    events = []
    for i, h in enumerate(frames):
        hands = np.zeros((2, 21, 3), np.float32)
        present = np.zeros(2, bool)
        if h is not None:
            hands[0], present[0] = h, True
        events += seg.update(start + i, hands, present)
    return events


def test_rest_move_rest_gives_one_segment_then_pause():
    seg = Segmenter()
    frames = [REST] * 5 + [up(0.1 * i) for i in range(20)] + [REST] * 60
    ev = feed(seg, frames)
    ends = [e for e in ev if e.kind == "end"]
    assert len(ends) == 1 and (ends[0].start, ends[0].end) == (5, 24)
    assert [e.kind for e in ev].count("pause") == 1


def test_short_blip_is_discarded():
    ev = feed(Segmenter(), [REST] * 3 + [up(0.0)] * 3 + [REST] * 10)
    assert not [e for e in ev if e.kind == "end"]


def test_stillness_ends_segment_and_needs_motion_to_restart():
    moving = [up(0.2 * i) for i in range(10)]
    still = [up(2.0)] * 30
    # 20 cuadros: un segmento que sigue a una quietud necesita ≥15 para no descartarse como bajada
    again = [up(2.0 + 0.2 * i) for i in range(20)]
    ev = feed(Segmenter(), moving + still + again + [REST] * 10)
    ends = [e for e in ev if e.kind == "end"]
    assert len(ends) == 2
    assert ends[0].start == 0 and ends[1].start >= 40


def test_max_len_forces_cut():
    ev = feed(Segmenter(max_len=30), [up(0.1 * i) for i in range(70)])
    assert len([e for e in ev if e.kind == "end"]) >= 2


def test_absent_hands_count_as_rest():
    ev = feed(Segmenter(), [up(0.1 * i) for i in range(10)] + [None] * 10)
    assert [e.kind for e in ev] == ["end"]


def test_hold_then_lower_gives_single_end():
    # sostén arriba (cierra por quietud) y luego bajada al reposo: la bajada no es una seña nueva
    moving = [up(0.2 * i) for i in range(10)]
    hold = [up(2.0)] * 20
    lower = [make_hand(wrist=(2.0, 1.0 + 4.0 * k / 14)) for k in range(1, 15)]
    ev = feed(Segmenter(), [REST] * 5 + moving + hold + lower + [REST] * 10)
    ends = [e for e in ev if e.kind == "end"]
    assert len(ends) == 1 and ends[0].start == 5


def test_hold_then_lower_does_not_count_as_pending_for_pause():
    moving = [up(0.2 * i) for i in range(10)]
    hold = [up(2.0)] * 20
    lower = [make_hand(wrist=(2.0, 1.0 + 4.0 * k / 14)) for k in range(1, 15)]
    seg = Segmenter()
    feed(seg, [REST] * 5 + moving + hold + lower + [REST] * 3)
    assert seg.pending == 1


def test_post_still_real_sign_is_kept():
    # tras un cierre por quietud, una seña larga que no baja sí se emite
    moving = [up(0.2 * i) for i in range(10)]
    still = [up(2.0)] * 20
    again = [up(2.0 + 0.2 * i) for i in range(20)]
    ev = feed(Segmenter(), moving + still + again + [REST] * 10)
    assert len([e for e in ev if e.kind == "end"]) == 2


def test_practice_raise_pause_then_sign_is_one_segment():
    # modo Práctica: sin cierre por quietud; subir, pausar ≥0.5 s y señar = un solo segmento
    raise_ = [make_hand(wrist=(0.0, 5.0 - 3.5 * k / 8)) for k in range(1, 9)]
    pause = [make_hand(wrist=(0.0, 1.5))] * 20
    sign = [make_hand(wrist=(0.1 * i, 1.5)) for i in range(20)]
    ev = feed(Segmenter(still_frames=10**6, max_len=150), [REST] * 5 + raise_ + pause + sign + [REST] * 10)
    ends = [e for e in ev if e.kind == "end"]
    assert len(ends) == 1
    assert ends[0].start <= 5 + 8 + 20 and ends[0].end >= 5 + 8 + 20 + 19


def test_hand_in_slot_1_is_segmented():
    events = []
    seg = Segmenter()
    frames = [REST] * 5 + [up(0.1 * i) for i in range(20)] + [REST] * 10
    for i, h in enumerate(frames):
        hands = np.zeros((2, 21, 3), np.float32)
        present = np.zeros(2, bool)
        hands[1], present[1] = h, True
        events += seg.update(i, hands, present)
    ends = [e for e in events if e.kind == "end"]
    assert len(ends) == 1 and (ends[0].start, ends[0].end) == (5, 24)


def _post_hold_sign_then_descent(n, low):
    # seña A, sostén (cierra por quietud), seña B de n cuadros a la misma altura y bajada de `low` cuadros
    frames = [REST] * 5 + [make_hand(wrist=(-1.0, 5.0 - 4.0 * k / 8)) for k in range(1, 9)]
    frames += [up(-1.0 + 0.05 * k) for k in range(10)] + [up(-0.5)] * 15
    frames += [up(-0.5 + 0.1 * k) for k in range(1, n + 1)]
    frames += [make_hand(wrist=(1.5, 1.0 + 4.0 * k / low)) for k in range(1, low + 1)]
    return frames + [REST] * 60


def test_post_hold_sign_ending_in_descent_is_kept():
    for n in (15, 30):
        for low in (6, 10):
            ev = feed(Segmenter(max_len=120), _post_hold_sign_then_descent(n, low))
            ends = [e for e in ev if e.kind == "end"]
            assert len(ends) == 2 and ends[1].start == 5 + 8 + 10 + 15, (n, low, ends)


# --- tasa de cuadros: los umbrales están en tiempo (calibrados a 30 fps) ---

def sample(path, fps, duration):
    """Muestrea `path(t) -> (x, y) | None` (t en s) a `fps` cuadros por segundo."""
    n = int(round(duration * fps))
    return [None if (p := path(k / fps)) is None else make_hand(wrist=p) for k in range(n)]


def sign_path(t):
    # reposo 0.3 s, seña que se mueve 1.0 s (3 u/s), vuelta inmediata al reposo
    if 0.3 <= t < 1.3:
        return (-1.0 + 3.0 * (t - 0.3), 1.0)
    return (0.0, 5.0)


def hold_path(t):
    # seña 0.6 s, sostén quieto con deriva lenta (0.9 u/s ≈ 0.03 por cuadro a 30 fps), bajada 0.5 s
    if 0.3 <= t < 0.9:
        return (-1.0 + 3.0 * (t - 0.3), 1.0)
    if 0.9 <= t < 2.4:
        return (0.8 + 0.9 * (t - 0.9), 1.0)
    if 2.4 <= t < 2.9:
        return (2.15, 1.0 + 8.0 * (t - 2.4))
    return (2.15, 5.0)


def ends_in_seconds(path, fps, duration, **kw):
    seg = Segmenter(rate=fps / 30, **kw)
    ev = [e for e in feed(seg, sample(path, fps, duration)) if e.kind == "end"]
    return [(e.start / fps, e.end / fps, e.reason) for e in ev]


def test_default_rate_is_30_fps():
    seg = Segmenter()
    assert seg.rate == 1.0
    assert (seg.frames("rest"), seg.frames("still"), seg.frames("pause")) == (6, 12, 45)
    assert (seg.frames("min_len"), seg.frames("max_len"), seg.frames("post_still")) == (6, 75, 15)
    assert seg.speed_limit() == 0.04


def test_thresholds_scale_with_rate_and_have_minimums():
    seg = Segmenter(max_len=150, rate=0.5)
    # reposo: la racha debe abarcar el mismo tiempo que 6 cuadros a 30 fps (5 intervalos = 0.167 s) → 4
    assert (seg.frames("rest"), seg.frames("still"), seg.frames("pause")) == (4, 6, 22)
    assert (seg.frames("min_len"), seg.frames("max_len"), seg.frames("post_still")) == (3, 75, 8)
    assert seg.speed_limit() == 0.08
    seg.set_rate(0.05)
    assert min(seg.frames(k) for k in ("rest", "still", "pause", "min_len", "max_len", "post_still")) >= 1
    assert seg.frames("rest") >= 2 and seg.frames("min_len") >= 2
    seg.set_rate(2.0)
    assert seg.frames("rest") == 11 and seg.speed_limit() == 0.02


def test_same_motion_at_15_and_30_fps_gives_same_segment_in_seconds():
    a = ends_in_seconds(sign_path, 30, 4.0)
    b = ends_in_seconds(sign_path, 15, 4.0)
    assert len(a) == len(b) == 1
    assert a[0][2] == b[0][2] == "reposo"
    assert abs(a[0][0] - b[0][0]) <= 1 / 15 and abs(a[0][1] - b[0][1]) <= 1 / 15


def test_slow_drift_counts_as_stillness_at_15_fps_too():
    a = ends_in_seconds(hold_path, 30, 5.0)
    b = ends_in_seconds(hold_path, 15, 5.0)
    assert [r for *_, r in a] == [r for *_, r in b] == ["quietud"]  # la bajada tras el sostén no es seña
    assert abs(a[0][1] - b[0][1]) <= 2 / 15


def test_practice_end_arrives_the_same_time_after_rest_at_15_fps():
    for fps in (30, 15):
        seg = Segmenter(still_frames=10**6, max_len=150, rate=fps / 30)
        frames = sample(sign_path, fps, 4.0)
        for i, h in enumerate(frames):
            hands = np.zeros((2, 21, 3), np.float32)
            present = np.zeros(2, bool)
            hands[0], present[0] = h, True
            if seg.update(i, hands, present):
                latency = i / fps - 1.3  # 1.3 s: primer instante en reposo
                break
        assert latency <= 4 / 15 + 1e-6, (fps, latency)  # 0.2 s a 30 fps, 0.27 s a 15 (antes 0.4 s)


def test_brief_dip_mid_sign_does_not_cut_at_15_fps():
    # una bajada/pérdida de 0.13 s a media seña (5 cuadros a 30 fps, 3 a 15) no cierra el segmento
    def dip(t):
        if 0.3 <= t < 1.8:
            return (0.0, 5.0) if 1.0 <= t < 1.14 else (-1.0 + 2.0 * (t - 0.3), 1.0)
        return (0.0, 5.0)
    for fps in (30, 15):
        ends = ends_in_seconds(dip, fps, 4.0)
        assert len(ends) == 1 and ends[0][1] >= 1.7, (fps, ends)


def test_long_sign_is_cut_by_max_len_in_seconds():
    path = lambda t: (-1.0 + 3.0 * t, 1.0) if t < 8 else (0.0, 5.0)  # noqa: E731
    a = ends_in_seconds(path, 30, 9.0, max_len=75)
    b = ends_in_seconds(path, 15, 9.0, max_len=75)
    assert a[0][2] == b[0][2] == "max_len"
    assert abs((a[0][1] - a[0][0]) - (b[0][1] - b[0][0])) <= 1 / 15


def test_trim_descent_threshold_is_per_second():
    from lsm.segmenter import trim_descent
    drift = [1.0 + 0.07 * k for k in range(20)]  # 1.05 u/s a 15 fps: no es una bajada al reposo
    assert trim_descent(drift, rate=0.5) == 19
    assert trim_descent(drift) < 19  # a 30 fps sería 2.1 u/s: sí es bajada


def test_rest_run_is_stable_around_30_fps():
    for fps in (29.0, 29.5, 30.0, 30.6):
        assert Segmenter(rate=fps / 30).frames("rest") == 6, fps
