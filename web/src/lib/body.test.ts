import { describe, expect, it } from "vitest";
import { MAX_HANDS, realHands, type Pt } from "./body";

const W = 640, H = 480;
/** Punto en px → normalizado 0..1. */
const p = (x: number, y: number, visibility = 1): Pt => ({ x: x / W, y: y / H, z: 0, visibility });
/** Mano de 21 puntos alrededor de (x, y) px; `k` escala su tamaño (1 = ~0.4 anchos de hombro, como una real). */
const hand = (x: number, y: number, k = 1): Pt[] =>
  Array.from({ length: 21 }, (_, i) => p(x + (i % 5) * 16 * k, y - Math.floor(i / 5) * 20 * k));

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

  it("descarta una mano del fondo demasiado chica (alguien atrás), aunque una muñeca no se vea", () => {
    const mine = hand(250, 400);
    const behind = hand(560, 250, 0.3);
    expect(realHands([behind, mine], pose([255, 405], null), face(), W, H)).toEqual([mine]);
  });

  it("descarta una mano fuera del alcance de los hombros", () => {
    const mine = hand(250, 400);
    const far = hand(630, 20);
    const wide: Pt[] = pose([255, 405], null);
    wide[11] = p(360, 300);
    wide[12] = p(260, 300); // hombros de 100 px: (630, 20) queda a más de 1.9 anchos
    expect(realHands([far, mine], wide, face(), W, H)).toEqual([mine]);
  });

  it("con más de 2 detecciones se queda con las 2 más cercanas a los brazos", () => {
    const right = hand(250, 400);
    const left = hand(430, 400);
    const extra1 = hand(560, 330);
    const extra2 = hand(80, 330);
    const out = realHands([extra1, right, extra2, left], pose([255, 405], [435, 405]), face(), W, H);
    expect(out).toEqual([right, left]);
  });

  it("sin pose limita a 2 manos", () => {
    const hs = [hand(100, 300), hand(200, 300), hand(300, 300)];
    expect(realHands(hs, null, null, W, H)).toHaveLength(MAX_HANDS);
  });
});
