import { describe, expect, it } from "vitest";
import { buildFrame, FACE_IDX, round1, roundGloveLine, toPixels } from "./frame";

const pt = (x: number, y: number, z = 0) => ({ x, y, z });

describe("frame", () => {
  it("FACE_IDX coincide con el servidor", () => {
    expect(FACE_IDX).toEqual([1, 234, 454, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 61, 291, 0, 17, 13, 14, 78, 308, 152]);
  });

  it("convierte a píxeles con z escalada por el ancho", () => {
    expect(toPixels([pt(0.5, 0.25, 0.1)], 640, 480)).toEqual([[320, 120, 64]]);
  });

  it("arma el payload con cara recortada y pose con visibilidad", () => {
    const face = Array.from({ length: 478 }, (_, i) => pt(i / 1000, 0));
    const pose = Array.from({ length: 33 }, () => ({ ...pt(0.5, 0.5), visibility: 0.9 }));
    const f = buildFrame({ w: 100, h: 100, hands: [Array.from({ length: 21 }, () => pt(0.1, 0.2))], pose, face, gloves: { L: null, R: "D,R,1" } });
    expect(f.type).toBe("frame");
    expect(f.hands[0]).toHaveLength(21);
    expect(f.face).toHaveLength(22);
    expect(f.face![1][0]).toBeCloseTo(23.4);
    expect(f.pose![0]).toEqual([50, 50, 0, 0.9]);
    expect(f.gloves).toEqual({ L: null, R: "D,R,1" });
  });

  it("pose y cara ausentes son null y máximo 2 manos", () => {
    const hand = Array.from({ length: 21 }, () => pt(0, 0));
    const f = buildFrame({ w: 10, h: 10, hands: [hand, hand, hand], pose: null, face: null, gloves: { L: null, R: null } });
    expect(f.hands).toHaveLength(2);
    expect(f.pose).toBeNull();
    expect(f.face).toBeNull();
  });

  it("redondea coordenadas a 1 decimal (x, y, z) y la visibilidad a 2", () => {
    expect(round1(12.345)).toBe(12.3);
    expect(round1(-0.06)).toBe(-0.1);
    expect(toPixels([pt(0.12345, 0.6789, -0.0123)], 640, 480)).toEqual([[79, 325.9, -7.9]]);
    const pose = Array.from({ length: 33 }, () => ({ ...pt(0.33333, 0.66666, 0.01111), visibility: 0.98765 }));
    const f = buildFrame({ w: 640, h: 480, hands: [], pose, face: null, gloves: { L: null, R: null } });
    expect(f.pose![0]).toEqual([213.3, 320, 7.1, 0.99]);
    expect(JSON.stringify(f.pose![0])).toBe("[213.3,320,7.1,0.99]");
  });

  it("redondea los ángulos (pitch/roll) de la línea del guante a 1 decimal y deja lo demás igual", () => {
    const angles = Array.from({ length: 12 }, (_, i) => (i + 0.26).toFixed(2));
    const line = ["D", "R", "42", "1234", ...angles, "0.123", "0.456", "0.789", "512", "600", "63"].join(",");
    const out = roundGloveLine(line);
    expect(out.split(",").slice(4, 16)).toEqual(Array.from({ length: 12 }, (_, i) => String(Math.round((i + 0.26) * 10) / 10)));
    expect(out.split(",").slice(0, 4)).toEqual(["D", "R", "42", "1234"]);
    expect(out.split(",").slice(16)).toEqual(["0.123", "0.456", "0.789", "512", "600", "63"]);
    // Líneas que no son D completas pasan sin cambios.
    expect(roundGloveLine("D,R,1")).toBe("D,R,1");
    const f = buildFrame({ w: 10, h: 10, hands: [], pose: null, face: null, gloves: { L: null, R: line } });
    expect(f.gloves).toEqual({ L: null, R: out });
  });
});
