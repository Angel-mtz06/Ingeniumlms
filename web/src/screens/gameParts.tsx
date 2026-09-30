/*
 * gameParts.tsx: piezas comunes de la pestaña Juegos (encabezado, recorrido de letras con el reconocedor
 * del alfabeto, medidor, nota bajo la cámara y la tira de letras).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconWarning, ToneIcon } from "../components/icons";
import { useAlphabetRecognition } from "../hooks/useAlphabetRecognition";
import { MOTION_LETTERS } from "../lib/alphabet";
import { motionGauge, staticGauge } from "../lib/alphabetView";
import { lettersOf, spellable } from "../lib/games";
import type { GaugeView } from "../lib/gauge";
import { useApp, useFrameSink } from "./shared";

export function GameHead({ title, lead, onBack, right }: { title: string; lead: string; onBack(): void; right?: ReactNode }) {
  return (
    <header className="screen__head screen__head--row screen__head--compact">
      <div className="screen__head-text">
        <h2 className="screen__title">{title}</h2>
        <p className="screen__lead">{lead}</p>
      </div>
      <div className="game-head__right">
        {right}
        <button type="button" className="btn btn--change btn--small" onClick={onBack}>← Juegos</button>
      </div>
    </header>
  );
}

/* ------------------------------ Letras (reconocedor del alfabeto) ------------------------------ */

/**
 * Recorre `letters` una por una con el reconocedor del alfabeto y la letra actual como objetivo.
 * Una letra hecha pasa a la siguiente sola; la misma letra seguida (CARRERA: RR) reinicia el
 * reconocedor, que si no seguiría "completo".
 */
export function useLetterRun(letters: string[], active: boolean) {
  const { camera, vision } = useApp();
  const [index, setIndex] = useState(0);
  const target = active && index < letters.length ? letters[index] : null;
  const rec = useAlphabetRecognition(target, "specific", active && camera.ready && !vision.loading && !vision.error);
  useFrameSink(active ? (f) => rec.onFrame(f) : null);
  const restart = useRef(rec.restart);
  restart.current = rec.restart;
  useEffect(() => { restart.current(); }, [index, letters]);
  useEffect(() => {
    if (!rec.complete || !target) return;
    const id = window.setTimeout(() => setIndex((i) => i + 1), MOTION_LETTERS.has(target) ? 600 : 250);
    return () => window.clearTimeout(id);
  }, [rec.complete, target, index]);
  const reset = useCallback(() => setIndex(0), []);
  const skip = useCallback(() => setIndex((i) => Math.min(i + 1, letters.length)), [letters.length]);
  return { index, target, rec, reset, skip, done: index >= letters.length };
}

export type Run = ReturnType<typeof useLetterRun>;

export function letterGauge(run: Run): GaugeView {
  const { target, rec } = run;
  if (!target) return { kind: "idle", label: "¡Listo!", detail: "Palabra completa" };
  return MOTION_LETTERS.has(target) ? motionGauge(rec.live, rec.feedback, rec.complete) : staticGauge(rec.feedback, rec.targetShare, rec.progress);
}

/** Una línea bajo la cámara: qué hacer ahora con la letra actual. */
export function letterNote(run: Run): { tone?: "ok" | "warn"; text: string } {
  const { target, rec } = run;
  if (!target) return { tone: "ok", text: "¡Completaste la palabra!" };
  if (rec.complete) return { tone: "ok", text: `¡Bien! ${target}` };
  const fb = rec.feedback;
  if (MOTION_LETTERS.has(target)) {
    const live = rec.live;
    if (live?.phase === "result" && live.result && live.result.issue !== "ok") return { tone: "warn", text: live.result.reason };
    if (live?.phase === "moving") return { text: "Siguiendo tu movimiento…" };
    if (live?.phase === "ready") return { tone: "ok", text: "Posición lista: haz el movimiento." };
    if (fb && !fb.correct && fb.issue !== "no_hand") return { tone: "warn", text: fb.message };
    return { text: `Haz la ${target} con su movimiento.` };
  }
  if (!fb || fb.issue === "no_hand") return { text: `Haz la letra ${target} frente a la cámara.` };
  if (fb.correct) return { tone: "ok", text: "¡Eso es! Mantén la posición…" };
  return { tone: "warn", text: fb.message };
}

/**
 * Las letras de un texto: hechas, saltadas, la actual y las que faltan. Cada palabra va junta (no se
 * parte entre renglones); los espacios separan palabras pero no se deletrean.
 */
export function LetterStrip({ text, index, skipped, big }: { text: string; index: number; skipped: ReadonlySet<number>; big?: boolean }) {
  const letters = lettersOf(text);
  let n = 0;
  return (
    <p className={`game-word${big ? " game-word--big" : ""}`} translate="no" aria-label={`${text}: letra ${Math.min(index + 1, letters.length)} de ${letters.length}`}>
      {spellable(text).split(" ").filter(Boolean).map((w, wi) => (
        <span key={wi} className="game-word__w">
          {[...w].map((c, i) => {
            const k = n++;
            const state = k < index ? (skipped.has(k) ? "skip" : "done") : k === index ? "now" : "todo";
            return <span key={i} className="game-word__letter" data-state={state} aria-hidden="true">{c}</span>;
          })}
        </span>
      ))}
    </p>
  );
}

export function Note({ note }: { note: { tone?: "ok" | "warn"; text: string } }) {
  return (
    <div className="practice-note" data-tone={note.tone} aria-live="polite">
      <p className="practice-note__tip">
        {note.tone === "ok" ? <ToneIcon tone="ok" /> : note.tone === "warn" ? <IconWarning /> : null}
        <span>{note.text}</span>
      </p>
    </div>
  );
}
