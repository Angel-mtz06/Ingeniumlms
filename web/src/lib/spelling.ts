/*
 * spelling.ts: cuándo se está deletreando en Interpretación (lógica pura; la pantalla solo dibuja).
 * Las letras las reconoce el navegador (el mismo reconocimiento de Alfabeto → Libre); las palabras,
 * el servidor. Al aparecer la primera letra empieza un deletreo (el servidor aparta las señas de esos
 * cuadros); termina cuando pasan SPELL_END_MS sin letra ni movimiento de letra (bajar la mano, hacer
 * otra seña). Con al menos SPELL_MIN_LETTERS letras entra como palabra ("M-A-R-I-O"); con menos,
 * casi siempre era la forma de la mano de una seña, y se descarta.
 */
import { motionBaseLetter } from "./alphabetMotion";

export const SPELL_END_MS = 1200;
export const SPELL_MIN_LETTERS = 2;
/**
 * Q y X: su pose inicial no es una letra por sí sola (no aparece letra mientras se forma), así que el
 * deletreo solo empieza al TERMINAR el movimiento, a veces 1–2 s después de levantar la mano. Mientras
 * tanto el servidor pudo leer esa pose o ese movimiento como una seña.
 */
export const QX_LETTERS = ["Q", "X"];
/** Tras terminar un intento de Q/X, cuánto se recuerda su inicio (la letra llega unos cuadros después). */
export const QX_KEEP_MS = 1500;
/** Antes de que la pose cuente como "lista" pasan READY_HOLD_MS (0.2 s): se mira un poco más atrás. */
export const QX_MARGIN_S = 0.3;
/** Máximo que el servidor acepta mirar atrás (SPELL_LOOKBACK_MAX_S en session.py). */
export const QX_MAX_LOOKBACK_S = 4;

/** `lone`: se reconoció SOLO una Q o X (y no se descartó con "No era deletreo"): el servidor quita las
 *  señas que se confunden con ella en vez de regresarlas. */
export type SpellEnd = { kind: "end"; word: string | null; letters: string[]; lone?: string };
export type SpellEvent = { kind: "start" } | SpellEnd;

/** Agrega `letter` a `letters`: una letra con movimiento reemplaza a la pose con la que empezó (I→J). */
export function appendLetter(letters: string[], letter: string): string[] {
  const start = motionBaseLetter(letter);
  return start && start !== letter && letters.at(-1) === start ? [...letters.slice(0, -1), letter] : [...letters, letter];
}

export class SpellingTracker {
  letters: string[] = [];
  active = false;
  private last: string | null = null;
  private lastSeen = 0;

  /**
   * `stable`: la letra reconocida ahora (null si ninguna); `busy`: se está siguiendo el movimiento de
   * una letra (J, Ñ, Q, X, Z). La misma letra se repite solo si antes dejó de reconocerse.
   */
  push(t: number, stable: string | null, busy = false): SpellEvent[] {
    const events: SpellEvent[] = [];
    if (stable && stable !== this.last) {
      this.letters = appendLetter(this.letters, stable);
      if (!this.active) { this.active = true; events.push({ kind: "start" }); }
    }
    this.last = stable;
    if (stable || busy) this.lastSeen = t;
    if (this.active && t - this.lastSeen > SPELL_END_MS) events.push(this.finish());
    return events;
  }

  /** Termina el deletreo ahora ("Formar oración ahora", salir de la pantalla). */
  finish(keep = true): SpellEnd {
    const letters = this.letters;
    const word = keep && letters.length >= SPELL_MIN_LETTERS ? letters.join("-") : null;
    this.letters = []; this.active = false; this.last = null;
    return keep && letters.length === 1 && QX_LETTERS.includes(letters[0])
      ? { kind: "end", word, letters, lone: letters[0] } : { kind: "end", word, letters };
  }

  removeLast() { this.letters = this.letters.slice(0, -1); }
  /** Sin avisar al servidor (p. ej. "Borrar todo", que ya lo reinicia). */
  clear() { this.letters = []; this.active = false; this.last = null; }
}

/** ¿Hay un intento de Q o X en curso? `active`: letras con intento en curso (p. ej. "Q" o "JX"). */
export const qxInProgress = (active: string) => QX_LETTERS.some((l) => active.includes(l));

/**
 * Intento de Q o X: desde que su pose inicial queda lista hasta que termina (o se abandona). Sirve para
 * que un deletreo que EMPIEZA con Q o X aparte también las señas que el servidor leyó durante el intento.
 */
export class QXAttempt {
  private since: number | null = null;
  private lastOn = -Infinity;

  /** `active`: letras con intento en curso en este momento. Devuelve si hay intento de Q/X. */
  push(t: number, active: string): boolean {
    const on = qxInProgress(active);
    if (on) {
      this.since ??= t;
      this.lastOn = t;
    } else if (t - this.lastOn > QX_KEEP_MS) this.since = null;
    return on;
  }

  /**
   * Segundos que el servidor debe mirar atrás al empezar un deletreo cuya primera letra es `first`:
   * desde que empezó el intento de Q/X (más QX_MARGIN_S). Otra letra o sin intento: undefined (lo normal).
   */
  lookback(t: number, first: string | undefined): number | undefined {
    if (this.since === null || !first || !QX_LETTERS.includes(first)) return undefined;
    return Math.min(QX_MAX_LOOKBACK_S, Math.round(((t - this.since) / 1000 + QX_MARGIN_S) * 10) / 10);
  }

  reset() { this.since = null; this.lastOn = -Infinity; }
}
