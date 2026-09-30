import { describe, expect, it } from "vitest";
import { appendLetter, SPELL_END_MS, SpellingTracker } from "./spelling";

describe("deletreo en Interpretación", () => {
  it("empieza con la primera letra y termina tras un rato sin letras; ≥2 letras = palabra", () => {
    const s = new SpellingTracker();
    expect(s.push(0, null)).toEqual([]);
    expect(s.push(100, "A")).toEqual([{ kind: "start" }]);
    s.push(700, "A"); s.push(900, null); s.push(1100, "N"); s.push(1500, null); s.push(1700, "A");
    expect(s.letters).toEqual(["A", "N", "A"]);
    expect(s.push(1700 + SPELL_END_MS - 50, null)).toEqual([]);
    expect(s.push(1700 + SPELL_END_MS + 50, null)).toEqual([{ kind: "end", word: "A-N-A", letters: ["A", "N", "A"] }]);
    expect(s.active).toBe(false);
  });
  it("una sola letra no es palabra (casi siempre era la forma de una seña)", () => {
    const s = new SpellingTracker();
    s.push(0, "B");
    expect(s.push(SPELL_END_MS + 100, null)).toEqual([{ kind: "end", word: null, letters: ["B"] }]);
  });
  it("mientras se sigue el movimiento de una letra, el deletreo no termina", () => {
    const s = new SpellingTracker();
    s.push(0, "I");
    s.push(2000, null, true);
    expect(s.active).toBe(true);
    s.push(2500, "J");
    expect(s.letters).toEqual(["J"]);
  });
  it("una letra con movimiento reemplaza a su pose inicial; la misma letra seguida no se duplica", () => {
    expect(appendLetter(["M", "I"], "J")).toEqual(["M", "J"]);
    expect(appendLetter(["A"], "Q")).toEqual(["A", "Q"]);
    const s = new SpellingTracker();
    s.push(0, "L"); s.push(300, "L"); s.push(600, "L");
    expect(s.letters).toEqual(["L"]);
  });
  it("terminar a mano y descartar", () => {
    const s = new SpellingTracker();
    s.push(0, "S"); s.push(500, null); s.push(600, "I");
    expect(s.finish()).toEqual({ kind: "end", word: "S-I", letters: ["S", "I"] });
    s.push(0, "S"); s.push(500, null); s.push(600, "I");
    expect(s.finish(false).word).toBeNull();
  });
});
