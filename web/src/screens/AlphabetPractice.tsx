import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LETTERS, MOTION_LETTERS } from "../lib/alphabet";
import { useAlphabetRecognition, type AlphabetMode } from "../hooks/useAlphabetRecognition";
import { HandDiagram } from "../components/HandDiagram";
import { IconWarning, ToneIcon } from "../components/icons";
import { ScoreGauge } from "../components/ScoreGauge";
import { motionBaseLetter, READY_HOLD_MS } from "../lib/alphabetMotion";
import { freeGauge, motionGauge, staticGauge } from "../lib/alphabetView";
import { LiveCamera } from "./LiveCamera";
import {
  CalibrationLostNotice,
  ServerNotice,
  useApp,
  useFrameSink,
  useSessionMode,
} from "./shared";

// Fotografía de la letra dentro del cartel original de SEP, sin alterar la imagen.
const SOURCE = "https://nuevaescuelamexicana.sep.gob.mx/contenido/recurso/34697/";
function LetterReference({ letter }: { letter: string }) {
  const i = [..."ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"].indexOf(letter);
  const row = Math.floor(i / 6), col = i % 6;
  const x = row === 4 ? [342, 546, 748][col] : [44, 246, 447, 647, 848, 1050][col];
  const y = [315, 608, 892, 1181, 1472][row];
  return <figure>
    <svg className="alfa-photo" viewBox={`${x} ${y} 186 260`} role="img" aria-label={`Fotografía LSM: letra ${letter}${MOTION_LETTERS.has(letter) ? ", sigue las flechas de movimiento" : ""}`}>
      <image href="/alphabet/lsm-sep.jpg" width="1280" height="1920" />
    </svg>
    <figcaption className="sheet__hint"><a href={SOURCE} target="_blank" rel="noreferrer">Referencia LSM: SEP / @prende.mx</a> · <a href="/alphabet/lsm-sep.jpg" target="_blank" rel="noreferrer">Ver cartel completo</a></figcaption>
  </figure>;
}

function LetterPicker({ selected, onPick }: { selected: string; onPick(l: string): void }) {
  return (
    <div className="alfa-picker" role="group" aria-label="Selector de letras">
      {LETTERS.map((l) => (
        <button key={l} type="button" className="alfa-picker__btn" aria-pressed={l === selected} onClick={() => onPick(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Pasos de una letra con movimiento, con el estado en vivo de cada uno. */
function MotionSteps({ phase, progress, base, target }: { phase: string; progress: number; base: string | null; target: string }) {
  const at = ["pose", "ready", "moving", "result"].indexOf(phase);
  const step = (i: number, text: ReactNode) => (
    <li className="alfa-steps__item" data-state={at > i ? "done" : at === i ? "now" : "next"}>
      <span className="alfa-steps__mark" aria-hidden="true">{at > i ? "✓" : i + 1}</span>
      <span>{text}</span>
    </li>
  );
  return (
    <ol className="alfa-steps" aria-label="Pasos del movimiento">
      {step(0, <>Pon la mano en la posición inicial{base && base !== target ? <> (forma de la <strong translate="no">{base}</strong>)</> : null} y sostenla {READY_HOLD_MS / 1000} s.</>)}
      {step(1, "Cuando diga «¡Listo!», haz el movimiento cuando quieras, siguiendo las flechas.")}
      {step(2, <>Recorrido: <span className="tabular">{Math.round(progress * 100)} %</span>. Al terminar, deja la mano quieta.</>)}
    </ol>
  );
}

interface AlphabetPracticeProps {
  onBack(): void;
}

/**
 * Práctica del alfabeto con el mismo lenguaje que Práctica de señas: referencia a la izquierda,
 * cámara con el medidor en la esquina y la sugerencia debajo; más abajo, los dedos en vivo.
 * Toda la lógica de análisis vive en lib/ (alphabetFeedback, alphabetMotion, alphabetView).
 */
export function AlphabetPractice({ onBack }: AlphabetPracticeProps) {
  const { session, go, camera, vision } = useApp();

  const [mode, setMode] = useState<AlphabetMode>("sequential");
  const [letterIdx, setLetterIdx] = useState(0);
  const [freeLetter, setFreeLetter] = useState("A");

  const target = mode === "free" ? null : mode === "sequential" ? LETTERS[letterIdx] : freeLetter;

  const [cameraOn, setCameraOn] = useState(false);
  const motion = target !== null && MOTION_LETTERS.has(target);
  const recognition = useAlphabetRecognition(target, mode, cameraOn && camera.ready && !vision.loading && !vision.error);
  const { detected, progress: holdProgress, complete, feedback, fingers, live } = recognition;
  const base = target !== null ? motionBaseLetter(target) : null;
  useSessionMode("practice", target);
  useFrameSink(cameraOn ? (f) => { session.send(f); recognition.onFrame(f); } : null);

  useEffect(() => {
    if (!complete || mode !== "sequential" || letterIdx === LETTERS.length - 1) return;
    const timer = window.setTimeout(() => setLetterIdx((i) => Math.min(i + 1, LETTERS.length - 1)), motion ? 1500 : 600);
    return () => window.clearTimeout(timer);
  }, [complete, mode, target, letterIdx, motion]);

  const correct = complete || (!motion && !!feedback?.correct);
  const prevLetter = useCallback(() => { if (mode === "sequential") setLetterIdx((i) => Math.max(0, i - 1)); }, [mode]);
  const nextLetter = useCallback(() => { if (mode === "sequential") setLetterIdx((i) => Math.min(i + 1, LETTERS.length - 1)); }, [mode]);

  const gauge = mode === "free" ? freeGauge(recognition.stable, feedback)
    : motion ? motionGauge(live, feedback, complete)
      : staticGauge(feedback, recognition.targetShare, holdProgress);

  // Una sola línea bajo la cámara: la sugerencia más importante o el resultado.
  const motionResult = motion ? live?.result ?? null : null;
  const note: { tone?: "ok" | "warn" | "bad"; lead?: string; text: string } | null = (() => {
    if (!cameraOn) return null;
    if (mode === "free") {
      if (recognition.phase === "capturing") return { text: "Siguiendo el movimiento… deja la mano quieta al terminar." };
      if (recognition.phase === "result" && recognition.motionResult) {
        const r = recognition.motionResult;
        return r.prediction ? { tone: "ok", text: `Movimiento compatible con la ${r.prediction[0]} (evaluación experimental).` } : { tone: "warn", lead: "Movimiento: ", text: r.reason };
      }
      return feedback?.type === "capture" ? { tone: "warn", text: feedback.message } : null;
    }
    if (motion) {
      if (live?.phase === "result" && motionResult) {
        return motionResult.issue === "ok" ? { tone: "ok", text: "¡Correcto! Trayectoria y pose compatibles." } : { tone: "warn", lead: "Para mejorar: ", text: motionResult.reason };
      }
      if (live?.phase === "moving") return { text: "Siguiendo tu movimiento… deja la mano quieta al terminar." };
      if (live?.phase === "ready") return { tone: "ok", text: "Posición lista. Realiza el movimiento cuando quieras." };
      if (!feedback || feedback.issue === "no_hand") return { text: "Coloca la mano en la posición inicial." };
      return feedback.correct ? { tone: "ok", text: "Posición correcta. Mantenla un momento…" } : { tone: "warn", lead: "Posición inicial: ", text: feedback.message };
    }
    if (!feedback || feedback.issue === "no_hand") return { text: "Coloca tu mano dentro del cuadro para empezar." };
    if (correct) return { tone: "ok", text: holdProgress >= 1 || complete ? "¡Correcto!" : "¡Bien! Mantén la posición…" };
    return { tone: feedback.type === "capture" ? "warn" : "bad", lead: feedback.type === "capture" ? undefined : "Para mejorar: ", text: feedback.message };
  })();

  return (
    <div className="screen">
      <header className="screen__head screen__head--row">
        <div className="screen__head-text">
          <h2 className="screen__title">Practica el Alfabeto LSM</h2>
          <p className="screen__lead">Mira la referencia, haz la letra frente a la cámara y sigue la sugerencia hasta que quede correcta.</p>
        </div>
        <button type="button" className="btn btn--secondary" onClick={onBack}>Volver a Práctica</button>
      </header>

      <ServerNotice />
      <CalibrationLostNotice onCalibrate={() => go("calibracion")} />

      <div className="alfa-mode-row">
        {(["sequential", "specific", "free"] as AlphabetMode[]).map((m) => (
          <button key={m} type="button" className={`btn ${mode === m ? "btn--primary" : "btn--secondary"}`} aria-pressed={mode === m}
            onClick={() => { setMode(m); if (m === "sequential") setLetterIdx(0); }}>
            {m === "sequential" ? "Secuencial" : m === "specific" ? "Letra específica" : "Libre"}
          </button>
        ))}
      </div>

      {mode === "specific" && (
        <section className="sheet" aria-label="Elige una letra">
          <h3 className="sheet__title">Elige la letra a practicar</h3>
          <LetterPicker selected={freeLetter} onPick={setFreeLetter} />
        </section>
      )}

      {/* Primera pantalla, como Práctica de señas: referencia | cámara con medidor en la esquina y la sugerencia debajo. */}
      <div className="practice-stage">
        <div className="practice-ref">
          {target !== null ? (
            <section className="sheet alfa-ref-panel" aria-label={`Letra objetivo ${target}`}>
              <h3 className="sheet__title">Letra objetivo: <span translate="no">{target}</span></h3>
              <LetterReference letter={target} />
              <p className="sheet__hint">
                {motion
                  ? "Sigue las flechas de la fotografía. No hay cuenta regresiva: la app te sigue en vivo desde la posición inicial hasta que dejas la mano quieta."
                  : "Observa la palma, el pulgar y la orientación de los dedos. Usa una sola mano y mantén la posición 0.8 segundos."}
              </p>
              {mode === "sequential" && (
                <div className="alfa-nav-row">
                  <button type="button" className="btn btn--secondary" onClick={prevLetter} disabled={letterIdx === 0} aria-label="Letra anterior">← Anterior</button>
                  <span className="alfa-nav-progress">Letra {letterIdx + 1} de {LETTERS.length}</span>
                  <button type="button" className="btn btn--secondary" onClick={nextLetter} disabled={letterIdx === LETTERS.length - 1} aria-label="Siguiente letra">Siguiente →</button>
                </div>
              )}
            </section>
          ) : (
            <section className="sheet" aria-label="Reconocimiento libre">
              <h3 className="sheet__title">Reconocimiento libre</h3>
              <p>Haz cualquier letra y mantén la pose. La app muestra la letra más probable y las más parecidas; no te dice cómo corregirla porque no sabe cuál querías hacer.</p>
              <p className="sheet__hint">Si mueves la mano, la app sigue el movimiento hasta que la dejas quieta e intenta reconocer J, Ñ, Q, X o Z.</p>
            </section>
          )}
        </div>

        <div className="practice-camera">
          <button type="button" className="btn btn--secondary" onClick={() => setCameraOn((v) => !v)}>{cameraOn ? "Detener cámara" : "Abrir cámara"}</button>
          {cameraOn ? (
            <LiveCamera corner={<ScoreGauge view={gauge} />}>
              {feedback?.type === "capture" && feedback.issue !== "no_hand" ? (
                <p className="overlay-pill overlay-pill--warn" role="status"><IconWarning /><span>{feedback.message}</span></p>
              ) : (motion && live?.phase === "moving") || recognition.phase === "capturing" ? (
                <p className="overlay-pill" role="status"><span className="rec-mark" aria-hidden="true" /><span>Siguiendo el movimiento…</span></p>
              ) : correct && !complete && holdProgress < 1 ? (
                <p className="overlay-pill" role="status"><span aria-hidden="true">✓</span><span>Mantén la posición…</span></p>
              ) : null}
            </LiveCamera>
          ) : (
            <p className="sheet__hint">{target ? `Abre la cámara para practicar la letra ${target}.` : "Abre la cámara y haz cualquier letra."}</p>
          )}

          {note && (
            <div className="practice-note" data-tone={note.tone} aria-live="polite">
              <p className="practice-note__tip">
                {note.tone ? (note.tone === "ok" ? <ToneIcon tone="ok" /> : <IconWarning />) : null}
                <span>{note.lead ? <strong>{note.lead}</strong> : null}{note.text}</span>
              </p>
              {mode !== "free" && detected && !motion ? (
                <p className="practice-note__meta">
                  La app reconoce: <strong translate="no">{detected[0]}</strong> <span className="tabular">({Math.round(detected[1] * 100)} %)</span>
                </p>
              ) : null}
              {!motion && mode !== "free" && correct && !complete ? (
                <div className="alfa-hold-bar" role="progressbar" aria-label="Tiempo de posición estable" aria-valuenow={Math.round(holdProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="alfa-hold-bar__fill" style={{ width: `${holdProgress * 100}%` }} />
                </div>
              ) : null}
            </div>
          )}
          {complete && mode === "specific" ? <button type="button" className="btn btn--secondary" onClick={recognition.restart}>Repetir letra</button> : null}
          {complete && mode === "sequential" && letterIdx === LETTERS.length - 1 ? <p role="status" className="alfa-feedback__ok">✓ Llegaste al final del alfabeto.</p> : null}
        </div>
      </div>

      <div className="practice-result">
        {mode === "free" ? (
          <section className="sheet" aria-label="Letras más parecidas">
            <h3 className="sheet__title">Letras más parecidas</h3>
            {recognition.ranking.length && feedback?.type !== "capture" ? (
              <ol className="alfa-ranking__list">
                {recognition.ranking.map(([l, share]) => <li key={l}><strong translate="no">{l}</strong> <span className="tabular">{Math.round(share * 100)} %</span></li>)}
              </ol>
            ) : <p className="sheet__hint">Haz una letra frente a la cámara.</p>}
            <p className="sheet__hint">Confianza relativa entre letras, no probabilidad de acierto.</p>
          </section>
        ) : motion && target ? (
          <section className="sheet" aria-label="Cómo va el movimiento">
            <h3 className="sheet__title">Esta letra requiere movimiento</h3>
            <MotionSteps phase={live?.phase ?? "pose"} progress={live?.phase === "result" && live.result?.issue === "ok" ? 1 : live?.progress ?? 0} base={base} target={target} />
            {live?.result ? <p className="sheet__hint tabular">{live.result.frames} cuadros · {(live.result.duration / 1000).toFixed(1)} s · {live.result.activeFrames} con desplazamiento</p> : null}
            <p className="sheet__hint">Evaluación experimental de pose y trayectoria; aún no hay un modelo temporal entrenado con señas completas.</p>
          </section>
        ) : (
          <section className="sheet sheet--empty" aria-label="Cómo practicar">
            <h3 className="sheet__title">Cómo practicar</h3>
            <ol className="howto">
              <li>Mira la fotografía de la letra.</li>
              <li>Hazla frente a la cámara con una sola mano.</li>
              <li>Sigue la sugerencia; los dedos marcados son los que debes corregir.</li>
              <li>Mantén la posición hasta que el medidor diga «¡Correcto!».</li>
            </ol>
          </section>
        )}

        <section className="sheet hands-panel" aria-labelledby="alfa-dedos">
          <h3 id="alfa-dedos" className="sheet__title">Tus dedos en vivo</h3>
          {mode === "free"
            ? <p className="sheet__hint">En modo libre no se marcan dedos: no se sabe qué letra querías hacer.</p>
            : <HandDiagram side="derecha" caption={motion && base ? `Comparada con la ${base} (posición inicial)` : `Comparada con la ${target}`} fingers={fingers} />}
        </section>
      </div>

      {target === "K" && <p className="sheet__hint">En K se evalúa únicamente la pose; el giro que muestra la referencia no se califica.</p>}
      <p className="sheet__hint">Reconocimiento experimental. Confianza relativa, no probabilidad de acierto. Puede confundir letras parecidas (R/U/V, S/T, M/N); no sustituye la revisión de una persona que domine LSM.</p>
    </div>
  );
}
