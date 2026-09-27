"""Glosas canónicas en español y mapeo de ambos datasets."""
from __future__ import annotations

import csv
import unicodedata
from pathlib import Path

_M = """BUENOS_DIAS BUENAS_TARDES BUENAS_NOCHES GRACIAS POR_FAVOR NOS_VEMOS ADIOS
DIA HORA SEMANA MINUTO SEGUNDO
LUNES MARTES MIERCOLES JUEVES VIERNES SABADO DOMINGO
ENERO FEBRERO MARZO ABRIL MAYO JUNIO JULIO AGOSTO SEPTIEMBRE OCTUBRE NOVIEMBRE DICIEMBRE AÑO
CALIFICACION LECCION CUADERNO ESCUELA LAPIZ LEER LSM EXAMEN ESCRIBIR GOMA SACAPUNTAS REGLA COLORES
ABUELA ABUELO ESPOSA ESPOSO FAMILIA HERMANA HERMANO HIJO HIJA HOMBRE MUJER PAPA MAMA NOVIA NOVIO PRIMA PRIMO SOBRINA SOBRINO TIA TIO
CUARTO BAÑO COCINA CAMA CASA ROPERO CORTINA CUNA TECHO PISO ESCALERAS ESCOBA LAMPARA MESA PARED PASILLO VIDRIO VENTANA PUERTA
ADULTO JOVEN NIÑO BEBE FEO BONITO MALA_PERSONA SORDO MUDO FUERTE GORDO ALTO BAJO BUENA_PERSONA CIEGO DEBIL DELGADO
CUCHARA CUCHILLO PLATO VASO COMIDA CENA DESAYUNO TENEDOR SERVILLETA SAL QUIERO_MAS NO_ME_GUSTO
ARETE BLUSA BOTA CAMISA COLLAR GUANTE PANTALON PIJAMA SHORT TRAJE VESTIDO ZAPATOS FALDA ROPA_INTERIOR
BARBA BIGOTE BRAZO BOCA CABELLO CABEZA ROSTRO PIES DIENTES OJOS OREJAS NARIZ OIDO MEJILLA UÑA
AVION BARCO BICICLETA CAMION HELICOPTERO CARRO MOTOCICLETA TAXI TRACTOR TREN METRO AUTOBUS CAMIONETA
AEROPUERTO BIBLIOTECA CENTRO CINE CIRCO EDIFICIO HOSPITAL HOTEL MERCADO MUSEO RESTAURANTE SUPERMERCADO CAFETERIA
YO TU EL ELLA ELLOS ELLAS NOSOTROS NOSOTRAS USTEDES NADIE ALGUIEN
ABRAZAR AMAR ARREGLAR ASUSTAR AYUDA BUSCAR CALLAR CERRAR CREER COMER DETENER DORMIR CACHETADA GUARDAR JUGAR RECOGER LLORAR MENTIR OIR OLVIDAR HACER REIR TIRAR ORDENAR LIMPIAR
ACTOR BOMBEROS DOCTOR MAESTRO MESERO POLICIA PRESIDENTE SECRETARIA CARPINTERO MECANICO ZAPATERO ESTILISTA COSTURERA
AGUASCALIENTES BAJA_CALIFORNIA_NORTE BAJA_CALIFORNIA_SUR CAMPECHE COAHUILA COLIMA CHIAPAS CHIHUAHUA SINALOA DURANGO GUANAJUATO GUERRERO HIDALGO JALISCO MEXICO MICHOACAN MORELOS NAYARIT NUEVO_LEON OAXACA PUEBLA QUERETARO QUINTANA_ROO SAN_LUIS_POTOSI SONORA TABASCO TAMAULIPAS TLAXCALA VERACRUZ YUCATAN ZACATECAS"""
MENDELEY_ES: dict[int, str] = {i + 1: g for i, g in enumerate(_M.split())}

_CATS = ((7, "saludos"), (12, "tiempo"), (19, "dias"), (32, "meses"), (45, "escuela"),
         (66, "familia"), (85, "casa"), (102, "adjetivos"), (114, "cocina"), (128, "ropa"),
         (143, "cuerpo"), (156, "vehiculos"), (169, "lugares"), (180, "pronombres"),
         (205, "verbos"), (218, "profesiones"), (249, "estados"))
GLOSSES_CATEGORY = "salud_y_frecuentes"


def canonical(name: str) -> str:
    s = name.strip().upper().replace(" ", "_").replace("Ñ", "\0")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return s.replace("\0", "Ñ")


def mendeley_category(word_id: int) -> str:
    for last, cat in _CATS:
        if word_id <= last:
            return cat
    raise ValueError(word_id)


def lookup(dataset: str, source_label: str) -> str:
    if dataset == "mendeley":
        return MENDELEY_ES[int(source_label)]
    if dataset == "glosses":
        return canonical(source_label)
    raise ValueError(dataset)


def build_vocab(glosses_names: list[str]) -> list[dict]:
    rows: dict[str, dict] = {}
    for i, g in MENDELEY_ES.items():
        rows[g] = {"gloss": g, "category": mendeley_category(i), "sources": f"mendeley:{i:03d}"}
    for name in glosses_names:
        g = canonical(name)
        if g in rows:
            rows[g]["sources"] += f";glosses:{name}"
        else:
            rows[g] = {"gloss": g, "category": GLOSSES_CATEGORY, "sources": f"glosses:{name}"}
    return list(rows.values())


def write_vocab_csv(rows: list[dict], path: str | Path) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["gloss", "category", "sources"])
        w.writeheader()
        w.writerows(rows)
