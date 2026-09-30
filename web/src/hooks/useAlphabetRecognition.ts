import { useCallback, useEffect, useRef, useState } from "react";
import { AlphabetHold, alphabetFeatures, LETTERS_ORDER, MOTION_LETTERS, predictAlphabet, StableLetter, type Prediction } from "../lib/alphabet";
import {
  CaptureMonitor, FeedbackStabilizer, fingerStates, outOfFrame, poseFeedback, targetMatches, type Feedback,
} from "../lib/alphabetFeedback";
import {
  FREE_MOTION_LETTERS, FreeMotion, LiveMotion, motionBaseLetter, motionStartOk, RESULT_MS, StaticGate,
  type LiveMotionState, type MotionFrame, type MotionResult,
} from "../lib/alphabetMotion";
import type { FramePayload } from "../lib/protocol";

export type AlphabetMode = "sequential" | "specific" | "free";
/** Libre: idle → capturing (una letra con movimiento lleva ≥ 25 % de su recorrido) → result. */
export type MotionPhase = "idle" | "capturing" | "result";

const START_READY: Feedback = { correct: true, type: "ok", issue: "start_ready", message: "Posición correcta." };
/**
 * Qué mano es, con la misma convención que el servidor en Práctica (normalize.assign_slots):
 * en la imagen sin espejo, a la izquierda de la cara = mano DERECHA del signante. Sin cara, el
 * centro de la imagen. Es una aproximación: cruzar la mano al otro lado de la cara la invierte.
 */
export function handSide(f: FramePayload): "derecha" | "izquierda" | null {
  const hand = f.hands.length === 1 ? f.hands[0] : null;
  if (!hand) return null;
  const cx = f.face?.[0]?.[0] ?? f.w / 2;
  return hand[0][0] < cx ? "derecha" : "izquierda";
}

const EMPTY = { pose: null, static: null, ranking: [] as Prediction[], shares: [] as number[], letterDistance: [] as number[] };

/**
 * Recognition + corrective feedback on the frames of the shared camera/MediaPipe.
 *  - Letra estática con objetivo: captura → verificación contra la objetivo → un mensaje + dedos.
 *  - Letra con movimiento con objetivo: seguimiento EN VIVO (LiveMotion), sin cuenta regresiva.
 *  - Libre: letra estable + top 3; las cinco letras con movimiento se siguen en vivo a la vez (FreeMotion).
 */
/**
 * Letras reconocidas en Libre, en orden (como ir escribiendo). La misma letra se repite solo si antes
 * se perdió la mano o se reconoció otra. Una letra con movimiento reemplaza a la pose con la que
 * empezó (I→J, N→Ñ, D→Z): esa pose no era otra letra. Lo usan Alfabeto (Libre) e Interpretación.
 */
export function useLetterSequence(stable: string | null, max = 60) {
  const [letters, setLetters] = useState<string[]>([]);
  useEffect(() => {
    if (!stable) return;
    const start = motionBaseLetter(stable);
    setLetters((prev) => start && start !== stable && prev.at(-1) === start
      ? [...prev.slice(0, -1), stable] : [...prev, stable].slice(-max));
  }, [stable, max]);
  return [letters, setLetters] as const;
}

export function useAlphabetRecognition(target: string | null, mode: AlphabetMode, enabled: boolean) {
  const [detected, setDetected] = useState<Prediction | null>(null);
  const [ranking, setRanking] = useState<Prediction[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [fingers, setFingers] = useState<number[]>([]);
  const [side, setSide] = useState<"derecha" | "izquierda" | null>(null);
  const [targetShare, setTargetShare] = useState(0);
  const [stable, setStable] = useState<Prediction | null>(null);
  const [progress, setProgress] = useState(0);
  const [complete, setComplete] = useState(false);
  const [live, setLive] = useState<LiveMotionState | null>(null);
  const [phase, setPhase] = useState<MotionPhase>("idle");
  const [motionResult, setMotionResult] = useState<MotionResult | null>(null);
  /** Libre: letras con movimiento cuya pose inicial ya está lista (p. ej. "J" o "ÑQ"). */
  const [freeReady, setFreeReady] = useState("");
  const hold = useRef(new AlphabetHold());
  const stabilizer = useRef(new StableLetter());
  const monitor = useRef(new CaptureMonitor());
  const messages = useRef(new FeedbackStabilizer());
  const freeMotion = useRef(new FreeMotion());
  const staticGate = useRef(new StaticGate());
  const tracker = useRef<LiveMotion | null>(null);
  const state = useRef({phase:"idle" as MotionPhase, since:0, lastFrame:0, completed:false, hidden:false, failedAt:null as number | null});
  const dynamic = target !== null && MOTION_LETTERS.has(target);

  const transition = useCallback((next: MotionPhase, now: number) => {
    state.current.phase=next; state.current.since=now; setPhase(next);
  }, []);

  const restart = useCallback(() => {
    hold.current.reset(); stabilizer.current.reset(); freeMotion.current.reset(); staticGate.current.reset(); monitor.current.reset(); messages.current.reset();
    tracker.current = dynamic && mode !== "free" ? new LiveMotion(target!) : null;
    state.current.completed=false; state.current.lastFrame=0;
    setDetected(null); setRanking([]); setFeedback(null); setFingers([]); setSide(null); setTargetShare(0); setStable(null);
    setProgress(0); setComplete(false); setLive(null); setMotionResult(null); setFreeReady(""); state.current.failedAt=null;
    transition("idle", performance.now());
  }, [enabled,dynamic,target,mode,transition]);

  useEffect(() => { restart(); }, [restart]);

  useEffect(() => {
    if (!enabled) return;
    const timer = globalThis.setInterval(() => {
      const now=performance.now(), s=state.current;
      if (document.hidden) {
        s.hidden=true; hold.current.reset(); stabilizer.current.reset(); freeMotion.current.reset(); tracker.current?.reset();
        setDetected(null); setStable(null); setProgress(0);
        return;
      }
      if (s.hidden) { s.hidden=false; restart(); return; }
      if (now-s.lastFrame>250) {
        hold.current.reset(); stabilizer.current.reset(); freeMotion.current.reset(); monitor.current.reset();
        setDetected(null); setStable(null); setRanking([]); setFingers([]);
        if (!s.completed) { setProgress(0); setFeedback(null); }
      }
      if (s.phase === "result" && now-s.since > RESULT_MS) {
        freeMotion.current.reset(); stabilizer.current.reset(); staticGate.current.reset(); setStable(null); setMotionResult(null);
        transition("idle",now);
      }
      // Libre: el aviso de un intento no aprobado se muestra RESULT_MS sin pausar el reconocimiento.
      if (s.failedAt !== null && now-s.failedAt > RESULT_MS) { s.failedAt=null; setMotionResult(null); }
    },50);
    return () => globalThis.clearInterval(timer);
  }, [enabled,mode,target,restart,transition]);

  const onFrame = (f: FramePayload) => {
    if (!enabled || document.hidden) return;
    const s=state.current, now=performance.now(), t=f.t ?? now;
    s.lastFrame=now;
    // 1–3: mano presente, completa, de tamaño suficiente y estable. Solo después se analizan dedos.
    const capture = monitor.current.push(t, f.hands, f.w, f.h);
    const hand=f.hands.length===1 && alphabetFeatures(f.hands[0]) ? f.hands[0] : null;
    const prediction=hand ? predictAlphabet(hand) : EMPTY;
    setRanking(prediction.ranking);
    setSide(handSide(f));
    const frame: MotionFrame={t,hand,pose:prediction.pose,out:hand ? outOfFrame(hand,f.w,f.h).out : false};

    if (tracker.current && target) {
      // Letra con movimiento: la pose inicial se verifica como una letra estática (J→I, Ñ→N, Z→D).
      const base = motionBaseLetter(target)!;
      const startOk = !!hand && !capture && motionStartOk(prediction, hand, target);
      const st = tracker.current.push({...frame, startOk});
      setLive(st);
      setDetected(prediction.static);
      if (st.phase === "pose" || st.phase === "ready") {
        const raw = capture ?? (startOk ? START_READY : poseFeedback(hand!, base, false));
        setFeedback(messages.current.push(t, raw));
        setFingers(hand && !capture ? fingerStates(hand, base) : []);
      }
      if (st.result?.issue === "ok" && !s.completed) { s.completed=true; setComplete(true); }
      return;
    }

    if (mode === "free") {
      if (s.phase === "result") return; // se está mostrando la letra con movimiento reconocida
      setDetected(prediction.static);
      // Sin letra objetivo no se sabe qué quería hacer el usuario: solo retroalimentación de captura.
      setFeedback(capture ? messages.current.push(t, capture) : null);
      // Cada letra con movimiento arranca desde su pose inicial, verificada igual que en Secuencial.
      const startOk: Record<string, boolean> = {}, score: Record<string, number> = {};
      for (const letter of FREE_MOTION_LETTERS) {
        const base = motionBaseLetter(letter)!;
        startOk[letter] = !!hand && !capture && motionStartOk(prediction, hand, letter);
        score[letter] = prediction.shares[LETTERS_ORDER.indexOf(base)] ?? 0;
      }
      const motion = freeMotion.current.push(frame, startOk, score);
      setFreeReady(motion.ready.join(""));
      if (motion.result) {
        s.failedAt=null; stabilizer.current.reset(); setMotionResult(motion.result); setStable(motion.result.prediction); setFingers([]); setFreeReady("");
        transition("result", now);
        return;
      }
      if (motion.failed) { s.failedAt=now; setMotionResult(motion.failed); }
      if (motion.moving !== (s.phase === "capturing")) transition(motion.moving ? "capturing" : "idle", now);
      // Letra estática: solo con la mano quieta y sin una letra con movimiento en curso; I/N/D esperan
      // un poco más por si viene su movimiento (StaticGate). Perder la mano un instante no la reinicia.
      const { still, present } = staticGate.current.observe(frame);
      const steady = stabilizer.current.push(t, still && !motion.moving ? prediction.static : null, present);
      const shown = staticGate.current.gate(t, steady);
      setStable(shown);
      // Libre: sin objetivo, los dedos se comparan con la letra que la app YA reconoció (verde = coincide).
      setFingers(hand && !capture && shown && !motion.moving ? fingerStates(hand, shown[0]) : []);
      return;
    }
    if (s.completed || !target) return;
    // Con letra objetivo basta con que la mano sea compatible con ella (targetMatches), no que
    // "gane" contra todas: así M, N, R, U, V dejan de rechazarse por parecerse a su vecina.
    const matches = !!hand && !capture && targetMatches(prediction, hand, target);
    const ti = LETTERS_ORDER.indexOf(target);
    const share = prediction.shares[ti] ?? 0;
    setTargetShare(share);
    setDetected(matches ? [target, Math.max(share, prediction.static?.[1] ?? 0)] : prediction.static);
    const raw = capture ?? poseFeedback(hand!, target, matches);
    const shown = messages.current.push(t, raw);
    setFeedback(shown);
    setFingers(hand && !capture ? fingerStates(hand, target) : []);
    const p=hold.current.push(t,shown.correct);
    setProgress(p);
    if (p>=1) { s.completed=true; setComplete(true); }
  };
  return {onFrame,detected,ranking,feedback,fingers,side,targetShare,stable,progress,complete,live,phase,motionResult,freeReady,restart};
}
