import { useCallback, useEffect, useRef, useState } from "react";
import { AlphabetHold, alphabetFeatures, LETTERS_ORDER, MOTION_LETTERS, predictAlphabet, StableLetter, type Prediction } from "../lib/alphabet";
import {
  CaptureMonitor, FeedbackStabilizer, fingerStates, outOfFrame, poseFeedback, targetMatches, type Feedback,
} from "../lib/alphabetFeedback";
import {
  analyzeMotion, LiveMotion, MAX_MOVE_MS, motionBaseLetter, movementEnded, MotionWindow, RESULT_MS, significantMotion,
  startPoseOk, type LiveMotionState, type MotionFrame, type MotionResult,
} from "../lib/alphabetMotion";
import type { FramePayload } from "../lib/protocol";

export type AlphabetMode = "sequential" | "specific" | "free";
/** Libre: idle → capturing (desde que empieza a moverse hasta que se detiene) → result. */
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
 *  - Libre: letra estable + top 3; un movimiento se sigue hasta que la mano se detiene.
 */
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
  const hold = useRef(new AlphabetHold());
  const stabilizer = useRef(new StableLetter());
  const monitor = useRef(new CaptureMonitor());
  const messages = useRef(new FeedbackStabilizer());
  const window = useRef(new MotionWindow());
  const tracker = useRef<LiveMotion | null>(null);
  const state = useRef({phase:"idle" as MotionPhase, since:0, lastFrame:0, completed:false, frames:[] as MotionFrame[], hidden:false});
  const dynamic = target !== null && MOTION_LETTERS.has(target);

  const transition = useCallback((next: MotionPhase, now: number) => {
    state.current.phase=next; state.current.since=now; setPhase(next);
  }, []);

  const restart = useCallback(() => {
    hold.current.reset(); stabilizer.current.reset(); window.current.clear(); monitor.current.reset(); messages.current.reset();
    tracker.current = dynamic && mode !== "free" ? new LiveMotion(target!) : null;
    state.current.frames=[]; state.current.completed=false; state.current.lastFrame=0;
    setDetected(null); setRanking([]); setFeedback(null); setFingers([]); setSide(null); setTargetShare(0); setStable(null);
    setProgress(0); setComplete(false); setLive(null); setMotionResult(null);
    transition("idle", performance.now());
  }, [enabled,dynamic,target,mode,transition]);

  useEffect(() => { restart(); }, [restart]);

  useEffect(() => {
    if (!enabled) return;
    const timer = globalThis.setInterval(() => {
      const now=performance.now(), s=state.current;
      if (document.hidden) {
        s.hidden=true; s.frames=[]; hold.current.reset(); stabilizer.current.reset(); window.current.clear(); tracker.current?.reset();
        setDetected(null); setStable(null); setProgress(0);
        return;
      }
      if (s.hidden) { s.hidden=false; restart(); return; }
      if (now-s.lastFrame>250) {
        hold.current.reset(); stabilizer.current.reset(); window.current.clear(); monitor.current.reset();
        setDetected(null); setStable(null); setRanking([]); setFingers([]);
        if (!s.completed) { setProgress(0); setFeedback(null); }
      }
      if (s.phase === "result" && now-s.since > RESULT_MS) {
        s.frames=[]; window.current.clear(); stabilizer.current.reset(); setStable(null); setMotionResult(null);
        transition("idle",now);
      }
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
      const startOk = !!hand && !capture && (startPoseOk(prediction.pose, target) || targetMatches(prediction, hand, base));
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

    if (s.phase === "capturing") {
      s.frames.push(frame);
      if (s.frames.length>240) s.frames.shift();
      if (!hand || movementEnded(s.frames) || now-s.since > MAX_MOVE_MS) {
        const result = analyzeMotion(s.frames);
        setMotionResult(result); setStable(result.prediction);
        transition("result", now);
      }
      return;
    }
    if (s.phase !== "idle") return;

    if (mode === "free") {
      setDetected(prediction.static);
      // Sin letra objetivo no se sabe qué quería hacer el usuario: solo retroalimentación de captura.
      setFeedback(capture ? messages.current.push(t, capture) : null);
      if (!hand) window.current.clear();
      else window.current.push(frame);
      if (hand && significantMotion(window.current.frames)) {
        s.frames=[...window.current.frames]; stabilizer.current.reset(); setStable(null); setMotionResult(null); setFingers([]);
        transition("capturing",now);
      } else {
        const shown = stabilizer.current.push(t,prediction.static,hand!==null);
        setStable(shown);
        // Libre: sin objetivo, los dedos se comparan con la letra que la app YA reconoció (verde = coincide).
        setFingers(hand && !capture && shown ? fingerStates(hand, shown[0]) : []);
      }
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
  return {onFrame,detected,ranking,feedback,fingers,side,targetShare,stable,progress,complete,live,phase,motionResult,restart};
}
