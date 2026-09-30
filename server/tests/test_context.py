"""Prior de contexto de glosas (bigramas) y su uso en el reordenamiento y en Viterbi."""
import csv

import pytest

from lsm.context import (CORPUS_PATH, END, LOCK_P, MIN_P, NAME, START, ContextModel, context_weight, load_default,
                         read_corpus, rerank, viterbi)
from lsm.paths import DATASETS, PROCESSED
from lsm.windows import NONE_GLOSS


@pytest.fixture(scope="module")
def model():
    return load_default()


def test_after_hola_prefers_yo_and_como_over_bomberos(model):
    for w in ("YO", "COMO", "AMIGO"):
        assert model.prob(w, "HOLA") > 5 * model.prob("BOMBEROS", "HOLA"), w


def test_sentence_start_prefers_greetings_and_pronouns(model):
    for w in ("HOLA", "YO"):
        assert model.prob(w, START) > 5 * model.prob("ARTICULACIONES", START), w
        assert model.prob(w, None) == model.prob(w, START)


def test_probabilities_sum_to_one_over_vocab():
    m = ContextModel([["HOLA", "YO"], ["HOLA", "COMO", "ESTAR"]], vocab=["BOMBEROS", "GRACIAS"])
    for prev in (START, "HOLA", "DESCONOCIDA"):
        assert sum(m.prob(w, prev) for w in m.vocab) == pytest.approx(1.0, abs=0.05)
        assert m.prob("NUNCA_VISTA", prev) > 0


def test_none_gloss_is_not_part_of_the_prior():
    # classifier_v2 trae NINGUNA entre sus etiquetas: no es una palabra y no le quita masa al vocabulario
    m = ContextModel([["HOLA", "YO"]], vocab=["BOMBEROS", NONE_GLOSS])
    assert NONE_GLOSS not in m.vocab
    assert NONE_GLOSS not in load_default(["HOLA", NONE_GLOSS]).vocab


def test_rerank_prefers_context_within_top_k(model):
    cands = [("BOMBEROS", 0.40), ("YO", 0.30), ("NO", 0.10), ("DIA", 0.02)]
    out, changed = rerank(cands, "HOLA", model, 0.5)
    assert changed and out[0] == ("YO", 0.30)
    assert sorted(out) == sorted(cands)  # mismas candidatas, mismas probabilidades


def test_rerank_ignores_none_gloss(model):
    cands = [("BOMBEROS", 0.40), (NONE_GLOSS, 0.35), ("YO", 0.20)]
    out, changed = rerank(cands, "HOLA", model, 3.0)
    assert changed and out[0] == ("YO", 0.20) and out[-1] == (NONE_GLOSS, 0.35)
    assert rerank([(NONE_GLOSS, 0.5), ("YO", 0.3)], "HOLA", model, 3.0) == ([(NONE_GLOSS, 0.5), ("YO", 0.3)], False)


def test_rerank_never_changes_confident_top1(model):
    cands = [("BOMBEROS", LOCK_P), ("YO", 0.25)]
    assert rerank(cands, "HOLA", model, 3.0) == (cands, False)


def test_rerank_never_picks_below_min_p(model):
    cands = [("BOMBEROS", 0.5), ("YO", MIN_P - 0.001)]
    out, changed = rerank(cands, "HOLA", model, 3.0)
    assert not changed and out == cands
    # justo en el límite sí puede competir
    out, changed = rerank([("BOMBEROS", 0.5), ("YO", MIN_P)], "HOLA", model, 3.0)
    assert changed and out[0][0] == "YO"


def test_weight_zero_or_no_model_changes_nothing(model):
    cands = [("BOMBEROS", 0.40), ("YO", 0.30)]
    assert rerank(cands, "HOLA", model, 0.0) == (cands, False)
    assert rerank(cands, "HOLA", None, 0.5) == (cands, False)
    assert rerank([], "HOLA", model, 0.5) == ([], False)


def test_viterbi_picks_coherent_sequence(model):
    positions = [[("HOLA", 0.36), ("NO", 0.08), ("BOMBEROS", 0.08)],
                 [("BOMBEROS", 0.40), ("YO", 0.35)],
                 [("SORDO", 0.5), ("FUEGO", 0.3)]]
    assert viterbi(positions, model, 0.5) == ["HOLA", "YO", "SORDO"]
    assert viterbi(positions, model, 0.0) == ["HOLA", "BOMBEROS", "SORDO"]
    assert viterbi(positions, None, 0.5) == ["HOLA", "BOMBEROS", "SORDO"]
    assert viterbi([], model, 0.5) == []


def test_context_weight_from_env():
    assert context_weight({}) == 0.5
    assert context_weight({"LSM_CONTEXT_WEIGHT": "0"}) == 0.0
    assert context_weight({"LSM_CONTEXT_WEIGHT": "0.8"}) == 0.8
    assert context_weight({"LSM_CONTEXT_WEIGHT": "x"}) == 0.5
    assert context_weight({"LSM_CONTEXT_WEIGHT": "-2"}) == 0.0
    assert context_weight({"LSM_CONTEXT_WEIGHT": "99"}) == 3.0
    assert context_weight({"LSM_CONTEXT_WEIGHT": "nan"}) == 0.5


def test_corpus_size_and_tokens():
    lines = read_corpus()
    assert 200 <= len(lines) <= 400
    assert all(START not in l and END not in l and NONE_GLOSS not in l for l in lines)
    assert sum(l[0] == "HOLA" for l in lines) >= 15


@pytest.mark.parametrize("vocab_csv", [PROCESSED / "vocab.csv", DATASETS / "processed_classifier_v2" / "vocab.csv"])
def test_corpus_glosses_exist_in_real_vocab(vocab_csv):
    if not vocab_csv.exists():
        pytest.skip(f"falta {vocab_csv}")
    vocab = {r["gloss"] for r in csv.DictReader(open(vocab_csv, encoding="utf-8"))}
    unknown = {t for l in read_corpus(CORPUS_PATH) for t in l} - vocab - {NAME, START}
    assert not unknown, sorted(unknown)


def test_viterbi_spelled_position_counts_as_name(model):
    # tras HOLA YO <NOMBRE> se espera SORDO más que FUEGO; el nombre deletreado se queda tal cual
    positions = [[("HOLA", 1.0)], [("YO", 1.0)], [("ANGEL", 1.0)], [("FUEGO", 0.4), ("SORDO", 0.35)]]
    assert viterbi(positions, model, 0.5, spelled={2}) == ["HOLA", "YO", "ANGEL", "SORDO"]
