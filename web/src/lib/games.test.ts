import { describe, expect, it } from "vitest";
import {
  availablePhrases, lettersOf, lettersPerMinute, pickOther, RACE_TEXTS, rivalFinishMs, rivalProgress, SIGN_PHRASES,
  SPELL_WORDS, spellable, standings, wordCorrect,
} from "./games";
import { LETTERS } from "./alphabet";

describe("Completa la palabra: letras", () => {
  it("se deletrea sin acentos, con Ñ, y sin espacios", () => {
    expect(spellable("mamá")).toBe("MAMA");
    expect(lettersOf("Niño")).toEqual(["N", "I", "Ñ", "O"]);
    expect(lettersOf("México")).toEqual(["M", "E", "X", "I", "C", "O"]);
    expect(lettersOf("el sol")).toEqual(["E", "L", "S", "O", "L"]);
  });
  it("todas las palabras y textos se pueden deletrear con el alfabeto", () => {
    for (const { word } of SPELL_WORDS) expect(lettersOf(word).length).toBe(spellable(word).length);
    for (const t of RACE_TEXTS) expect(lettersOf(t).every((l) => LETTERS.includes(l))).toBe(true);
  });
});

describe("Completa la palabra: señas", () => {
  it("solo ofrece frases con todas sus señas en el catálogo", () => {
    const vocab = ["HOLA", "AMIGO", "GRACIAS"].map((gloss) => ({ gloss, has_reference: true }));
    expect(availablePhrases(vocab)).toEqual([["HOLA", "AMIGO"], ["GRACIAS", "AMIGO"]]);
    expect(availablePhrases([{ gloss: "HOLA", has_reference: false }, { gloss: "MAMA", has_reference: true }])).toEqual([]);
    expect(availablePhrases(null)).toEqual([]);
    expect(SIGN_PHRASES.every((p) => p.length >= 1)).toBe(true);
  });
  it("acierto: primera opción, o segunda/tercera con al menos 25 %", () => {
    expect(wordCorrect([["HOLA", 0.6], ["NO", 0.2]], "HOLA")).toBe(true);
    expect(wordCorrect([["NO", 0.5], ["HOLA", 0.3]], "HOLA")).toBe(true);
    expect(wordCorrect([["NO", 0.8], ["HOLA", 0.1]], "HOLA")).toBe(false);
    expect(wordCorrect([], "HOLA")).toBe(false);
  });
});

describe("Carrera", () => {
  it("un rival avanza a ritmo fijo y llega a la meta a su tiempo", () => {
    expect(rivalProgress(12, 0, 10)).toBe(0);
    expect(rivalProgress(12, 25000, 10)).toBeCloseTo(0.5);
    expect(rivalProgress(12, 90000, 10)).toBe(1);
    expect(rivalFinishMs(12, 10)).toBe(50000);
    expect(lettersPerMinute(10, 40000)).toBe(15);
  });
  it("posiciones: quien terminó antes, luego por avance", () => {
    const order = standings([
      { name: "a", progress: 0.4, finishMs: null }, { name: "b", progress: 1, finishMs: 30000 },
      { name: "c", progress: 1, finishMs: 20000 }, { name: "d", progress: 0.7, finishMs: null },
    ]).map((r) => r.name);
    expect(order).toEqual(["c", "b", "d", "a"]);
  });
  it("otra palabra no repite la anterior", () => {
    expect(pickOther(["A", "B"], "A", () => 0)).toBe("B");
    expect(pickOther(["A"], "A", () => 0)).toBe("A");
  });
});
