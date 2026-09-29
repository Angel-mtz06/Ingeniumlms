import { describe, expect, it } from "vitest";
import { AlphabetHold, alphabetFeatures, classifyAlphabet, LETTERS, MOTION_LETTERS, StableLetter } from "./alphabet";
import references from "../data/alphabet_references.json";
import samples from "../data/alphabet_samples.json";

const sampleHand = (letter: string) => {
  const f=samples.samples[samples.labels.indexOf(samples.letters.indexOf(letter))];
  return Array.from({length:21},(_,i)=>f.slice(i*3,i*3+3));
};

describe("alphabet hold", () => {
  it("requires 800 ms of fresh matching frames", () => {
    const h = new AlphabetHold();
    expect(h.push(0, true)).toBe(0);
    for (let t = 100; t < 800; t += 100) expect(h.push(t, true)).toBeLessThan(1);
    expect(h.push(800, true)).toBe(1);
  });
  it("a brief mismatch (≤300 ms) pauses; a sustained one resets", () => {
    const h = new AlphabetHold();
    h.push(0, true); h.push(200, true);
    expect(h.push(300, false)).toBe(0.25); // pausa: un cuadro ruidoso no borra el avance
    expect(h.push(400, true)).toBe(0.375);
    h.push(500, false); h.push(600, false);
    expect(h.push(750, false)).toBe(0);    // >300 ms sin coincidir: se reinicia
    expect(h.push(800, true)).toBe(0);
    expect(h.push(1000, true)).toBe(0.25);
  });
  it("does not count a frozen camera, duplicate frames, or a new target", () => {
    const h = new AlphabetHold();
    h.push(0, true);
    expect(h.push(0, true)).toBe(0);
    expect(h.push(1000, true)).toBe(0);
    expect(h.push(1200, true)).toBe(0.25);
    h.reset();
    expect(h.push(1300, true)).toBe(0);
  });
});

describe("existing alphabet model", () => {
  it("has 27 actual classes with Ñ in alphabetic order; flags movements", () => {
    expect(LETTERS.join("")).toBe("ABCDEFGHIJKLMNÑOPQRSTUVWXYZ");
    expect([...MOTION_LETTERS]).toEqual(["J", "Ñ", "Q", "X", "Z"]);
  });
  it("matches the 71-dimensional input, independent of translation and scale", () => {
    const hand = sampleHand("A");
    const a = alphabetFeatures(hand)!;
    const b = alphabetFeatures(hand.map((p) => p.map((v, i) => v*200 + [320,240,0][i])))!;
    expect(a).toHaveLength(71);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));
    expect(Math.hypot(...a.slice(27,30))).toBeCloseTo(1);
    expect(Math.hypot(...a.slice(68))).toBeCloseTo(1);
    expect(classifyAlphabet(hand)?.[0]).toBe("A");
  });
  it.each(["A","B","C","M","N"])("keeps the %s label, pixel scaling and reflected-hand mapping", (letter) => {
    const h=sampleHand(letter);
    // Contract fixtures from the source samples, not an accuracy benchmark.
    expect(classifyAlphabet(h)?.[0]).toBe(letter);
    expect(classifyAlphabet(h.map(p=>[-p[0]*100+300,p[1]*100+240,p[2]*100]))?.[0]).toBe(letter);
  });
  it("does not approve a dynamic letter from pose alone", () => {
    for (const l of MOTION_LETTERS) expect(MOTION_LETTERS.has(classifyAlphabet(sampleHand(l))?.[0] ?? "")).toBe(false);
  });
  it("rejects absent, degenerate and nonfinite hands", () => {
    expect(classifyAlphabet([])).toBeNull();
    expect(classifyAlphabet(Array.from({length:21}, () => [0,0,0]))).toBeNull();
    expect(classifyAlphabet(references.A.map(() => [NaN,0,0]))).toBeNull();
  });
});

describe("free recognition hysteresis", () => {
  it("stabilizes A, ignores one B, then changes after sustained B", () => {
    const s=new StableLetter();
    for(let t=0;t<600;t+=100) expect(s.push(t,["A",.9])).toBeNull();
    expect(s.push(600,["A",.9])?.[0]).toBe("A");
    expect(s.push(700,["B",.9])?.[0]).toBe("A");
    expect(s.push(800,["A",.9])?.[0]).toBe("A");
    for(let t=900;t<=1800;t+=100) s.push(t,["B",.9]);
    expect(s.push(1900,["B",.9])?.[0]).toBe("B");
    expect(s.push(2000,null,false)).toBeNull();
  });
  it("does not force unstable, missing or unknown poses into a letter", () => {
    const s=new StableLetter();
    for(let i=0;i<20;i++) expect(s.push(i*100,[i%2 ? "A":"B",.9])).toBeNull();
    expect(s.push(2100,null)).toBeNull();
    s.reset();
    for(let t=0;t<=800;t+=100) s.push(t,["A",.9]);
    for(let t=900;t<=1300;t+=100) s.push(t,null);
    expect(s.push(1400,null)).toBeNull();
  });
});
