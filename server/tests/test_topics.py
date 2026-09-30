"""Temas de conversación de Interpretación: glosas que reciben un empujón en el reordenamiento."""
import csv
import math

import pytest

from lsm.context import LOCK_P, MIN_P, load_default, rerank, viterbi
from lsm.paths import DATASETS, PROCESSED
from lsm.themes import THEME_OF
from lsm.topics import CORE, DEFAULT_BOOST, TOPICS, topic_boost, topic_glosses
from lsm.windows import NONE_GLOSS


def themed(*themes):
    return {g for g, t in THEME_OF.items() if t in themes}


def test_topics_are_built_from_themes_plus_core():
    assert set(TOPICS) == {"saludos", "salud", "emergencias"}
    assert topic_glosses("saludos") == frozenset(themed("Saludos y cortesía", "Personas", "Preguntas",
                                                        "Respuestas y descripciones", "Comunicación", "Tiempo") | CORE)
    assert topic_glosses("salud") == frozenset(themed("Salud y síntomas", "Cuerpo", "Profesiones", "Lugares",
                                                     "Acciones", "Tiempo") | CORE)
    assert topic_glosses("emergencias") == frozenset(themed("Emergencias", "Profesiones", "Lugares", "Acciones",
                                                           "Salud y síntomas") | CORE)
    assert {"HOLA", "AMIGO", "COMO"} <= topic_glosses("saludos") and "BOMBEROS" not in topic_glosses("saludos")
    assert {"DOLOR", "DOCTOR", "HOSPITAL"} <= topic_glosses("salud") and "HOLA" not in topic_glosses("salud")
    assert {"FUEGO", "BOMBEROS", "AMBULANCIA"} <= topic_glosses("emergencias")


def test_core_words_in_every_topic_and_todo_is_empty():
    assert CORE == {"YO", "MI", "SU", "EL", "SI", "NO", "COMO", "DONDE", "CUANTO", "AHORA", "AYUDA", "NECESITAR",
                    "TENER", "IR", "POR_FAVOR", "GRACIAS"}
    for t in TOPICS:
        assert CORE <= topic_glosses(t), t
    assert topic_glosses("todo") == frozenset()
    assert topic_glosses("otra") == frozenset()
    assert NONE_GLOSS not in set().union(*(topic_glosses(t) for t in TOPICS))


def test_topic_boost_from_env():
    assert topic_boost({}) == DEFAULT_BOOST == 3.0
    assert topic_boost({"LSM_TOPIC_BOOST": "5"}) == 5.0
    assert topic_boost({"LSM_TOPIC_BOOST": "1"}) == 1.0  # 1 = sin empujón
    assert topic_boost({"LSM_TOPIC_BOOST": "0.2"}) == 1.0  # nunca castiga al tema
    assert topic_boost({"LSM_TOPIC_BOOST": "999"}) == 20.0
    assert topic_boost({"LSM_TOPIC_BOOST": "x"}) == 3.0
    assert topic_boost({"LSM_TOPIC_BOOST": "nan"}) == 3.0


def test_rerank_boosts_topic_glosses_without_context():
    cands = [("AMIGO", 0.40), ("DOLOR", 0.30), ("HOLA", 0.10)]
    out, changed = rerank(cands, None, None, 0.0, favored=topic_glosses("salud"), boost=3.0)
    assert changed and out[0] == ("DOLOR", 0.30) and sorted(out) == sorted(cands)
    # log(3) ≈ 1.10 no alcanza para remontar 0.40 frente a 0.10 (log 4 ≈ 1.39)
    out, changed = rerank([("AMIGO", 0.40), ("DOLOR", 0.10)], None, None, 0.0, favored=topic_glosses("salud"),
                          boost=3.0)
    assert not changed


def test_topic_respects_lock_min_p_and_none():
    fav = topic_glosses("salud")
    assert rerank([("AMIGO", LOCK_P), ("DOLOR", 0.29)], None, None, 0.0, favored=fav, boost=20.0)[1] is False
    assert rerank([("AMIGO", 0.5), ("DOLOR", MIN_P - 0.001)], None, None, 0.0, favored=fav, boost=20.0)[1] is False
    out, changed = rerank([("AMIGO", 0.4), (NONE_GLOSS, 0.3)], None, None, 0.0, favored=fav | {NONE_GLOSS}, boost=20.0)
    assert not changed
    # sin tema o con boost 1 no cambia nada
    cands = [("AMIGO", 0.40), ("DOLOR", 0.30)]
    assert rerank(cands, None, None, 0.0, favored=frozenset(), boost=3.0) == (cands, False)
    assert rerank(cands, None, None, 0.0, favored=fav, boost=1.0) == (cands, False)


def test_topic_adds_log_boost_to_context_score():
    model = load_default()
    cands = [("AMIGO", 0.40), ("DOLOR", 0.30)]
    # tras HOLA el contexto prefiere AMIGO; el tema salud empuja DOLOR con log(boost)
    assert rerank(cands, "HOLA", model, 0.5)[0][0][0] == "AMIGO"
    lp = lambda g, p: math.log(p) + 0.5 * model.logp(g, "HOLA")  # noqa: E731
    need = math.exp(lp("AMIGO", 0.40) - lp("DOLOR", 0.30))
    assert rerank(cands, "HOLA", model, 0.5, favored=topic_glosses("salud"), boost=need * 1.05)[0][0][0] == "DOLOR"
    assert rerank(cands, "HOLA", model, 0.5, favored=topic_glosses("salud"), boost=need * 0.95)[0][0][0] == "AMIGO"


def test_viterbi_uses_topic_boost():
    positions = [[("AMIGO", 0.40), ("DOLOR", 0.30)]]
    assert viterbi(positions, None, 0.0) == ["AMIGO"]
    assert viterbi(positions, None, 0.0, favored=topic_glosses("salud"), boost=3.0) == ["DOLOR"]


@pytest.mark.parametrize("vocab_csv", [PROCESSED / "vocab.csv", DATASETS / "processed_classifier_v2" / "vocab.csv"])
def test_core_words_exist_in_real_vocab(vocab_csv):
    if not vocab_csv.exists():
        pytest.skip(f"falta {vocab_csv}")
    vocab = {r["gloss"] for r in csv.DictReader(open(vocab_csv, encoding="utf-8"))}
    assert sorted(CORE - vocab) == []
