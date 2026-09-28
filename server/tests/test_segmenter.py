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
