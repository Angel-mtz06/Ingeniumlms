"""Tema legible de cada glosa para el catálogo (Práctica y Grabar).

El dataset LSM Glosses trae 99 señas sin categoría; aquí se clasifican una por una. También cubre
las palabras que el equipo va a grabar (docs/demo/grabaciones.md). Lo que no esté aquí conserva la
categoría de vocab.csv.
"""
from __future__ import annotations

_THEMES: dict[str, str] = {
    "Saludos y cortesía": """HOLA GRACIAS POR_FAVOR NOS_VEMOS BUENOS_DIAS BUENAS_TARDES BUENAS_NOCHES ADIOS
        DE_NADA PERDON BIENVENIDO""",
    "Personas": """YO TU EL ELLA MI SU NOSOTROS AMIGO SORDO NOMBRE MAMA PAPA HERMANO FAMILIA ESTUDIANTE
        MAESTRO""",
    "Preguntas": "COMO CUANTO DONDE QUE QUIEN POR_QUE",
    "Tiempo": "DIA AHORA ANTES NOCHE TARDE PROXIMO OTRA_VEZ HOY AYER MAÑANA SEMANA",
    "Comunicación": "LSM ESPAÑOL LLAMAR PLATICAR TELEFONO VOZ NO_ENTENDER NO_ESCUCHAR CONOCER",
    "Acciones": """AYUDA COMPRAR CUIDAR ESTAR GUSTAR HABER IR MANEJAR NECESITAR PERDER PRESIONAR ROBAR
        SENTIR TENER CORTAR_ABRIR DESLIZAR_EN_CUERPO DAÑAR NO_PODER COMER BEBER QUERER SABER APRENDER
        ESTUDIAR VIVIR VER HACER""",
    "Respuestas y descripciones": """SI NO NADA NO_NADA MUCHO BUENO MAL AHI ESTO ESPECIAL DIFICIL
        ELEVADO CALIENTE BONITO BIEN FELIZ TRISTE CANSADO""",
    "Cuerpo": "BRAZO BRAZOS CABEZA ROSTRO CUERPO CORAZON ESTOMAGO GARGANTA PIERNA PULMONES ARTICULACIONES",
    "Salud y síntomas": """DOLOR FIEBRE TEMPERATURA TOS GRIPE VOMITO DIARREA MAREADO DESMAYAR ENFERMO
        INFECCION DIABETES CANCER EPILEPSIA EMBARAZADA PALPITACION OPRESION_EN_PECHO PRESION_ARTERIAL
        RESPIRAR TEMBLOR HERIDA GOLPE BRAZO_HINCHADO ROSTRO_HINCHADO CUERPO_CORTADO SENTIDO_DEL_GUSTO
        MEDICINA CITA""",
    "Emergencias": "ACCIDENTE AMBULANCIA URGENCIA EXPLOSION FUEGO QUIMICOS SUCESO",
    "Profesiones": "DOCTOR ENFERMERO POLICIA BOMBEROS",
    "Lugares": "HOSPITAL FARMACIA EDIFICIO CASA BAÑO ESCUELA UNIVERSIDAD CLASE OAXACA",
    "Objetos y vida diaria": "CARRO CARTERA DINERO COMIDA TRABAJO AGUA",
}

THEME_OF: dict[str, str] = {g: theme for theme, words in _THEMES.items() for g in words.split()}
THEMES: tuple[str, ...] = tuple(_THEMES)


def theme_of(gloss: str, fallback: str = "") -> str:
    """Tema de la glosa; si no está clasificada, la categoría que traía (p. ej. de vocab.csv)."""
    return THEME_OF.get(gloss, fallback)
