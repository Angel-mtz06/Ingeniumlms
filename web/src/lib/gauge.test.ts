import { describe, expect, it } from "vitest";
import { firstTip, gaugeView, ringOffset } from "./gauge";

describe("gaugeView", () => {
  it("sin toma pide hacer la seña", () => {
    expect(gaugeView(null)).toEqual({ kind: "idle", label: "Haz la seña…", detail: "Tu puntaje aparece aquí" });
  });
  it("toma no evaluable: texto, sin cifra", () => {
    const v = gaugeView({ evaluable: false, total: 0, tips: ["Muestra las dos manos."] });
    expect(v.kind).toBe("guide");
    expect(v.label).toBe("No evaluable");
  });
  it("sin referencia nunca muestra cifra", () => {
    expect(gaugeView({ evaluable: true, total: 90, tips: [] }, false).kind).toBe("guide");
  });
  it("redondea, acota y da palabra por nivel", () => {
    expect(gaugeView({ evaluable: true, total: 71.4, tips: [] })).toEqual({
      kind: "score", value: 71, tone: "warn", word: "Casi", label: "71 %", detail: "Casi, 71 de 100",
    });
    const hi = gaugeView({ evaluable: true, total: 120, tips: [] });
    expect(hi.kind === "score" && [hi.value, hi.tone, hi.word]).toEqual([100, "ok", "Bien"]);
    const lo = gaugeView({ evaluable: true, total: Number.NaN, tips: [] });
    expect(lo.kind === "score" && [lo.value, lo.tone, lo.word]).toEqual([0, "bad", "Corrige"]);
  });
  it("los umbrales coinciden con scoreTone (80 / 50)", () => {
    const tone = (t: number) => {
      const v = gaugeView({ evaluable: true, total: t, tips: [] });
      return v.kind === "score" ? v.tone : null;
    };
    expect([tone(80), tone(79.4), tone(50), tone(49.4)]).toEqual(["ok", "warn", "warn", "bad"]);
  });
});

describe("firstTip", () => {
  it("devuelve el primer consejo no vacío", () => {
    expect(firstTip({ evaluable: true, total: 70, tips: ["  ", " Gira la palma. ", "Otro"] })).toBe("Gira la palma.");
    expect(firstTip({ evaluable: true, total: 70, tips: [] })).toBeNull();
    expect(firstTip(null)).toBeNull();
  });
});

describe("ringOffset", () => {
  it("vacío en 0, lleno en 100 y acotado", () => {
    expect(ringOffset(0, 200)).toBe(200);
    expect(ringOffset(100, 200)).toBe(0);
    expect(ringOffset(25, 200)).toBe(150);
    expect(ringOffset(-5, 200)).toBe(200);
    expect(ringOffset(250, 200)).toBe(0);
  });
});
