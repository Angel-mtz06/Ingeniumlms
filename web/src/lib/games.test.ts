import { describe, expect, it } from "vitest";
import {
  availablePhrases, availableSigns, knownMarks, lettersOf, lettersPerMinute, pickDistinct, pickOther, RACE_LEVEL_ORDER,
  RACE_LEVELS, RACE_TEXTS, readBest, readRecords, recognizedInBank, rivalFinishMs, rivalProgress, saveBest, saveRecord,
  scoreGuess, SIGN_PHRASES, SIMON_LETTERS, simonNext, SPELL_WORDS, spellable, standings, wordCorrect, WORDLE_WORDS,
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

describe("Carrera: niveles de dificultad", () => {
  const motion = (t: string) => lettersOf(t).some((l) => "JÑQXZ".includes(l));
  it("fácil y normal sin letras con movimiento; difícil y experto siempre con alguna", () => {
    for (const l of ["fácil", "normal"] as const) expect(RACE_LEVELS[l].texts.some(motion)).toBe(false);
    for (const l of ["difícil", "experto"] as const) expect(RACE_LEVELS[l].texts.every(motion)).toBe(true);
  });
  it("cada nivel es más difícil que el anterior: texto más largo, rivales más rápidos, saltar cuesta más", () => {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (let i = 1; i < RACE_LEVEL_ORDER.length; i++) {
      const a = RACE_LEVELS[RACE_LEVEL_ORDER[i - 1]], b = RACE_LEVELS[RACE_LEVEL_ORDER[i]];
      expect(avg(b.texts.map((t) => lettersOf(t).length))).toBeGreaterThan(avg(a.texts.map((t) => lettersOf(t).length)));
      expect(avg(b.rivals.map((r) => r.lpm))).toBeGreaterThan(avg(a.rivals.map((r) => r.lpm)));
      expect(b.skipPenalty).toBeGreaterThan(a.skipPenalty);
    }
    expect(RACE_LEVELS["fácil"].hint && !RACE_LEVELS.experto.hint).toBe(true);
  });
  it("récord por nivel: solo se guarda si mejora; sin almacenamiento no falla", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    expect(saveRecord("normal", 40000, storage)).toBe(true);
    expect(saveRecord("normal", 45000, storage)).toBe(false);
    expect(saveRecord("normal", 30000, storage)).toBe(true);
    expect(readRecords(storage)).toEqual({ normal: 30000 });
    expect(readRecords(null)).toEqual({});
    expect(saveRecord("fácil", 1000, null)).toBe(true);
  });
});

describe("Wordle", () => {
  it("verde en su lugar, amarillo en otro lugar, gris si no está", () => {
    expect(scoreGuess([..."GATOS"], [..."GATOS"])).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(scoreGuess([..."SOGAT"], [..."GATOS"])).toEqual(["near", "near", "near", "near", "near"]);
    expect(scoreGuess([..."PLUMA"], [..."GATOS"])).toEqual(["no", "no", "no", "no", "near"]);
  });
  it("letras repetidas: cada letra del secreto cuenta una sola vez", () => {
    expect(scoreGuess([..."PERRO"], [..."ROSAS"])).toEqual(["no", "no", "near", "no", "near"]);
    expect(scoreGuess([..."LLAMA"], [..."SILLA"])).toEqual(["near", "near", "no", "no", "ok"]);
  });
  it("también con señas (secuencia de 3)", () => {
    expect(scoreGuess(["HOLA", "YO", "CASA"], ["YO", "HOLA", "CASA"])).toEqual(["near", "near", "ok"]);
    expect(scoreGuess(["NO", "NO", "NO"], ["NO", "SI", "YO"])).toEqual(["ok", "no", "no"]);
  });
  it("el teclado guarda la mejor marca de cada letra", () => {
    const k = knownMarks([{ guess: [..."AB"], marks: ["near", "no"] }, { guess: [..."BA"], marks: ["no", "ok"] }]);
    expect(k.get("A")).toBe("ok");
    expect(k.get("B")).toBe("no");
  });
  it("todas las palabras secretas tienen 5 letras deletreables", () => {
    for (const w of WORDLE_WORDS) expect(lettersOf(w)).toHaveLength(5);
  });
  it("seña del banco: la más probable del top 3 que esté en el banco", () => {
    expect(recognizedInBank([["NADA", 0.5], ["HOLA", 0.3]], ["HOLA", "YO"])).toBe("HOLA");
    expect(recognizedInBank([["NADA", 0.9], ["HOLA", 0.05]], ["HOLA", "YO"])).toBeNull();
    expect(recognizedInBank([["YO", 0.4]], ["HOLA", "YO"])).toBe("YO");
  });
  it("señas disponibles y elección sin repetir", () => {
    const vocab = [{ gloss: "HOLA", has_reference: true }, { gloss: "YO", has_reference: false }, { gloss: "SI", has_reference: true }];
    expect(availableSigns(vocab)).toEqual(["HOLA", "SI"]);
    const picked = pickDistinct(["A", "B", "C", "D"], 3, () => 0.3);
    expect(new Set(picked).size).toBe(3);
  });
});

describe("Simón dice", () => {
  it("la secuencia crece de uno en uno y no repite el último", () => {
    let seq: string[] = [];
    for (let i = 0; i < 20; i++) {
      const next = simonNext(seq, SIMON_LETTERS);
      expect(next).toHaveLength(seq.length + 1);
      if (seq.length) expect(next.at(-1)).not.toBe(seq.at(-1));
      seq = next;
    }
    expect(SIMON_LETTERS.some((l) => "JÑQXZK".includes(l))).toBe(false);
  });
  it("récord: más alto es mejor (rondas) o más bajo (intentos)", () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    expect(saveBest("simon", 3, true, st)).toBe(true);
    expect(saveBest("simon", 2, true, st)).toBe(false);
    expect(saveBest("wordle", 4, false, st)).toBe(true);
    expect(saveBest("wordle", 3, false, st)).toBe(true);
    expect(readBest("simon", st)).toBe(3);
    expect(readBest("wordle", st)).toBe(3);
    expect(readBest("nada", null)).toBeNull();
  });
});
