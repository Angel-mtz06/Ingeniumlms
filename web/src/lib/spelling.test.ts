import { describe, expect, it } from "vitest";
import { appendLetter, QX_KEEP_MS, QX_MAX_LOOKBACK_S, QXAttempt, qxInProgress, SPELL_END_MS, SpellingTracker } from "./spelling";

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
  it("intento de Q o X: solo esas dos cuentan", () => {
    expect(qxInProgress("Q")).toBe(true);
    expect(qxInProgress("JX")).toBe(true);
    expect(qxInProgress("JÑZ")).toBe(false);
    expect(qxInProgress("")).toBe(false);
  });
  it("un deletreo que empieza con Q o X mira atrás desde que empezó el intento", () => {
    const a = new QXAttempt();
    expect(a.push(0, "")).toBe(false);
    expect(a.push(1000, "Q")).toBe(true);
    a.push(2500, "Q");
    expect(a.push(2600, "")).toBe(false); // terminó: la letra llega unos cuadros después
    expect(a.lookback(2700, "Q")).toBe(2); // 1.7 s + 0.3 s de margen
    expect(a.lookback(2700, "X")).toBe(2);
    expect(a.lookback(2700, "A")).toBeUndefined(); // otra letra: lo de siempre
    a.push(2600 + QX_KEEP_MS + 1, "");
    expect(a.lookback(2600 + QX_KEEP_MS + 1, "Q")).toBeUndefined(); // intento viejo: se olvida
  });
  it("el lookback tiene tope y sin intento no hay", () => {
    const a = new QXAttempt();
    expect(a.lookback(0, "Q")).toBeUndefined();
    a.push(0, "X");
    expect(a.lookback(20000, "X")).toBe(QX_MAX_LOOKBACK_S);
    a.reset();
    expect(a.lookback(20000, "X")).toBeUndefined();
  });
  it("formando una Q (sin letra todavía) el deletreo no termina", () => {
    const s = new SpellingTracker();
    s.push(0, "M");
    s.push(1000, null, true); // pose de Q lista: cuenta como ocupado
    s.push(2000, null, true);
    expect(s.active).toBe(true);
    s.push(2200, "Q");
    expect(s.letters).toEqual(["M", "Q"]);
  });
  it("una Q o X sola se avisa (lone); otra letra sola, dos letras o «No era deletreo», no", () => {
    const s = new SpellingTracker();
    s.push(0, "Q");
    expect(s.push(SPELL_END_MS + 100, null)).toEqual([{ kind: "end", word: null, letters: ["Q"], lone: "Q" }]);
    s.push(0, "X");
    expect(s.finish().lone).toBe("X");
    s.push(0, "X");
    expect(s.finish(false).lone).toBeUndefined(); // "No era deletreo": las señas regresan
    s.push(0, "Q"); s.push(300, null); s.push(600, "U");
    expect(s.finish()).toEqual({ kind: "end", word: "Q-U", letters: ["Q", "U"] });
  });
  it("terminar a mano y descartar", () => {
    const s = new SpellingTracker();
    s.push(0, "S"); s.push(500, null); s.push(600, "I");
    expect(s.finish()).toEqual({ kind: "end", word: "S-I", letters: ["S", "I"] });
    s.push(0, "S"); s.push(500, null); s.push(600, "I");
    expect(s.finish(false).word).toBeNull();
  });
});
