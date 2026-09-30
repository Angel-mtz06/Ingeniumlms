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

export type SpellEnd = { kind: "end"; word: string | null; letters: string[] };
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
    return { kind: "end", word, letters };
  }

  removeLast() { this.letters = this.letters.slice(0, -1); }
  /** Sin avisar al servidor (p. ej. "Borrar todo", que ya lo reinicia). */
  clear() { this.letters = []; this.active = false; this.last = null; }
}
