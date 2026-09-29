import model from "../data/alphabet_samples.json";
import sep from "../data/alphabet_sep.json";

export const LETTERS = [..."ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"].filter((l) => model.letters.includes(l));
// Dynamic policy requested by the project. K is evaluated as a pose only.
export const MOTION_LETTERS = new Set(["J", "Ñ", "Q", "X", "Z"]);
export const HOLD_MS = 800;
export const CONF_THRESHOLD = model.threshold;
/** Model letter order (indexes of shares/letterDistance) and per-letter rejection radius. */
export const LETTERS_ORDER: string[] = model.letters;
export const LETTER_RADIUS: number[] = model.radius;
export type Prediction = [string, number];
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const norm = (v: number[]) => Math.hypot(...v);
const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

/** Pixel coordinates from the existing frame pipeline (y must use video height).
 * Matches letters.npz: hand_local / MCP9 + finger_flexion/180 + palm normal.
 */
export function alphabetFeatures(hand: number[][]): number[] | null {
  if (hand.length !== 21 || hand.some((p) => p.length !== 3 || p.some((v) => !Number.isFinite(v)))) return null;
  const local = hand.map((p) => sub(p, hand[0]));
  const scale = norm(local[9]);
  if (scale < 1e-6) return null;
  const h = local.map((p) => p.map((v) => v / scale));
  const flex = [1, 5, 9, 13, 17].map((b) => {
    const v = sub(h[b + 3], h[b]);
    return Math.atan2(norm(cross(h[b], v)), h[b].reduce((sum, n, i) => sum + n*v[i], 0)) / Math.PI;
  });
  const normal = cross(h[5], h[17]);
  const ns = norm(normal);
  if (ns < 1e-6) return null;
  return [...h.flat(), ...flex, ...normal.map((v) => v / ns)];
}

/** Additional shape measurements distinguish bent PIP/DIP joints that the old
 * wrist/base/tip angle alone misses. Derived from the SAME training landmarks.
 */
export function alphabetMetricFeatures(hand: number[][]): number[] | null {
  const f=alphabetFeatures(hand);
  if (!f) return null;
  const h=Array.from({length:21},(_,i)=>f.slice(i*3,i*3+3));
  const joints:number[]=[];
  for (const base of [1,5,9,13,17]) for (const j of [base+1,base+2]) {
    const u=sub(h[j],h[j-1]),v=sub(h[j+1],h[j]);
    joints.push(Math.atan2(norm(cross(u,v)),u.reduce((s,n,i)=>s+n*v[i],0))/Math.PI);
  }
  return [...f,...joints,...[4,8,12,16,20].map(tip=>norm(h[tip]))];
}

/** In-image rotation around the wrist (degrees): the poster shows one person at one angle. */
const rotate = (hand: number[][], deg: number) => {
  const r = deg*Math.PI/180, c = Math.cos(r), s = Math.sin(r), [x0, y0] = hand[0];
  return hand.map(([x, y, z]) => [x0+(x-x0)*c-(y-y0)*s, y0+(x-x0)*s+(y-y0)*c, z]);
};
export const SEP_ROTATIONS = [0, -12, 12];
/**
 * La pose de la fotografía oficial (cartel SEP) de cada letra, medida con el mismo MediaPipe, más
 * dos giros leves. letters.npz hace M y N con los dedos casi rectos y el cartel los dobla sobre el
 * pulgar; sin estas muestras una M hecha como en la referencia se rechazaba.
 */
export const SEP_HANDS: {letter: string; hand: number[][]}[] = Object.entries(sep.hands as Record<string, number[][]>)
  .filter(([l]) => model.letters.includes(l))
  .flatMap(([letter, hand]) => SEP_ROTATIONS.map((deg) => ({letter, hand: rotate(hand, deg)})));

// Compile once, not per frame. See training/audit_alphabet.py for split and radii.
const sepFeatures = SEP_HANDS.map(({letter, hand}) => ({label: model.letters.indexOf(letter), f: alphabetMetricFeatures(hand)}))
  .filter((e): e is {label: number; f: number[]} => e.f !== null);
const samples = [...model.samples, ...sepFeatures.map((e) => e.f)].map((s) => Float32Array.from(s, (v, i) => v / model.std[i]));
const labels = [...model.labels, ...sepFeatures.map((e) => e.label)];
const aliases: Record<string, string> = { J: "I", "Ñ": "N", Z: "D" };
export interface AlphabetPrediction {
  pose: Prediction | null;
  static: Prediction | null;
  /** Up to 3 static letters by relative vote share (not calibrated probabilities), for Libre. */
  ranking: Prediction[];
  /** Per letter (model.letters order): static vote share (J/Ñ/Z pooled into I/N/D). */
  shares: number[];
  /** Per letter: nearest-sample distance of that letter (same scale as model.radius). */
  letterDistance: number[];
}

/** k=5 from the existing letters.npz. Mirrored x is a second handedness hypothesis;
 * we keep the closer hypothesis, never mix both as extra votes. No rotation is
 * removed: palm orientation distinguishes C/O and M/N from upright fists.
 */
export function predictAlphabet(hand: number[][]): AlphabetPrediction {
  const features = alphabetMetricFeatures(hand);
  const empty: AlphabetPrediction = { pose: null, static: null, ranking: [], shares: [], letterDistance: [] };
  if (!features) return empty;
  const q = features.map((v, i) => v/model.std[i]);
  const mirrored = q.map((v, i) => (i < 63 && i % 3 === 0) || (i >= 69 && i < 71) ? -v : v);
  // Full scan (4,860 × 86): also yields each letter's nearest sample for target verification.
  const nearest = (query: number[]) => {
    const best: {distance: number; label: number}[] = [];
    const perLetter = model.letters.map(() => Infinity);
    samples.forEach((s, index) => {
      let d = 0;
      for (let i = 0; i < features.length; i++) d += (query[i]-s[i])**2;
      const label = labels[index];
      if (d < perLetter[label]) perLetter[label] = d;
      if (best.length === model.k && d > best[best.length-1].distance) return;
      best.push({distance:d, label});
      best.sort((a,b) => a.distance-b.distance);
      if (best.length > model.k) best.pop();
    });
    return {best, perLetter};
  };
  const direct = nearest(q), mirror = nearest(mirrored);
  const chosen = mirror.best[0].distance < direct.best[0].distance ? mirror : direct;
  const neighbors = chosen.best;
  const votes = model.letters.map(() => 0);
  neighbors.forEach((n) => { votes[n.label] += 1/(Math.sqrt(n.distance)+1e-6); });
  const total = votes.reduce((s,v) => s+v,0);
  const choose = (weights: number[]): Prediction | null => {
    const idx = weights.indexOf(Math.max(...weights));
    const confidence = weights[idx]/total;
    return confidence >= CONF_THRESHOLD && neighbors[0].distance/features.length <= model.radius[idx]
      ? [model.letters[idx], confidence] : null;
  };
  const pose = choose(votes);
  const staticVotes = [...votes];
  // A static frame cannot distinguish I/J, N/Ñ or D/Z: it supports the base
  // pose, never completion of the moving letter. Q/X remain rejection classes.
  for (const [moving, base] of Object.entries(aliases)) {
    staticVotes[model.letters.indexOf(base)] += staticVotes[model.letters.indexOf(moving)];
    staticVotes[model.letters.indexOf(moving)] = 0;
  }
  const stable = choose(staticVotes);
  const ranking = model.letters.map((l, i): Prediction => [l, staticVotes[i]/total])
    .filter(([l, share]) => share > 0 && !MOTION_LETTERS.has(l)).sort((a, b) => b[1]-a[1]).slice(0, 3);
  const letterDistance = chosen.perLetter.map((d) => d/features.length);
  return {pose, static: stable && !MOTION_LETTERS.has(stable[0]) ? stable : null, ranking, shares: staticVotes.map((v) => v/total), letterDistance};
}

export const classifyAlphabet = (hand: number[][]): Prediction | null => predictAlphabet(hand).static;

/** Brief mismatches (≤ HOLD_GRACE_MS, e.g. one noisy MediaPipe frame) pause the hold instead of resetting it. */
export const HOLD_GRACE_MS = 300;

/** Accumulates matching time on distinct, fresh observations. A camera stall (>250 ms between
 * frames) or a mismatch lasting more than HOLD_GRACE_MS resets it; shorter mismatches only pause it.
 */
export class AlphabetHold {
  private held = 0;
  private last: number | null = null;
  private lastMatch: number | null = null;
  reset() { this.held = 0; this.last = null; this.lastMatch = null; }
  push(t: number, matches: boolean): number {
    if (!Number.isFinite(t)) { this.reset(); return 0; }
    if (this.last !== null && t <= this.last) return Math.min(1, this.held/HOLD_MS);
    if (this.last !== null && t-this.last > 250) this.reset();
    const previous = this.last;
    this.last = t;
    if (!matches) {
      if (this.lastMatch === null || t-this.lastMatch > HOLD_GRACE_MS) { this.held = 0; this.lastMatch = null; }
      return Math.min(1, this.held/HOLD_MS);
    }
    if (this.lastMatch !== null && previous !== null) this.held += t-previous;
    this.lastMatch = t;
    return Math.min(1, this.held/HOLD_MS);
  }
}

/** Hysteresis for targetless recognition: 80% agreement across >=600 ms.
 * One wrong frame cannot replace an established letter. Missing hands clear it.
 */
export class StableLetter {
  private history: {t: number; value: Prediction | null}[] = [];
  private shown: Prediction | null = null;
  private lastGood = 0;
  reset() { this.history = []; this.shown = null; this.lastGood = 0; }
  push(t: number, value: Prediction | null, present = true): Prediction | null {
    const last = this.history.at(-1)?.t;
    if (!present || (last !== undefined && (t <= last || t-last > 250))) this.reset();
    if (!present) return null;
    this.history.push({t,value});
    this.history = this.history.filter((h) => t-h.t <= 800);
    if (value?.[0] === this.shown?.[0] && value) this.lastGood = t;
    if (t-this.history[0].t >= 600) {
      const counts = new Map<string, number>();
      for (const h of this.history) if (h.value) counts.set(h.value[0], (counts.get(h.value[0]) ?? 0)+1);
      const best = [...counts].sort((a,b) => b[1]-a[1])[0];
      if (best && best[1]/this.history.length >= .8 && value?.[0] === best[0]) {
        this.shown = value; this.lastGood = t;
      }
    }
    if (t-this.lastGood > (value ? 1000 : 450)) this.shown = null;
    return this.shown;
  }
}
