/*
 * translate.ts: estado de la pantalla Traducción a partir de los mensajes del servidor (función pura).
 * Vive en App para que las etiquetas y la última oración sobrevivan al cambiar de pestaña.
 */
import type { Glosses, ServerMsg } from "./protocol";

export interface ChipItem {
  gloss: string;
  top3: Glosses;
  confident: boolean;
}

export interface Sentence {
  text: string;
  paragraph: string;
  source: "llm" | "template";
  glosses: string[];
}

export interface TranslateState {
  chips: ChipItem[];
  sentence: Sentence | null;
  /** "empty": se pidió formar la oración y no había señas pendientes. */
  notice: "empty" | null;
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
  | { kind: "remove"; index: number }
  | { kind: "build" }
  | { kind: "clear" }
  | { kind: "dismissLost" };

export const TRANSLATE_INITIAL: TranslateState = { chips: [], sentence: null, notice: null, awaitingBuild: false, lost: 0, awaitingReset: false };

export function translateReducer(s: TranslateState, a: TranslateAction): TranslateState {
  switch (a.kind) {
    case "confirm":
      return {
        ...s,
        chips: s.chips.map((c, i) => (i === a.index ? { ...c, gloss: a.gloss, confident: true } : c)),
      };
    case "remove":
      return { ...s, chips: s.chips.filter((_, i) => i !== a.index) };
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
      const lost = s.awaitingReset ? 0 : s.lost + s.chips.length;
      return { ...s, chips: [], notice: null, awaitingBuild: false, lost, awaitingReset: false };
    }
    case "sign": {
      const item: ChipItem = { gloss: m.gloss, top3: m.top3, confident: m.confident };
      const chips = m.index <= s.chips.length ? [...s.chips.slice(0, m.index), item, ...s.chips.slice(m.index + 1)] : [...s.chips, item];
      return { ...s, chips, notice: null };
    }
    case "pending": {
      // El servidor manda la lista vigente: se conserva el top3 de cada posición y su estado si la glosa coincide.
      const chips = m.glosses.map((g, i): ChipItem => {
        const prev = s.chips[i];
        if (prev && prev.gloss === g) return prev;
        return { gloss: g, top3: prev?.top3 ?? [[g, 1]], confident: true };
      });
      const empty = s.awaitingBuild && m.glosses.length === 0;
      return { ...s, chips, notice: empty ? "empty" : s.notice, awaitingBuild: empty ? false : s.awaitingBuild };
    }
    case "sentence":
      return {
        ...s,
        chips: [],
        sentence: { text: m.text, paragraph: m.paragraph, source: m.source, glosses: m.glosses },
        notice: null,
        awaitingBuild: false,
      };
    default:
      return s;
  }
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
