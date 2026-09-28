import { describe, expect, it } from "vitest";
import { buildFrame, FACE_IDX, toPixels } from "./frame";

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
});
