import { describe, expect, it } from "vitest";
import type { AlphabetPrediction } from "./alphabet";
import { DOMINANT_MIN, LetterHandPicker, sideOf } from "./letterHand";

const W = 640, H = 480;
/** Mano sintética válida (palma ~40 px) con la muñeca en (x, y). `shape` va en la z de la muñeca: la usa el `predict` falso. */
function hand(x: number, y: number, shape = false): number[][] {
  const pts: number[][] = [[x, y, shape ? 1 : 0]];
  for (let finger = 0; finger < 5; finger++) {
    for (let j = 1; j <= 4; j++) pts.push([x - 24 + finger * 12, y - 10 - j * 12, j * 0.5]);
  }
  return pts;
}
const P = (pose: [string, number] | null): AlphabetPrediction => ({ pose, static: pose, ranking: [], shares: [], letterDistance: [] });
const predict = (h: number[][]) => P(h[0][2] === 1 ? ["A", 0.9] : null);
const face = [[320, 120, 0]];

describe("LetterHandPicker: qué mano hace la letra cuando se ven dos", () => {
  it("con una sola mano, esa", () => {
    const p = new LetterHandPicker(predict).pick({ hands: [hand(200, 300, true)], w: W, h: H, face }, 0);
    expect(p.why).toBe("una");
    expect(p.side).toBe("derecha");
  });
  it("la A con la izquierda y la derecha abajo sin forma: la A (y al revés)", () => {
    const a = hand(450, 300, true), resting = hand(200, 460);
    for (const hands of [[a, resting], [resting, a]]) {
      const p = new LetterHandPicker(predict).pick({ hands, w: W, h: H, face }, 0);
      expect(p.hand).toBe(a);
      expect(p.why).toBe("otra_abajo");
      expect(p.side).toBe("izquierda");
    }
    const b = hand(200, 300, true), low = hand(450, 470);
    expect(new LetterHandPicker(predict).pick({ hands: [low, b], w: W, h: H, face }, 0).hand).toBe(b);
  });
  it("las dos arriba y solo una con forma de letra: esa", () => {
    const a = hand(200, 280, true), open = hand(450, 250);
    const p = new LetterHandPicker(predict).pick({ hands: [open, a], w: W, h: H, face }, 0);
    expect(p.hand).toBe(a);
    expect(p.why).toBe("otra_sin_forma");
  });
  it("las dos abajo: ninguna (no hay letra)", () => {
    const p = new LetterHandPicker(predict).pick({ hands: [hand(200, 470, true), hand(450, 470, true)], w: W, h: H, face }, 0);
    expect(p.hand).toBeNull();
  });
  it("las dos con forma: la dominante que aprendió de las letras con una sola mano", () => {
    const picker = new LetterHandPicker(predict);
    for (let i = 0; i < DOMINANT_MIN + 2; i++) picker.pick({ hands: [hand(450, 300, true)], w: W, h: H, face }, i * 100);
    expect(picker.dominant()).toBe("izquierda");
    const right = hand(200, 300, true), left = hand(450, 300, true);
    const p = picker.pick({ hands: [right, left], w: W, h: H, face }, 5000);
    expect(p.hand).toBe(left);
    expect(p.why).toBe("dominante");
  });
  it("no brinca de mano: mientras la elegida siga bien, se queda", () => {
    const picker = new LetterHandPicker(predict);
    const right = hand(200, 300, true), left = hand(450, 300, true);
    expect(picker.pick({ hands: [right, hand(450, 470)], w: W, h: H, face }, 0).hand).toBe(right);
    expect(picker.pick({ hands: [left, right], w: W, h: H, face }, 100).hand).toBe(right);
  });
  it("sideOf: a la izquierda de la cara en la imagen es la mano derecha", () => {
    expect(sideOf(hand(100, 300), face, W)).toBe("derecha");
    expect(sideOf(hand(500, 300), null, W)).toBe("izquierda");
  });
});
