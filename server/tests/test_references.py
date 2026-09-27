import numpy as np

from lsm.evaluator.references import (build_reference, dtw, load_references, palm_normal, sample_stats,
                                       save_references, thumb_contacts)
from lsm.normalize import NormSequence
from tests.conftest import make_hand


def seq(flex=(0, 90, 90, 90, 90), x0=0.0, signer="m01", T=12):
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    for t in range(T):
        hands[t, 0] = make_hand(wrist=(x0 + 0.1 * t, 1.0), flex=flex)
        present[t, 0] = True
    return NormSequence(hands, present, f"{signer}_X", signer)


def test_palm_normal_is_unit_and_contacts_shape():
    h = make_hand()
    assert abs(np.linalg.norm(palm_normal(h)) - 1) < 1e-5 or np.linalg.norm(palm_normal(h)) == 0
    assert thumb_contacts(h).shape == (4,)


def test_sample_stats_flex_and_dom():
    st = sample_stats(seq())
    assert st["dom"] == 0 and st["present_frac"][0] == 1.0 and np.isnan(st["flex"][1]).all()
    np.testing.assert_allclose(st["flex"][0], [0, 90, 90, 90, 90], atol=1e-3)
    assert st["traj"].shape == (16, 3) and st["path_len"] > 0


def test_dtw_zero_for_identical_and_positive_for_shift():
    a = np.linspace(0, 1, 16)[:, None] * np.ones((1, 3))
    assert dtw(a, a) == 0 and dtw(a, a + 1) > 0.5


def test_build_reference_prefers_deaf_signer_and_uses_floors():
    norms = [seq(signer="m01"), seq(signer="g11", x0=0.05), seq(signer="g00")]
    ref = build_reference("HOLA", norms)
    assert ref.example_id == "g11_X" and ref.n_samples == 3
    assert ref.slots_used.tolist() == [True, False]
    np.testing.assert_allclose(ref.flex_mean[0], [0, 90, 90, 90, 90], atol=1e-3)
    assert ref.example_hands.shape == (16, 2, 21, 3)


def test_references_json_roundtrip(tmp_path):
    ref = build_reference("HOLA", [seq(), seq(signer="g00")])
    p = tmp_path / "r.json"
    save_references({"HOLA": ref}, p)
    back = load_references(p)["HOLA"]
    np.testing.assert_allclose(back.flex_mean[0], ref.flex_mean[0])
    assert np.isnan(back.flex_mean[1]).all() and back.dom == ref.dom
    assert "NaN" not in p.read_text(encoding="utf-8")
