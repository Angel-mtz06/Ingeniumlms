import { alphabetFeatures, predictAlphabet, type AlphabetPrediction } from "./alphabet";
import { outOfFrame } from "./alphabetFeedback";

/** Lado del signante: en la imagen sin espejo, a la izquierda de la cara es su mano DERECHA (sin cara, el centro). */
export type Side = "derecha" | "izquierda";
export function sideOf(hand: number[][], face: number[][] | null | undefined, w: number): Side {
  const cx = face?.[0]?.[0] ?? w / 2;
  return hand[0][0] < cx ? "derecha" : "izquierda";
}

/** Una mano con el centro de la palma por debajo de esta fracción del alto (o saliendo por abajo) está en reposo. */
export const LOW_FRAC = 0.8;
/** Mientras la mano elegida siga siendo buena, se mantiene este tiempo: no brinca de una mano a otra. */
export const KEEP_MS = 700;
/** Letras claras con una sola mano arriba que hacen falta para saber cuál es la dominante. */
export const DOMINANT_MIN = 3;

export type PickReason = "una" | "otra_abajo" | "otra_sin_forma" | "dominante" | "misma" | "mas_forma" | "ninguna";
export interface HandPick {
  hand: number[][] | null;
  /** Predicción de esa mano (ya calculada: no hace falta volver a clasificarla). */
  prediction: AlphabetPrediction | null;
  side: Side | null;
  why: PickReason;
}

type Frame = { hands: number[][][]; w: number; h: number; face?: number[][] | null };
type Cand = { hand: number[][]; side: Side; pred: AlphabetPrediction; shape: number; up: boolean; cy: number };

/**
 * Qué mano hace la letra cuando se ven dos (en Alfabeto e Interpretación el alfabeto es de UNA mano):
 *  1. la otra está abajo (en reposo) o se sale del cuadro → la que está arriba;
 *  2. las dos arriba y solo una tiene forma de letra → esa;
 *  3. las dos con forma → la dominante (la que la persona ha usado para deletrear), si no, la de más forma
 *     (y si se parecen, la que está más arriba).
 * Mientras la mano elegida siga siendo buena se mantiene (KEEP_MS), y cada letra clara hecha con una sola mano
 * enseña cuál es la dominante. `score` cambia qué es "forma" (con letra objetivo: parecido a esa letra).
 */
export class LetterHandPicker {
  private votes: Record<Side, number> = { derecha: 0, izquierda: 0 };
  private last: { side: Side; t: number } | null = null;
  private predict: (hand: number[][]) => AlphabetPrediction;
  constructor(predict: (hand: number[][]) => AlphabetPrediction = predictAlphabet) { this.predict = predict; }
  reset() { this.last = null; }
  /** Lado con el que la persona deletrea (null mientras no haya suficientes letras claras). */
  dominant(): Side | null {
    const { derecha, izquierda } = this.votes;
    if (Math.max(derecha, izquierda) < DOMINANT_MIN || derecha === izquierda) return null;
    return derecha > izquierda ? "derecha" : "izquierda";
  }
  pick(f: Frame, t: number, score?: (p: AlphabetPrediction, hand: number[][]) => number): HandPick {
    const shapeOf = (p: AlphabetPrediction, hand: number[][]) => score ? score(p, hand) : p.pose ? p.pose[1] : 0;
    const valid = f.hands.filter((hand) => alphabetFeatures(hand));
    if (!valid.length) return { hand: null, prediction: null, side: null, why: "ninguna" };
    if (valid.length === 1) {
      const hand = valid[0], pred = this.predict(hand), side = sideOf(hand, f.face, f.w);
      if (pred.pose && f.hands.length === 1) this.learn(side);
      return this.chosen({ hand, side, pred, shape: shapeOf(pred, hand), up: true, cy: 0 }, t, "una");
    }
    const cands: Cand[] = valid.map((hand) => {
      const o = outOfFrame(hand, f.w, f.h);
      const cy = [0, 5, 9, 13, 17].reduce((s, j) => s + hand[j][1], 0) / 5;
      const up = !o.out && cy <= LOW_FRAC * f.h;
      const pred = this.predict(hand);
      return { hand, side: sideOf(hand, f.face, f.w), pred, shape: up ? shapeOf(pred, hand) : 0, up, cy };
    });
    const up = cands.filter((c) => c.up);
    if (!up.length) return { hand: null, prediction: null, side: null, why: "ninguna" };
    if (up.length === 1) {
      if (up[0].pred.pose) this.learn(up[0].side);
      return this.chosen(up[0], t, "otra_abajo");
    }
    const withShape = up.filter((c) => c.shape > 0);
    if (withShape.length === 1) return this.chosen(withShape[0], t, "otra_sin_forma");
    const pool = withShape.length ? withShape : up;
    // La que ya se venía usando, mientras no sea claramente peor.
    const best = Math.max(...pool.map((c) => c.shape));
    const same = this.last && t - this.last.t <= KEEP_MS ? pool.find((c) => c.side === this.last!.side) : undefined;
    if (same && same.shape >= best - 0.15) return this.chosen(same, t, "misma");
    const dom = this.dominant();
    const domC = dom ? pool.find((c) => c.side === dom) : undefined;
    if (domC && domC.shape >= best - 0.15) return this.chosen(domC, t, "dominante");
    // La de más forma; si se parecen, la que está más arriba (el deletreo va a la altura del pecho u hombro).
    const top = pool.filter((c) => c.shape >= best - 0.15).reduce((a, b) => (b.cy < a.cy ? b : a));
    return this.chosen(top, t, "mas_forma");
  }
  private learn(side: Side) {
    // Olvida poco a poco: si la persona cambia de mano, en unas cuantas letras se nota.
    this.votes.derecha *= 0.95; this.votes.izquierda *= 0.95;
    this.votes[side] += 1;
  }
  private chosen(c: Cand, t: number, why: PickReason): HandPick {
    this.last = { side: c.side, t };
    return { hand: c.hand, prediction: c.pred, side: c.side, why };
  }
}
