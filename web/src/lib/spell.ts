/*
 * spell.ts: construcción de una palabra deletreada en Interpretación a partir de la letra estable del
 * reconocedor del alfabeto (useAlphabetRecognition en modo libre, el mismo de la pantalla Alfabeto).
 * Función pura, sin React: se prueba con vitest.
 */
import type { FramePayload } from "./protocol";

/** Manos abajo (o fuera de cuadro) este tiempo: la palabra termina. */
export const WORD_END_MS = 1000;
/** Muñeca por debajo de esta fracción del alto de la imagen = mano en reposo. */
export const REST_Y_FRAC = 0.85;
/** Igual que el servidor (add_word acepta 1–24 letras). */
export const MAX_LETTERS = 24;

export class SpellWord {
  private letters: string[] = [];
  /** Letra estable que muestra ahora el reconocedor (null = ninguna: la mano se movió o no se ve). */
  private seen: string | null = null;
  private restSince: number | null = null;

  get word(): string {
    return this.letters.join("");
  }

  /**
   * Letra estable del reconocedor, en cada cambio. Entra una letra en cada flanco de subida (null → L o L → M):
   * para repetir una letra hay que mover la mano entre las dos, así el reconocedor pasa por null.
   * Devuelve true si agregó una letra.
   */
  letter(l: string | null): boolean {
    if (l === this.seen) return false;
    this.seen = l;
    if (l === null || this.letters.length >= MAX_LETTERS) return false;
    this.letters.push(l);
    return true;
  }

  /** Borra la última letra; false si no había. */
  backspace(): boolean {
    return this.letters.pop() !== undefined;
  }

  /** Un cuadro: `up` = alguna mano arriba. True cuando la palabra termina (≥ WORD_END_MS abajo y con letras). */
  frame(t: number, up: boolean): boolean {
    if (up) {
      this.restSince = null;
      return false;
    }
    this.restSince ??= t;
    return this.letters.length > 0 && t - this.restSince >= WORD_END_MS;
  }

  /** Entrega la palabra y empieza una nueva. */
  take(): string {
    const w = this.word;
    this.reset();
    return w;
  }

  reset() {
    this.letters = [];
    this.seen = null;
    this.restSince = null;
  }
}

/** Alguna mano con la muñeca arriba de REST_Y_FRAC del alto (coordenadas en píxeles, como FramePayload). */
export function handsUp(f: FramePayload): boolean {
  return f.hands.some((h) => h[0] !== undefined && h[0][1] < REST_Y_FRAC * f.h);
}

/** "ANGEL" → "A·N·G·E·L" (palabra deletreada en las señas reconocidas). */
export function spelledLabel(word: string): string {
  return [...word].join("·");
}
