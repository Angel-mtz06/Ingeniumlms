import { describe, expect, it } from "vitest";
import {
  FpsMeter, cameraErrorMessage, clampScore, fingerLabel, fingerSummary, fingerTone, fitBounds, fiveFingers,
  fold, gloveState, glossLabel, groupVocab, monotonic, percent, referenceBounds, referencePosition,
  REFERENCE_FRAME_MS, REFERENCE_HOLD_MS, scoreTone, wsUrl,
} from "./ui";

describe("dedos", () => {
  it("mapea −1..2 a estados", () => {
    expect([-1, 0, 1, 2, 7].map(fingerTone)).toEqual(["unused", "ok", "warn", "bad", "unused"]);
  });
  it("etiqueta accesible en español", () => {
    expect(fingerLabel(1, 2)).toBe("índice: mal");
    expect(fingerLabel(0, 0)).toBe("pulgar: bien");
    expect(fingerLabel(4, -1)).toBe("meñique: no se usa");
  });
  it("rellena a cinco valores", () => {
    expect(fiveFingers([0, 1])).toEqual([0, 1, -1, -1, -1]);
    expect(fiveFingers(undefined)).toEqual([-1, -1, -1, -1, -1]);
  });
  it("resume los dedos a corregir", () => {
    expect(fingerSummary([0, 0, 0, 0, 0])).toBe("Todos los dedos bien.");
    expect(fingerSummary([0, 2, 1, 0, -1])).toBe("Revisa: índice (mal), medio (casi).");
    expect(fingerSummary([])).toBe("Sin datos de los dedos todavía.");
  });
});

describe("puntajes", () => {
  it("niveles por umbral", () => {
    expect([95, 80, 79.9, 50, 10].map(scoreTone)).toEqual(["ok", "ok", "warn", "warn", "bad"]);
  });
  it("acota a 0..100 y tolera basura", () => {
    expect([120, -3, Number.NaN, "x", 42].map(clampScore)).toEqual([100, 0, 0, 0, 42]);
  });
});

describe("texto", () => {
  it("glosa legible y porcentaje", () => {
    expect(glossLabel("BUENOS_DIAS")).toBe("BUENOS DIAS");
    expect(percent(0.824)).toBe("82 %");
    expect(percent(3)).toBe("100 %");
  });
  it("busca sin acentos", () => {
    expect(fold("  Mañana ÉXITO")).toBe("manana exito");
  });
});

describe("groupVocab", () => {
  const vocab = [
    { gloss: "HOLA", category: "Saludos", has_reference: true },
    { gloss: "ADIÓS", category: "Saludos", has_reference: false },
    { gloss: "MAMÁ", category: "Familia", has_reference: true },
    { gloss: "X", category: "", has_reference: true },
  ];
  it("agrupa por categoría, alfabético y 'Otras' al final", () => {
    const g = groupVocab(vocab, "");
    expect(g.map((x) => x.category)).toEqual(["Familia", "Saludos", "Otras"]);
    expect(g[1].items.map((x) => x.gloss)).toEqual(["ADIÓS", "HOLA"]);
  });
  it("categorías legibles", () => {
    expect(groupVocab([{ gloss: "A", category: "salud_y_frecuentes", has_reference: true }], "frecu")[0].category).toBe("Salud y frecuentes");
  });
  it("filtra por glosa o categoría sin importar acentos", () => {
    expect(groupVocab(vocab, "adios").flatMap((x) => x.items.map((i) => i.gloss))).toEqual(["ADIÓS"]);
    expect(groupVocab(vocab, "famil").map((x) => x.category)).toEqual(["Familia"]);
    expect(groupVocab(vocab, "zzz")).toEqual([]);
  });
});

describe("conexiones", () => {
  it("ws/wss según el protocolo", () => {
    expect(wsUrl({ protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws");
    expect(wsUrl({ protocol: "https:", host: "demo.test" })).toBe("wss://demo.test/ws");
  });
  it("guante sin datos tras 500 ms", () => {
    expect(gloveState(true, 1000, 1400)).toEqual({ connected: true, stale: false });
    expect(gloveState(true, 1000, 1501)).toEqual({ connected: true, stale: true });
    expect(gloveState(false, 0, 99999)).toEqual({ connected: false, stale: false });
  });
  it("mensajes de cámara en español", () => {
    expect(cameraErrorMessage({ name: "NotAllowedError" })).toMatch(/permiso/);
    expect(cameraErrorMessage({ name: "NotFoundError" })).toMatch(/No se encontró/);
    expect(cameraErrorMessage({ name: "NotReadableError" })).toMatch(/en uso/);
    expect(cameraErrorMessage(new Error("x"))).toMatch(/No se pudo abrir/);
  });
});

describe("tiempo", () => {
  it("FpsMeter reporta al cerrar la ventana", () => {
    const m = new FpsMeter(1000);
    expect(m.tick(0)).toBeNull();
    let out: number | null = null;
    for (let i = 1; i <= 30; i++) out = m.tick(i * (1000 / 30)) ?? out;
    expect(out).toBe(30);
  });
  it("marca de tiempo estrictamente creciente", () => {
    expect(monotonic(10, 20)).toBe(20);
    expect(monotonic(10, 10)).toBe(11);
    expect(monotonic(10, 5)).toBe(11);
  });
  it("posición de la referencia con pausa final y velocidad", () => {
    expect(referencePosition(0, 16, 1)).toBe(0);
    expect(referencePosition(REFERENCE_FRAME_MS * 2.5, 16, 1)).toBeCloseTo(2.5);
    expect(referencePosition(REFERENCE_FRAME_MS * 15 + 10, 16, 1)).toBe(15);
    expect(referencePosition(REFERENCE_FRAME_MS * 15 + REFERENCE_HOLD_MS, 16, 1)).toBe(0);
    expect(referencePosition(REFERENCE_FRAME_MS * 2, 16, 0.5)).toBeCloseTo(1);
    expect(referencePosition(123, 1, 1)).toBe(0);
  });
});

describe("encuadre de la referencia", () => {
  it("incluye la cabeza y los puntos presentes, ignora nulos y ausentes", () => {
    const hand = (x: number, y: number) => Array.from({ length: 21 }, () => [x, y, 0]);
    const b = referenceBounds(
      [[hand(2, 3), hand(-9, -9)], [[null, [1, null, 0]] as never, null as never]],
      [[true, false], [true, false]],
    );
    expect(b).toEqual({ minX: -0.5, minY: -0.65, maxX: 2, maxY: 3 });
  });
  it("ajusta conservando proporción y centrando", () => {
    const f = fitBounds({ minX: 0, minY: 0, maxX: 2, maxY: 1 }, 200, 200, 0);
    expect(f.scale).toBe(100);
    expect(f.ox).toBe(0);
    expect(f.oy).toBe(50);
  });
});
