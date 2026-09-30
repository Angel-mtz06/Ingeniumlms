import numpy as np

from lsm.classifier.boost import SIGN_BOOST, apply_boost, sign_boost
from lsm.sentences import template_sentence, word_of

LABELS = ["NINGUNA", "NO", "HOLA", "MAMA"]


def test_boost_favorece_las_senas_de_la_lista():
    p = np.array([0.30, 0.39, 0.29, 0.02], np.float32)
    q = apply_boost(p, LABELS, {"HOLA": 1.8})
    assert LABELS[int(np.argmax(q))] == "HOLA"
    assert np.isclose(q.sum(), 1.0)


def test_boost_no_inventa_una_sena_que_casi_no_se_vio():
    p = np.array([0.79, 0.15, 0.03, 0.03], np.float32)
    assert LABELS[int(np.argmax(apply_boost(p, LABELS, {"HOLA": 1.8})))] == "NINGUNA"


def test_sin_factores_no_cambia_nada():
    p = np.array([0.4, 0.3, 0.2, 0.1], np.float32)
    assert apply_boost(p, LABELS, {}) is p


def test_lista_por_defecto_y_variable_de_entorno():
    assert sign_boost({}) == SIGN_BOOST
    assert {"HOLA", "GRACIAS", "POR_FAVOR", "AYUDA", "MAMA", "COMO", "ESTAR"} <= set(SIGN_BOOST)
    assert sign_boost({"LSM_SIGN_BOOST": "0"}) == {}
    assert sign_boost({"LSM_SIGN_BOOST": "hola=2, MAMA=1.5,X=abc,Y=99"}) == {"HOLA": 2.0, "MAMA": 1.5}


def test_la_oracion_lleva_acentos():
    assert word_of("MAMA") == "mamá"
    assert word_of("BUENOS_DIAS") == "buenos días"
    assert template_sentence(["HOLA", "MAMA"]) == "Hola mamá."
    assert template_sentence(["HOLA", "A-N-A"]) == "Hola Ana."
