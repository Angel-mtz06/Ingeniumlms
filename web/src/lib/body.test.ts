import { describe, expect, it } from "vitest";
import { realHands, type Pt } from "./body";

const W = 640, H = 480;
/** Punto en px → normalizado 0..1. */
const p = (x: number, y: number, visibility = 1): Pt => ({ x: x / W, y: y / H, z: 0, visibility });
/** Mano de 21 puntos alrededor de (x, y) px. */
const hand = (x: number, y: number): Pt[] => Array.from({ length: 21 }, (_, i) => p(x + (i % 5) * 4, y - Math.floor(i / 5) * 6));

/** Pose con hombros en y=300 (ancho 200 px) y la mano de cada brazo donde se indique (null = no se ve). */
function pose(right: [number, number] | null, left: [number, number] | null): Pt[] {
  const out: Pt[] = Array.from({ length: 33 }, () => p(0, 0, 0));
  out[0] = p(320, 120);
  out[11] = p(420, 300);
  out[12] = p(220, 300);
  const arm = (idx: readonly number[], at: [number, number] | null) =>
    idx.forEach((i) => { out[i] = at ? p(at[0], at[1]) : p(0, 0, 0.1); });
  arm([16, 18, 20, 22], right);
  arm([15, 17, 19, 21], left);
  return out;
}

/** Malla de la cara: 478 puntos en un recuadro 270..370 × 60..190 (mejillas 234 y 454 en los lados). */
function face(): Pt[] {
  const out: Pt[] = Array.from({ length: 478 }, (_, i) => p(270 + (i % 11) * 10, 60 + (Math.floor(i / 11) % 14) * 10));
  out[234] = p(270, 130);
  out[454] = p(370, 130);
  return out;
}

describe("realHands", () => {
  it("conserva la mano cuya muñeca coincide con la de la pose", () => {
    const h = hand(250, 350);
    expect(realHands([h], pose([255, 355], null), face(), W, H)).toEqual([h]);
  });

  it("conserva una mano real frente a la cara (la pose la ubica ahí)", () => {
    const h = hand(310, 140);
    expect(realHands([h], pose([315, 150], [450, 460]), face(), W, H)).toEqual([h]);
  });

  it("descarta la 'mano' que es la cara cuando las manos de la pose están abajo", () => {
    const real = hand(250, 400);
    const fake = hand(310, 120);
    expect(realHands([fake, real], pose([255, 405], null), face(), W, H)).toEqual([real]);
  });

  it("descarta una detección lejos de las dos muñecas de la pose aunque no esté en la cara", () => {
    const fake = hand(600, 200);
    expect(realHands([fake], pose([200, 400], [440, 400]), face(), W, H)).toEqual([]);
  });

  it("sin pose no descarta nada", () => {
    const h = hand(310, 120);
    expect(realHands([h], null, face(), W, H)).toEqual([h]);
  });

  it("con una muñeca sin ver y fuera de la cara, conserva la mano (puede ser la que la pose no ubicó)", () => {
    const h = hand(560, 380);
    expect(realHands([h], pose([200, 400], null), face(), W, H)).toEqual([h]);
  });
});
