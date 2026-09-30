/*
 * translate.ts: estado de la pantalla Interpretación a partir de los mensajes del servidor (función pura).
 * Vive en App para que las etiquetas y la última oración sobrevivan al cambiar de pestaña.
 */
import type { Glosses, ServerMsg } from "./protocol";

export interface ChipItem {
  gloss: string;
  top3: Glosses;
  confident: boolean;
  /** El contexto (la seña anterior) eligió esta glosa en lugar del top-1 del clasificador. */
  reranked?: boolean;
  /** Palabra deletreada con el alfabeto manual (normalmente un nombre propio): fija, sin candidatas. */
  spelled?: boolean;
  /** La persona la validó (tocó una candidata o "Aceptar todas"): va fija a la oración. */
  confirmed?: boolean;
  /**
   * Quitada en "Validar cada seña": se queda a la vista, tachada, hasta formar la oración. El servidor ya no la
   * tiene: su índice en el servidor salta las quitadas (ver `serverIndex`).
   */
  removed?: boolean;
}

export interface Sentence {
  text: string;
  paragraph: string;
  source: "llm" | "template";
  /** Glosas elegidas al formar la oración (pueden diferir de las señas mostradas). */
  glosses: string[];
  /** Índices de `glosses` corregidos por contexto (el LLM o el prior de bigramas eligió otra candidata). */
  corrected: number[];
}

export interface Pausing {
  /** Segundos que faltan para formar la oración. */
  remaining: number;
  /** Pausa total en segundos (LSM_PAUSE_S del servidor). */
  total: number;
}

export interface TranslateState {
  chips: ChipItem[];
  /** Cuenta regresiva de la pausa de oración; null si no corre. */
  pausing: Pausing | null;
  sentence: Sentence | null;
  /**
   * "empty": se pidió formar la oración y no había señas pendientes. "validate": el servidor no la formó porque
   * faltan señas por validar.
   */
  notice: "empty" | "validate" | null;
  awaitingBuild: boolean;
  /**
   * Señas pendientes que el servidor descartó sin formar oración: un `ready` (cambio de modo o
   * reconexión del WebSocket) vacía `pending`. 0 = nada que avisar.
   */
  lost: number;
  /** Se pidió "Borrar todo": el próximo `ready` es la respuesta al `reset` y no es una pérdida. */
  awaitingReset: boolean;
}

export type TranslateAction =
  | { kind: "msg"; msg: ServerMsg }
  | { kind: "confirm"; index: number; gloss: string }
  /** `ghost`: la seña quitada se queda a la vista, tachada ("Validar cada seña"). */
  | { kind: "remove"; index: number; ghost?: boolean }
  /** "Aceptar todas las sugeridas": confirma la glosa mostrada de cada seña viva sin validar. */
  | { kind: "acceptAll" }
  | { kind: "build" }
  | { kind: "clear" }
  | { kind: "dismissLost" };

export const TRANSLATE_INITIAL: TranslateState = { chips: [], pausing: null, sentence: null, notice: null, awaitingBuild: false, lost: 0, awaitingReset: false };

export function translateReducer(s: TranslateState, a: TranslateAction): TranslateState {
  switch (a.kind) {
    case "confirm":
      return {
        ...s,
        // La persona eligió: ya no es una elección del contexto.
        chips: s.chips.map((c, i) => {
          if (i !== a.index) return c;
          const { reranked: _, ...rest } = c;
          return { ...rest, gloss: a.gloss, confident: true, confirmed: true };
        }),
        notice: s.notice === "validate" ? null : s.notice,
      };
    case "remove":
      return {
        ...s,
        chips: a.ghost ? s.chips.map((c, i) => (i === a.index ? { ...c, removed: true } : c)) : s.chips.filter((_, i) => i !== a.index),
        notice: s.notice === "validate" ? null : s.notice,
      };
    case "acceptAll":
      return {
        ...s,
        chips: s.chips.map((c) => {
          if (c.removed || c.confirmed) return c;
          const { reranked: _, ...rest } = c;
          return { ...rest, confident: true, confirmed: true };
        }),
        notice: s.notice === "validate" ? null : s.notice,
      };
    case "build":
      return { ...s, awaitingBuild: true, notice: null };
    case "clear":
      return { ...TRANSLATE_INITIAL, awaitingReset: true };
    case "dismissLost":
      return { ...s, lost: 0 };
    case "msg":
      return onMessage(s, a.msg);
  }
}

function onMessage(s: TranslateState, m: ServerMsg): TranslateState {
  switch (m.type) {
    case "ready": {
      // hello o reset: el servidor vació las señas pendientes (el párrafo solo lo borra "reset").
      // Si había señas y no fue "Borrar todo", se perdieron: se avisa en Traducción.
      const lost = s.awaitingReset ? 0 : s.lost + s.chips.filter((c) => !c.removed).length;
      return { ...s, chips: [], pausing: null, notice: null, awaitingBuild: false, lost, awaitingReset: false };
    }
    case "sign": {
      const item: ChipItem = { gloss: m.gloss, top3: m.top3, confident: m.confident };
      if (m.reranked) item.reranked = true;
      if (m.spelled) item.spelled = true;
      if (m.confirmed) item.confirmed = true;
      // `index` es del servidor: cuenta solo las señas vivas (las quitadas siguen a la vista, pero él ya no las tiene).
      const at = livePositions(s.chips)[m.index];
      const chips = at === undefined ? [...s.chips, item] : s.chips.map((c, i) => (i === at ? item : c));
      return { ...s, chips, notice: null };
    }
    case "pending": {
      // El servidor manda la lista vigente de señas vivas: se conserva el top3 de cada posición y su estado si la
      // glosa coincide; `confirmed` (si viene) es la verdad del servidor. Las quitadas se quedan donde estaban.
      const chips: ChipItem[] = [];
      let j = 0;
      for (const c of s.chips) {
        if (c.removed) {
          chips.push(c);
          continue;
        }
        if (j >= m.glosses.length) continue;
        chips.push(reconcile(c, m.glosses[j], m.confirmed?.[j]));
        j++;
      }
      for (; j < m.glosses.length; j++) chips.push(reconcile(undefined, m.glosses[j], m.confirmed?.[j]));
      const empty = s.awaitingBuild && m.glosses.length === 0;
      const notice = m.awaiting_validation ? "validate" : empty ? "empty" : s.notice;
      const awaitingBuild = empty || m.awaiting_validation ? false : s.awaitingBuild;
      return { ...s, chips, notice, awaitingBuild };
    }
    case "sentence":
      return {
        ...s,
        chips: [],
        pausing: null,
        sentence: { text: m.text, paragraph: m.paragraph, source: m.source, glosses: m.glosses, corrected: validCorrected(m.corrected, m.glosses.length) },
        notice: null,
        awaitingBuild: false,
      };
    case "pausing":
      return { ...s, pausing: m.remaining === null ? null : { remaining: m.remaining, total: m.total } };
    default:
      return s;
  }
}

function reconcile(prev: ChipItem | undefined, gloss: string, confirmed: boolean | undefined): ChipItem {
  const base: ChipItem = prev && prev.gloss === gloss ? prev : { gloss, top3: prev?.top3 ?? [[gloss, 1]], confident: true, ...(prev?.confirmed ? { confirmed: true } : {}) };
  if (confirmed === undefined || !!base.confirmed === confirmed) return base;
  if (confirmed) return { ...base, confirmed: true };
  const { confirmed: _, ...rest } = base;
  return rest;
}

/** Posiciones (en `chips`) de las señas vivas, en orden: la k-ésima es la seña k del servidor. */
function livePositions(chips: readonly ChipItem[]): number[] {
  const out: number[] = [];
  chips.forEach((c, i) => {
    if (!c.removed) out.push(i);
  });
  return out;
}

/** Índice en el servidor de la seña en la posición `i` de `chips` (-1 si está quitada). */
export function serverIndex(chips: readonly ChipItem[], i: number): number {
  if (!chips[i] || chips[i].removed) return -1;
  return chips.slice(0, i).filter((c) => !c.removed).length;
}

export interface Validation {
  /** Señas que irán a la oración (no quitadas). */
  live: number;
  confirmed: number;
  unvalidated: number;
  /** Hay al menos una seña viva y todas están validadas: se puede formar la oración. */
  ready: boolean;
}

/** Resumen de "Validar cada seña". */
export function validation(chips: readonly ChipItem[]): Validation {
  const live = chips.filter((c) => !c.removed);
  const confirmed = live.filter((c) => c.confirmed).length;
  return { live: live.length, confirmed, unvalidated: live.length - confirmed, ready: live.length > 0 && confirmed === live.length };
}

/** Índices corregidos válidos (enteros dentro de `glosses`, sin repetir); [] si el servidor no los manda. */
export function validCorrected(corrected: unknown, n: number): number[] {
  if (!Array.isArray(corrected)) return [];
  return [...new Set(corrected.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
}

/** Texto visible del indicador de pausa ("Formando oración en 3 s… sube las manos para seguir"). */
export function pausingText(remaining: number): string {
  return `Formando oración en ${Math.max(1, Math.ceil(remaining))} s… sube las manos para seguir`;
}

/** Parte de la pausa que falta (1 = recién empieza, 0 = se forma ya), acotada a 0..1. */
export function pausingFraction(p: Pausing): number {
  if (!(p.total > 0)) return 0;
  return Math.min(1, Math.max(0, p.remaining / p.total));
}

/**
 * Mensajes de `events` posteriores a `lastSeen` (por identidad de objeto). Si `lastSeen` ya salió de la
 * ventana de eventos, devuelve todos. `events` va del más viejo al más nuevo.
 */
export function newEvents<T>(events: readonly T[], lastSeen: T | null): T[] {
  if (lastSeen === null) return [...events];
  const i = events.lastIndexOf(lastSeen);
  return i < 0 ? [...events] : events.slice(i + 1);
}

/** Aviso de señas pendientes que se borraron sin formar oración; "" si no hay. */
export function lostMessage(n: number): string {
  if (n <= 0) return "";
  const what = n === 1 ? "Se borró 1 seña" : `Se borraron ${n} señas`;
  const again = n === 1 ? "Vuelve a hacerla si la necesitas." : "Vuelve a hacerlas si las necesitas.";
  return `${what} sin formar oración al cambiar de modo o al reiniciarse la conexión. ${again}`;
}

export type ValidateKeyAction = { kind: "pick"; n: number } | { kind: "remove" } | { kind: "move"; delta: 1 | -1 };

/** Atajos de "Validar cada seña": 1/2/3 eligen la candidata, X o Supr quitan, flechas arriba/abajo cambian de seña. */
export function validateKey(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): ValidateKeyAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key === "1" || e.key === "2" || e.key === "3") return { kind: "pick", n: Number(e.key) - 1 };
  if (e.key === "x" || e.key === "X" || e.key === "Delete") return { kind: "remove" };
  if (e.key === "ArrowDown") return { kind: "move", delta: 1 };
  if (e.key === "ArrowUp") return { kind: "move", delta: -1 };
  return null;
}
