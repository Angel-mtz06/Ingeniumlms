import { describe, expect, it } from "vitest";
import { freeGauge, motionGauge, staticGauge } from "./alphabetView";
import type { Feedback } from "./alphabetFeedback";

const fb = (x: Partial<Feedback>): Feedback => ({ correct: false, type: "finger", issue: "should_extend", message: "Extiende el dedo índice.", ...x });

describe("corner gauge for the alphabet (same component as Práctica)", () => {
  it("static: waiting, capture problem, suggestion and correct", () => {
    expect(staticGauge(null, 0, 0).kind).toBe("idle");
    expect(staticGauge(fb({ type: "capture", issue: "out_of_frame" }), 0, 0)).toEqual({ kind: "guide", label: "Ajusta la mano", detail: "Mano fuera del cuadro" });
    const tip = staticGauge(fb({}), 0.3, 0);
    expect(tip.kind === "score" && tip.tone).toBe("bad");
    const ok = staticGauge(fb({ correct: true, type: "ok", issue: "ok" }), 0.92, 1);
    expect(ok.kind === "score" && [ok.value, ok.tone, ok.caption]).toEqual([92, "ok", "¡Correcto!"]);
  });
  it("motion: start pose, ready, live progress, result", () => {
    expect(motionGauge({ phase: "pose", progress: 0, elapsed: 0, result: null }, fb({}), false).label).toBe("Posición inicial");
    expect(motionGauge({ phase: "ready", progress: 0, elapsed: 0, result: null }, null, false).label).toBe("¡Listo!");
    const moving = motionGauge({ phase: "moving", progress: 0.6, elapsed: 500, result: null }, null, false);
    expect(moving.kind === "score" && [moving.value, moving.caption]).toEqual([60, "del recorrido"]);
    const r = { prediction: null, issue: "too_fast" as const, reason: "", frames: 20, duration: 600, travel: 1, activeFrames: 4, activeMs: 130 };
    expect(motionGauge({ phase: "result", progress: 1, elapsed: 0, result: r }, null, false)).toEqual({ kind: "guide", label: "Corrige", detail: "Demasiado rápido" });
  });
  it("free: shows the stable letter, never a correction", () => {
    const g = freeGauge(["M", 0.87], null);
    expect(g.kind === "score" && [g.word, g.value]).toEqual(["M", 87]);
    expect(freeGauge(null, null).kind).toBe("idle");
  });
});
