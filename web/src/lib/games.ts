/*
 * games.ts: lógica pura de la pestaña Juegos (la pantalla solo dibuja).
 *  - Completa la palabra, con letras: deletrear una palabra letra por letra (reconocedor del alfabeto).
 *  - Completa la palabra, con señas: hacer las señas de una frase (HOLA MAMÁ) una tras otra.
 *  - Carrera: deletrear un texto; cada letra correcta avanza tu carro contra rivales de ritmo fijo.
 */
import { LETTERS } from "./alphabet";
import type { Glosses } from "./protocol";

/** Mayúsculas sin acentos (la Ñ se conserva): así se deletrea en LSM. */
export function spellable(text: string): string {
  return text
    .normalize("NFC")
    .toUpperCase()
    .replace(/Ñ/g, "\0")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\0/g, "Ñ");
}

/** Letras que se deletrean (sin espacios ni signos), en orden. */
export function lettersOf(text: string): string[] {
  const valid = new Set(LETTERS);
  return [...spellable(text)].filter((c) => valid.has(c));
}

/** Palabras para deletrear: fáciles primero; algunas con letras con movimiento (J, Ñ, Q, X, Z). */
export const SPELL_WORDS: { word: string; level: "fácil" | "media" | "difícil" }[] = [
  { word: "SOL", level: "fácil" }, { word: "CASA", level: "fácil" }, { word: "HOLA", level: "fácil" },
  { word: "MAMÁ", level: "fácil" }, { word: "PAPÁ", level: "fácil" }, { word: "LUNA", level: "fácil" },
  { word: "AGUA", level: "fácil" }, { word: "GATO", level: "fácil" }, { word: "MESA", level: "fácil" },
  { word: "CARRERA", level: "media" }, { word: "PERRO", level: "media" }, { word: "ESCUELA", level: "media" },
  { word: "AMIGO", level: "media" }, { word: "FAMILIA", level: "media" }, { word: "DOCTOR", level: "media" },
  { word: "JUGO", level: "difícil" }, { word: "NIÑO", level: "difícil" }, { word: "QUESO", level: "difícil" },
  { word: "ZAPATO", level: "difícil" }, { word: "MÉXICO", level: "difícil" }, { word: "PIZZA", level: "difícil" },
];

/** Frases para hacer con señas de palabras; solo se ofrecen las que el modelo puede reconocer. */
export const SIGN_PHRASES: string[][] = [
  ["HOLA", "MAMA"], ["HOLA", "AMIGO"], ["GRACIAS", "AMIGO"], ["YO", "NECESITAR", "AYUDA"],
  ["DONDE", "BAÑO"], ["YO", "NECESITAR", "DOCTOR"], ["POR_FAVOR", "LLAMAR", "POLICIA"],
  ["LLAMAR", "AMBULANCIA"], ["YO", "TENER", "FIEBRE"], ["MI", "CASA"], ["HOLA", "COMO", "ESTAR"],
  ["YO", "SENTIR", "DOLOR"], ["NOS_VEMOS", "AMIGO"], ["DONDE", "HOSPITAL"], ["YO", "NO_ENTENDER"],
];

/** Frases cuyas señas están todas en el catálogo con referencia (lo que el modelo sabe calificar). */
export function availablePhrases(vocab: { gloss: string; has_reference: boolean }[] | null): string[][] {
  if (!vocab) return [];
  const ok = new Set(vocab.filter((v) => v.has_reference).map((v) => v.gloss));
  return SIGN_PHRASES.filter((p) => p.every((g) => ok.has(g)));
}

/**
 * ¿La toma cuenta como la seña pedida? El modelo acierta más en su primera opción, pero en señas
 * parecidas la correcta suele quedar segunda: se acepta en 1er lugar, o en 2º/3º con ≥ 25 %.
 */
export const WORD_ALT_MIN = 0.25;
export function wordCorrect(recognized: Glosses, target: string): boolean {
  return recognized.slice(0, 3).some(([g, p], i) => g === target && (i === 0 || p >= WORD_ALT_MIN));
}

/* ------------------------------ Carrera ------------------------------ */

export type RaceLevel = "fácil" | "normal" | "difícil" | "experto";
export const RACE_LEVEL_ORDER: RaceLevel[] = ["fácil", "normal", "difícil", "experto"];

export interface RaceLevelConfig {
  label: string;
  /** Una línea para el selector: qué cambia en este nivel. */
  summary: string;
  texts: string[];
  /** Rivales con ritmo fijo, en letras por minuto. */
  rivals: { name: string; lpm: number }[];
  /** Segundos que cuesta saltar una letra. */
  skipPenalty: number;
  /** ¿Se muestra la foto de la letra actual durante la carrera? */
  hint: boolean;
}

/**
 * Niveles de la carrera. Una persona que empieza deletrea ~10–15 letras por minuto frente a la cámara
 * (cada letra se sostiene ~0.8 s y hay que cambiar de forma). Subir de nivel alarga el texto, agrega
 * letras con movimiento (J, Ñ, Q, X, Z), acelera a los rivales, encarece saltar y quita la foto de ayuda.
 */
export const RACE_LEVELS: Record<RaceLevel, RaceLevelConfig> = {
  "fácil": {
    label: "Fácil", summary: "Palabras cortas sin movimiento · rivales lentos · con foto de ayuda",
    texts: ["SOL", "MAMA", "CASA", "LUNA", "GATO", "HOLA", "MESA", "AGUA", "PAPA", "OSO"],
    rivals: [{ name: "Tortuga", lpm: 5 }, { name: "Caracol", lpm: 7 }, { name: "Koala", lpm: 9 }],
    skipPenalty: 2, hint: true,
  },
  normal: {
    label: "Normal", summary: "Dos palabras · rivales a tu ritmo · con foto de ayuda",
    texts: ["HOLA AMIGO", "EL SOL SALE", "MI CASA", "LA LUNA", "UN GATO", "BUEN DIA", "LA MESA", "EL PERRO", "MI FAMILIA", "UNA FLOR"],
    rivals: [{ name: "Burro", lpm: 10 }, { name: "Perro", lpm: 13 }, { name: "Caballo", lpm: 16 }],
    skipPenalty: 3, hint: true,
  },
  "difícil": {
    label: "Difícil", summary: "Con letras de movimiento (J, Ñ, Q, X, Z) · rivales rápidos · sin foto",
    texts: ["JUGO DE UVA", "EL NIÑO", "QUESO RICO", "ZAPATO AZUL", "MEXICO LINDO", "LA PIZZA", "JUAN Y ANA", "QUE BONITO", "TAXI ROJO", "MAÑANA"],
    rivals: [{ name: "Liebre", lpm: 14 }, { name: "Zorro", lpm: 18 }, { name: "Guepardo", lpm: 22 }],
    skipPenalty: 4, hint: false,
  },
  experto: {
    label: "Experto", summary: "Frases largas con movimiento · rivales muy rápidos · sin foto",
    texts: ["EL NIÑO COME QUESO", "JUGO DE MANZANA", "MEXICO ES BONITO", "LA PIZZA ESTA RICA", "ZAPATOS Y JUGUETES", "QUIERO UN TAXI", "LA JIRAFA Y EL ZORRO", "EXAMEN DE MAÑANA"],
    rivals: [{ name: "Halcón", lpm: 20 }, { name: "Cohete", lpm: 25 }, { name: "Rayo", lpm: 30 }],
    skipPenalty: 6, hint: false,
  },
};

/** Todos los textos de la carrera (para pruebas y listas). */
export const RACE_TEXTS: string[] = RACE_LEVEL_ORDER.flatMap((l) => RACE_LEVELS[l].texts);
export const RIVALS: Record<RaceLevel, { name: string; lpm: number }[]> = Object.fromEntries(
  RACE_LEVEL_ORDER.map((l) => [l, RACE_LEVELS[l].rivals]),
) as Record<RaceLevel, { name: string; lpm: number }[]>;

/** Récord por nivel (mejor tiempo en ms), en este navegador. Si el almacenamiento falla, no hay récord. */
const RECORD_KEY = "lsm.games.raceRecord";
export function readRecords(storage: Pick<Storage, "getItem"> | null = safeStorage()): Partial<Record<RaceLevel, number>> {
  try {
    const raw = storage?.getItem(RECORD_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return typeof data === "object" && data ? data : {};
  } catch {
    return {};
  }
}
/** Guarda `ms` si mejora el récord del nivel; devuelve true si fue récord nuevo. */
export function saveRecord(level: RaceLevel, ms: number, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): boolean {
  const records = readRecords(storage);
  const best = records[level];
  if (best !== undefined && best <= ms) return false;
  try {
    storage?.setItem(RECORD_KEY, JSON.stringify({ ...records, [level]: Math.round(ms) }));
  } catch {
    /* sin almacenamiento: el récord dura solo esta carrera */
  }
  return true;
}
function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Avance 0–1 de un rival con `lpm` letras por minuto a los `ms` milisegundos de carrera. */
export function rivalProgress(lpm: number, ms: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (lpm * ms) / 60000 / total));
}

/** Milisegundos que tarda un rival en llegar a la meta. */
export function rivalFinishMs(lpm: number, total: number): number {
  return (total / lpm) * 60000;
}

/** Letras por minuto de la persona. */
export function lettersPerMinute(letters: number, ms: number): number {
  return ms > 0 ? Math.round((letters * 60000) / ms) : 0;
}

export interface Racer { name: string; progress: number; finishMs: number | null; you?: boolean }

/** Orden de llegada: primero quien terminó antes; los que no han terminado, por avance. */
export function standings(racers: Racer[]): Racer[] {
  return [...racers].sort((a, b) =>
    a.finishMs !== null && b.finishMs !== null ? a.finishMs - b.finishMs
      : a.finishMs !== null ? -1 : b.finishMs !== null ? 1 : b.progress - a.progress);
}

/** Elige un elemento distinto del anterior (para "Otra palabra"). */
export function pickOther<T>(list: T[], previous: T | null, random = Math.random): T {
  const pool = list.length > 1 && previous !== null ? list.filter((x) => x !== previous) : list;
  return pool[Math.floor(random() * pool.length) % pool.length];
}
