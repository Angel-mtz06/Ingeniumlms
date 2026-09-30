/*
 * gameParts.tsx: piezas comunes de la pestaña Juegos (encabezado, recorrido de letras con el reconocedor
 * del alfabeto, medidor, nota bajo la cámara y la tira de letras).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { HandDiagram } from "../components/HandDiagram";
import { IconWarning, ToneIcon } from "../components/icons";
import { LetterReference, LetterTutorial, TUTORIAL } from "../components/LetterReference";
import { ReferencePlayer } from "../components/ReferencePlayer";
import { useAlphabetRecognition } from "../hooks/useAlphabetRecognition";
import { MOTION_LETTERS } from "../lib/alphabet";
import { motionGauge, staticGauge } from "../lib/alphabetView";
import { lettersOf, spellable } from "../lib/games";
import type { GaugeView } from "../lib/gauge";
import type { ServerMsg } from "../lib/protocol";
import { glossLabel } from "../lib/ui";
import { useApp, useFrameSink } from "./shared";

export function GameHead({ title, lead, onBack, right, assist }: { title: string; lead: string; onBack(): void; right?: ReactNode; assist?: Assist }) {
  return (
    <header className="screen__head screen__head--row screen__head--compact">
      <div className="screen__head-text">
        <h2 className="screen__title">{title}</h2>
        <p className="screen__lead">{lead}</p>
      </div>
      <div className="game-head__right">
        {right}
        {assist ? <AssistToggle assist={assist} /> : null}
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

/* ------------------------------ Asistencia y pistas ------------------------------ */

/**
 * Asistencia: un modo que, mientras está activo, SIEMPRE muestra cómo se hace lo que toca (foto o
 * video de la letra, animación de la seña) y tus dedos en vivo con lo que debes corregir. Es distinta
 * de la Pista, que es una ayuda puntual y limitada de cada juego. Con asistencia no se guardan récords.
 * Se recuerda en este navegador para todos los juegos.
 */
const ASSIST_KEY = "lsm.games.assist";
export interface Assist { on: boolean; toggle(): void }
export function useAssist(): Assist {
  const [on, setOn] = useState(() => {
    try { return window.localStorage.getItem(ASSIST_KEY) === "1"; } catch { return false; }
  });
  const toggle = useCallback(() => setOn((v) => {
    try { window.localStorage.setItem(ASSIST_KEY, v ? "0" : "1"); } catch { /* solo esta visita */ }
    return !v;
  }), []);
  return { on, toggle };
}

/** ¿Se usó la asistencia en algún momento de la partida (`active`)? Con asistencia no hay récord. */
export function useAssistUsed(on: boolean, active: boolean) {
  const [used, setUsed] = useState(false);
  useEffect(() => { if (on && active) setUsed(true); }, [on, active]);
  const reset = useCallback(() => setUsed(false), []);
  return { used: used || (on && active), reset };
}

export function AssistToggle({ assist }: { assist: Assist }) {
  return (
    <button type="button" role="switch" aria-checked={assist.on} className="switch game-assist-toggle" onClick={assist.toggle}
      title="Muestra siempre cómo se hace lo que toca y tus dedos en vivo">
      <span className="switch__track" aria-hidden="true"><span className="switch__thumb" /></span>
      <span className="switch__label">🧑‍🏫 Asistencia</span>
    </button>
  );
}

/** Pista temporal: se muestra `ms` y se cuenta cuántas se usaron. */
export function useTimedHint(ms: number) {
  const [shown, setShown] = useState(false);
  const [used, setUsed] = useState(0);
  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(id);
  }, [shown, ms]);
  const show = useCallback(() => { setUsed((u) => u + 1); setShown(true); }, []);
  const reset = useCallback(() => { setUsed(0); setShown(false); }, []);
  const hide = useCallback(() => setShown(false), []);
  return { shown, used, show, reset, hide };
}

/**
 * Acomodo de los juegos: a la izquierda la cámara (su alto sale del alto de la ventana) con la nota y
 * los botones; a la derecha lo del juego (palabra, tablero, pista, asistencia). Todo cabe sin bajar.
 */
export function GameStage({ camera, side, wide }: { camera: ReactNode; side: ReactNode; wide?: boolean }) {
  // `wide`: con asistencia la cámara se achica un poco y la columna del juego gana espacio.
  return (
    <div className="game-stage" data-wide={wide ? "" : undefined}>
      <div className="game-stage__cam">{camera}</div>
      <div className="game-stage__side">{side}</div>
    </div>
  );
}

type Recognition = ReturnType<typeof useAlphabetRecognition>;

/** Asistencia para una letra: foto (o video si lleva movimiento), tus dedos en vivo y qué corregir. */
export function LetterAssist({ letter, rec, showFingers = true }: { letter: string; rec?: Recognition; showFingers?: boolean }) {
  const hasVideo = !!TUTORIAL[letter];
  const [video, setVideo] = useState(hasVideo && MOTION_LETTERS.has(letter));
  useEffect(() => { setVideo(!!TUTORIAL[letter] && MOTION_LETTERS.has(letter)); }, [letter]);
  const fb = rec?.feedback;
  return (
    <section className="sheet game-assist" aria-label={`Asistencia: cómo se hace la letra ${letter}`}>
      <div className="game-assist__head">
        <h3 className="game-assist__title">🧑‍🏫 Así se hace la <span translate="no">{letter}</span></h3>
        {hasVideo ? (
          <button type="button" className="btn btn--quiet btn--small" onClick={() => setVideo((v) => !v)}>{video ? "Ver foto" : "▶ Ver video"}</button>
        ) : null}
      </div>
      <div className="game-assist__body">
        <div className="game-assist__ref">{video ? <LetterTutorial letter={letter} /> : <LetterReference letter={letter} />}</div>
        {showFingers && rec ? (
          <div className="game-assist__hand">
            <HandDiagram side={rec.side ?? "derecha"} fingers={rec.fingers} caption="Tus dedos" />
          </div>
        ) : null}
      </div>
      {fb && !fb.correct && fb.issue !== "no_hand" ? (
        <p className="game-assist__tip"><IconWarning /><span>{fb.message}</span></p>
      ) : null}
    </section>
  );
}

type LiveMsg = Extract<ServerMsg, { type: "live" }>;

/** Asistencia para una seña: la animación de referencia, tus dedos en vivo y el primer consejo de la toma. */
export function SignAssist({ gloss, live, tip, picker, hands = true }: {
  gloss: string; live?: LiveMsg; tip?: string | null; picker?: ReactNode; hands?: boolean;
}) {
  return (
    <section className="sheet game-assist" aria-label={`Asistencia: cómo se hace la seña ${glossLabel(gloss)}`}>
      <div className="game-assist__head">
        <h3 className="game-assist__title">🧑‍🏫 Así se hace «<span translate="no">{glossLabel(gloss)}</span>»</h3>
      </div>
      {picker}
      <div className="game-assist__body" data-single={hands ? undefined : ""}>
        <div className="game-assist__ref game-assist__ref--sign"><ReferencePlayer gloss={gloss} /></div>
        {hands ? (
          <div className="game-assist__hand game-assist__hand--pair">
            <HandDiagram side="izquierda" fingers={live?.fingers[1] ?? []} />
            <HandDiagram side="derecha" fingers={live?.fingers[0] ?? []} />
          </div>
        ) : null}
      </div>
      {tip ? <p className="game-assist__tip"><IconWarning /><span>{tip}</span></p> : null}
    </section>
  );
}
