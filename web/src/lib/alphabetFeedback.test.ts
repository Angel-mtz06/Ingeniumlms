import { describe, expect, it } from "vitest";
import samples from "../data/alphabet_samples.json";
import { predictAlphabet } from "./alphabet";
import {
  analyzePose, BLOCK_SEVERITY, CaptureMonitor, captureFeedback, describeIssue, FeedbackStabilizer, fingerStates, GENERIC_MESSAGE, poseFeedback, targetMatches,
  type Feedback,
} from "./alphabetFeedback";
import { handShape, LETTER_STATS } from "./handShape";

// Fixtures come from the classifier's own samples (letters.npz): geometry contracts, not accuracy.
type Hand = number[][];
const handOf = (s: number[]): Hand => Array.from({ length: 21 }, (_, i) => s.slice(i * 3, i * 3 + 3));
const byLetter = (l: string) => samples.samples.filter((_, i) => samples.letters[samples.labels[i]] === l).map(handOf);
const px = (h: Hand, s = 110, ox = 320, oy = 300) => h.map((p) => [p[0] * s + ox, p[1] * s + oy, p[2] * s]);
const PALM = [0, 1, 2, 5, 9, 13, 17];
const d2 = (a: Hand, b: Hand) => PALM.reduce((s, i) => s + a[i].reduce((q, v, k) => q + (v - b[i][k]) ** 2, 0), 0);
/** Replace one finger with the same finger of the closest-palm sample of another letter. */
function transplant(base: Hand, donorLetter: string, joints: number[]): Hand {
  const donor = byLetter(donorLetter).reduce((b, d) => (d2(d, base) < d2(b, base) ? d : b));
  const out = base.map((p) => [...p]);
  const [root, ...rest] = joints;
  for (const j of rest) out[j] = base[root].map((v, k) => v + donor[j][k] - donor[root][k]);
  return out;
}
const IDX = [5, 6, 7, 8], THUMB = [1, 2, 3, 4];
const rotateImage = (h: Hand, deg: number) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return h.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z]); };
const rotateY = (h: Hand, deg: number) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return h.map(([x, y, z]) => [x * c + z * s, y, -x * s + z * c]); };
const first = (hand: Hand, target: string) => describeIssue(analyzePose(px(hand), target));
const share = (hands: Hand[], pred: (h: Hand) => boolean) => hands.filter(pred).length / hands.length;

describe("reference statistics per letter", () => {
  it("are measured from the samples: B extends the index, A flexes it", () => {
    expect(LETTER_STATS.B.flex1!.median).toBeLessThan(40);
    expect(LETTER_STATS.A.flex1!.median).toBeGreaterThan(100);
    expect(LETTER_STATS.A.spread12).toBe(undefined); // fingers closed: separation is not defined
  });
  it("are invariant to position, scale and hand mirroring", () => {
    const h = byLetter("V")[0], a = handShape(px(h))!, b = handShape(px(h.map(([x, y, z]) => [-x, y, z]), 200, 50, 400))!;
    for (const k of Object.keys(a)) expect(a[k]).toBeCloseTo(b[k], 4);
  });
  it("almost never block a real sample of the same letter", () => {
    const all = samples.samples.map((s, i) => ({ h: handOf(s), l: samples.letters[samples.labels[i]] }));
    const blocked = all.filter(({ h, l }) => analyzePose(px(h), l).some((i) => i.big && i.severity >= BLOCK_SEVERITY)).length;
    expect(blocked / all.length).toBeLessThan(0.05);
  });
});

describe("finger, thumb, spread and orientation corrections (measured, one at a time)", () => {
  it("index bent in B → extend the index", () => {
    const hands = byLetter("B").slice(0, 40).map((h) => transplant(h, "A", IDX));
    expect(share(hands, (h) => first(h, "B")?.message === "Extiende el dedo índice.")).toBeGreaterThan(0.8);
    expect(first(hands[0], "B")).toEqual({ correct: false, type: "finger", issue: "should_extend", fingers: ["índice"], message: "Extiende el dedo índice." });
  });
  it("index extended in A → bend the index", () => {
    const hands = byLetter("A").slice(0, 40).map((h) => transplant(h, "B", IDX));
    expect(share(hands, (h) => first(h, "A")?.message === "Dobla el dedo índice.")).toBeGreaterThan(0.8);
  });
  it("thumb opened to the side in B → thumb correction", () => {
    const hands = byLetter("B").slice(0, 40).map((h) => transplant(h, "L", THUMB));
    expect(share(hands, (h) => first(h, "B")?.type === "thumb")).toBeGreaterThan(0.8);
    expect(first(hands[0], "B")?.message).toBe("Cruza el pulgar por delante de la palma.");
  });
  it("separated index and middle in U → join them", () => {
    const hands = byLetter("U").slice(0, 60).map((h) => transplant(transplant(h, "V", IDX), "V", [9, 10, 11, 12]));
    expect(share(hands, (h) => first(h, "U")?.issue === "should_join")).toBeGreaterThan(0.3);
    expect(hands.map((h) => first(h, "U")?.message).find((m) => m?.startsWith("Junta"))).toMatch(/^Junta más (las puntas del|el) índice y el medio\.$/);
  });
  it("upside-down B → orientation first, even with a finger also wrong", () => {
    const h = rotateImage(transplant(byLetter("B")[1], "A", IDX), 180);
    expect(first(h, "B")?.message).toBe("Endereza la mano: los dedos deben apuntar hacia arriba.");
  });
  it("B turned sideways → face the camera", () => {
    expect(first(rotateY(byLetter("B")[1], 90), "B")?.issue).toBe("face_camera");
  });
  it("no issue beyond the data → generic message, never an invented instruction", () => {
    const b = byLetter("B")[1];
    expect(analyzePose(px(b), "B")).toHaveLength(0);
    expect(poseFeedback(px(b), "B", false)).toEqual({ correct: false, type: "unknown", issue: "not_recognized", message: GENERIC_MESSAGE });
    expect(poseFeedback(px(b), "B", true).correct).toBe(true);
  });
  it("the classifier and the analysis agree on a real B", () => {
    const b = px(byLetter("B")[1]);
    expect(predictAlphabet(b).static?.[0]).toBe("B");
    expect(poseFeedback(b, "B", true).message).toBe("¡Correcto!");
  });
});

describe("capture quality comes before any finger analysis", () => {
  const b = byLetter("B")[0];
  it.each([
    ["no_hand", [] as Hand[], "Coloca tu mano frente a la cámara."],
    ["two_hands", [px(b), px(b, 110, 120)], "Usa una sola mano."],
    ["out_of_frame", [px(b, 110, 320, 120)], "Mantén toda la mano dentro del cuadro. Baja un poco la mano."],
    ["out_of_frame", [px(b, 110, 630, 300)], "Mantén toda la mano dentro del cuadro. Centra la mano."],
    ["too_small", [px(b, 15)], "Acerca un poco la mano a la cámara."],
  ] as [string, Hand[], string][])("%s", (issue, hands, message) => {
    expect(captureFeedback(hands, 640, 480)).toEqual({ correct: false, type: "capture", issue, message });
  });
  it("a centred, complete hand passes", () => { expect(captureFeedback([px(b)], 640, 480)).toBeNull(); });
  it("moving hand → unstable; a still hand with landmark jitter → stable", () => {
    const m = new CaptureMonitor();
    let last: Feedback | null = null;
    for (let t = 0; t <= 600; t += 33) last = m.push(t, [px(b, 110, 200 + t * 0.4)], 640, 480);
    expect(last?.issue).toBe("unstable");
    m.reset();
    for (let t = 0; t <= 600; t += 33) last = m.push(t, [px(b).map((p) => p.map((v) => v + ((t / 33) % 2 ? 1 : -1)))], 640, 480);
    expect(last).toBeNull();
  });
});

describe("message stabilizer", () => {
  it("one different frame does not replace the shown message; a sustained one does", () => {
    const s = new FeedbackStabilizer();
    const a: Feedback = { correct: false, type: "finger", issue: "should_extend", message: "Extiende el dedo índice." };
    const b: Feedback = { correct: false, type: "spread", issue: "should_join", message: "Junta más el índice y el medio." };
    for (let t = 0; t <= 300; t += 33) s.push(t, a);
    expect(s.push(333, b)).toBe(a);
    let shown: Feedback = a;
    for (let t = 366; t <= 800; t += 33) shown = s.push(t, b);
    expect(shown).toBe(b);
  });
});

describe("verification against the target letter", () => {
  it("accepts the target when compatible; rejects a neighbour the measurements rule out", () => {
    const ok = (l: string, t: string) => share(byLetter(l).slice(0, 60), (h) => targetMatches(predictAlphabet(px(h)), px(h), t));
    expect(ok("R", "R")).toBeGreaterThan(0.9);
    expect(ok("V", "V")).toBeGreaterThan(0.9);
    expect(ok("M", "M")).toBeGreaterThan(0.9);
    expect(ok("U", "R")).toBeLessThan(0.15);
    expect(ok("V", "U")).toBeLessThan(0.15);
    expect(ok("A", "B")).toBe(0);
  });
  it("finger states mark the measured finger (HandDiagram contract)", () => {
    const h = px(transplant(byLetter("B")[0], "A", IDX));
    expect(fingerStates(h, "B")).toEqual([0, 2, 0, 0, 0]);
    expect(fingerStates(null, "B")).toEqual([]);
  });
  it("crossed fingers: a V aimed at R asks to cross; an R aimed at V or U asks not to", () => {
    const v = byLetter("V").map((h) => first(h, "R")?.issue);
    expect(v.filter((i) => i === "should_cross").length / v.length).toBeGreaterThan(0.8);
    for (const t of ["V", "U"]) {
      const r = byLetter("R").map((h) => first(h, t)?.issue);
      expect(r.filter((i) => i === "should_uncross").length / r.length).toBeGreaterThan(0.5);
    }
  });
});
