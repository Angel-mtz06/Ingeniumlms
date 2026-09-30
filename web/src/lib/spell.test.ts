import { describe, expect, it } from "vitest";
import type { FramePayload } from "./protocol";
import samples from "../data/alphabet_samples.json";
import { predictAlphabet, StableLetter } from "./alphabet";
import { handsUp, MAX_LETTERS, SpellWord, spelledLabel, WORD_END_MS } from "./spell";

const frame = (hands: number[][][], h = 480): FramePayload => ({ type: "frame", w: 640, h, hands, pose: null, face: null, gloves: { L: null, R: null } });
const hand = (y: number) => [[320, y, 0], ...Array.from({ length: 20 }, () => [320, y - 50, 0])];

describe("SpellWord", () => {
  it("agrega una letra en cada flanco de subida del reconocedor", () => {
    const w = new SpellWord();
    for (const l of [null, "A", "A", "A", null, "N", "N", "G", "E", "E", "L"]) w.letter(l);
    expect(w.word).toBe("ANGEL");
  });

  it("para repetir una letra hay que mover la mano entre las dos (el reconocedor pasa por null)", () => {
    const w = new SpellWord();
    for (const l of ["L", "L", "L"]) w.letter(l);
    expect(w.word).toBe("L");
    w.letter(null);
    w.letter("L");
    expect(w.word).toBe("LL");
  });

  it("borrar quita la última letra; la letra sostenida no vuelve a entrar sin mover la mano", () => {
    const w = new SpellWord();
    for (const l of ["A", "N", "A"]) w.letter(l);
    expect(w.backspace()).toBe(true);
    expect(w.word).toBe("AN");
    w.letter("A");
    expect(w.word).toBe("AN");
    w.backspace();
    w.backspace();
    expect(w.backspace()).toBe(false);
    expect(w.word).toBe("");
  });

  it("termina al bajar las manos ~1 s, solo si hay letras; take() la entrega y reinicia", () => {
    const w = new SpellWord();
    expect(w.frame(0, false)).toBe(false);
    expect(w.frame(2000, false)).toBe(false); // sin letras no hay palabra que terminar
    w.letter("A");
    expect(w.frame(2100, true)).toBe(false);
    expect(w.frame(2200, false)).toBe(false);
    expect(w.frame(2200 + WORD_END_MS - 1, false)).toBe(false);
    w.frame(2300, true); // subir la mano reinicia la espera
    expect(w.frame(2301, false)).toBe(false);
    expect(w.frame(2301 + WORD_END_MS - 1, false)).toBe(false);
    expect(w.frame(2301 + WORD_END_MS, false)).toBe(true);
    expect(w.take()).toBe("A");
    expect(w.word).toBe("");
    expect(w.frame(9000, false)).toBe(false);
  });

  it("no pasa de MAX_LETTERS letras", () => {
    const w = new SpellWord();
    for (let i = 0; i < MAX_LETTERS + 5; i++) {
      w.letter("A");
      w.letter(null);
    }
    expect(w.word).toHaveLength(MAX_LETTERS);
  });
});

describe("handsUp", () => {
  it("una mano con la muñeca arriba del 85 % del alto cuenta como arriba", () => {
    expect(handsUp(frame([]))).toBe(false);
    expect(handsUp(frame([hand(300)]))).toBe(true);
    expect(handsUp(frame([hand(470)]))).toBe(false);
    expect(handsUp(frame([hand(470), hand(200)]))).toBe(true);
  });
});

describe("spelledLabel", () => {
  it("separa las letras con punto medio", () => {
    expect(spelledLabel("ANGEL")).toBe("A·N·G·E·L");
    expect(spelledLabel("ÑOÑO")).toBe("Ñ·O·Ñ·O");
  });
});

describe("con el reconocedor del alfabeto del equipo (predictAlphabet + StableLetter)", () => {
  const sampleHand = (letter: string) => {
    const f = samples.samples[samples.labels.indexOf(samples.letters.indexOf(letter))];
    return Array.from({ length: 21 }, (_, i) => f.slice(i * 3, i * 3 + 3).map((v, k) => v * 200 + [320, 240, 0][k]));
  };
  /** Sostiene cada letra `ms` a 30 fps; `null` = la mano sale un momento (así se repite una letra). */
  const spellWith = (seq: (string | null)[], ms = 900) => {
    const stable = new StableLetter();
    const w = new SpellWord();
    let t = 0;
    for (const l of seq) {
      for (let k = 0; k < ms / 33; k++, t += 33) {
        const hand = l ? sampleHand(l) : null;
        w.letter(stable.push(t, hand ? predictAlphabet(hand).static : null, hand !== null)?.[0] ?? null);
      }
    }
    return w.word;
  };

  it("A-N-G-E-L sostenidas ~0.9 s cada una forman ANGEL", () => {
    expect(spellWith(["A", "N", "G", "E", "L"])).toBe("ANGEL");
  });

  it("una letra repetida necesita mover la mano entre las dos", () => {
    expect(spellWith(["A", "N", "A"])).toBe("ANA");
    expect(spellWith(["L", "L"])).toBe("L");
    expect(spellWith(["L", null, "L"])).toBe("LL");
  });
});
