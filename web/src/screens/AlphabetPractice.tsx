import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LETTERS, MOTION_LETTERS } from "../lib/alphabet";
import { useAlphabetRecognition, type AlphabetMode } from "../hooks/useAlphabetRecognition";
import { HandDiagram } from "../components/HandDiagram";
import { IconEye, IconEyeOff, IconWarning, ToneIcon } from "../components/icons";
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

// Fotografía de la letra dentro del cartel original de SEP, sin alterar la imagen. Se muestra en el
// mismo marco que la referencia animada de Práctica (.ref / .ref__stage). Sin controles: la letra
// solo cambia sola al acertar (Secuencial) o desde el selector (Letra específica).
function LetterReference({ letter }: { letter: string }) {
  const i = [..."ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"].indexOf(letter);
  const row = Math.floor(i / 6), col = i % 6;
  const x = row === 4 ? [342, 546, 748][col] : [44, 246, 447, 647, 848, 1050][col];
  const y = [315, 608, 892, 1181, 1472][row];
  return (
    <figure className="ref">
      <div className="ref__stage alfa-ref__stage">
        <svg className="alfa-ref__photo" viewBox={`${x} ${y} 186 260`} preserveAspectRatio="xMidYMid meet" role="img"
          aria-label={`Fotografía LSM: letra ${letter}${MOTION_LETTERS.has(letter) ? ", sigue las flechas de movimiento" : ""}`}>
          <image href="/alphabet/lsm-sep.jpg" width="1280" height="1920" />
        </svg>
      </div>
    </figure>
  );
}

/** Videos de una intérprete (SEBIEN · Indiscapacidad CDMX) para las letras con movimiento. */
const TUTORIAL: Record<string, string> = { J: "j", K: "k", "Ñ": "nn", Q: "q", X: "x", Z: "z" };
function LetterTutorial({ letter }: { letter: string }) {
  return (
    <figure className="ref">
      <div className="ref__stage alfa-ref__stage">
        <video key={letter} className="alfa-ref__video" src={`/alphabet/videos/${TUTORIAL[letter]}.mp4`}
          controls autoPlay muted playsInline loop aria-label={`Video tutorial de la letra ${letter}`} />
      </div>
      <p className="sheet__hint">Video: SEBIEN · Indiscapacidad CDMX</p>
    </figure>
  );
}

type Tone = "ok" | "warn" | "bad";
/** Tarjeta de evaluación bajo la referencia, con el estilo de ScoreCard (encabezado con ícono + puntos). */
function EvaluationCard({ tone, title, items, children }: { tone?: Tone; title: string; items: ReactNode[]; children?: ReactNode }) {
  return (
    <section className="score score--guide alfa-eval" data-tone={tone ?? "off"} aria-live="polite" aria-label="Evaluación">
      <div className="score__guide-head">
        {tone === "ok" ? <ToneIcon tone="ok" size={28} /> : tone ? <IconWarning size={28} /> : null}
        <h3 className="score__title">{title}</h3>
      </div>
      {items.length ? <ul className="score__tips score__tips--plain">{items.map((it, i) => <li key={i}>{it}</li>)}</ul> : null}
      {children}
    </section>
  );
}

function LetterPicker({ selected, done, onPick }: { selected: string; done: ReadonlySet<string>; onPick(l: string): void }) {
  return (
    <div className="alfa-picker" role="group" aria-label="Selector de letras">
      {LETTERS.map((l) => (
        <button key={l} type="button" className="alfa-picker__btn" aria-pressed={l === selected} data-done={done.has(l) || undefined}
          aria-label={done.has(l) ? `${l}, ya la hiciste bien` : l} onClick={() => onPick(l)}>
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

/** Mostrar u ocultar la foto de referencia (como el ejemplo de Práctica), recordado en este navegador. */
const SHOW_REF_KEY = "lsm.alphabet.showReference";
function useShowReference(): [boolean, () => void] {
  const [show, setShow] = useState(() => {
    try { return window.localStorage.getItem(SHOW_REF_KEY) !== "0"; } catch { return true; }
  });
  const toggle = useCallback(() => {
    setShow((v) => {
      try { window.localStorage.setItem(SHOW_REF_KEY, v ? "0" : "1"); } catch { /* solo esta sesión */ }
      return !v;
    });
  }, []);
  return [show, toggle];
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
  const [showRef, toggleRef] = useShowReference();
  const [tutorial, setTutorial] = useState(false);
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

  // Letras que ya salieron bien en esta sesión (se marcan en verde en el selector). Solo depende de
  // `complete`: al cambiar de letra, `complete` sigue en true un render con la letra nueva.
  const [doneLetters, setDoneLetters] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (complete && target) setDoneLetters((prev) => prev.has(target) ? prev : new Set(prev).add(target));
  }, [complete]);

  // Libre: cada vez que se reconoce una letra nueva se agrega a la lista (como ir escribiendo). La
  // misma letra se repite solo si antes se perdió la mano o se reconoció otra. Una letra con
  // movimiento reemplaza a la pose con la que empezó (I→J, N→Ñ, D→Z): esa pose no era otra letra.
  const stableLetter = mode === "free" ? recognition.stable?.[0] ?? null : null;
  const [freeLetters, setFreeLetters] = useState<string[]>([]);
  useEffect(() => {
    if (!stableLetter) return;
    const start = motionBaseLetter(stableLetter);
    setFreeLetters((prev) => start && start !== stableLetter && prev.at(-1) === start
      ? [...prev.slice(0, -1), stableLetter] : [...prev, stableLetter].slice(-60));
  }, [stableLetter]);

  const correct = complete || (!motion && !!feedback?.correct);
  const prevLetter = () => setLetterIdx((i) => Math.max(0, i - 1));
  const nextLetter = () => setLetterIdx((i) => Math.min(i + 1, LETTERS.length - 1));

  const gauge = mode === "free" ? freeGauge(recognition.stable, feedback)
    : motion ? motionGauge(live, feedback, complete)
      : staticGauge(feedback, recognition.targetShare, holdProgress);

  // Una sola línea bajo la cámara: la sugerencia más importante o el resultado.
  const motionResult = motion ? live?.result ?? null : null;
  const note: { tone?: "ok" | "warn" | "bad"; lead?: string; text: string } | null = (() => {
    if (!cameraOn) return null;
    if (mode === "free") {
      if (recognition.phase === "capturing") return { text: "Siguiendo el movimiento… deja la mano quieta al terminar." };
      if (recognition.motionResult) {
        const r = recognition.motionResult;
        return r.prediction ? { tone: "ok", text: `Movimiento compatible con la ${r.prediction[0]} (evaluación experimental).` } : { tone: "warn", lead: "Movimiento de la ", text: r.reason };
      }
      if (feedback?.type === "capture") return { tone: "warn", text: feedback.message };
      // La pose inicial de una letra con movimiento ya se reconoció: avisar que ya puede moverse.
      if (recognition.freeReady) return { tone: "ok", text: `Pose de ${[...recognition.freeReady].join(" / ")} lista: haz el movimiento.` };
      return null;
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

  const reco = detected && !motion ? <>La app reconoce: <strong translate="no">{detected[0]}</strong> <span className="tabular">({Math.round(detected[1] * 100)} %)</span></> : null;
  const staticCard: { tone?: Tone; title: string; items: ReactNode[] } = !cameraOn || !feedback || feedback.issue === "no_hand"
    ? { title: `Haz la letra ${target ?? ""}`, items: ["Mira la fotografía de la letra.", "Hazla frente a la cámara con una sola mano.", "Sigue la sugerencia; los dedos marcados son los que debes corregir."] }
    : correct ? { tone: "ok", title: holdProgress >= 1 || complete ? "¡Correcto!" : "¡Bien! Mantén la posición", items: [reco].filter(Boolean) as ReactNode[] }
      : feedback.type === "capture" ? { tone: "warn", title: "Ajusta la captura", items: [feedback.message] }
        : { tone: "bad", title: "Para mejorar", items: [feedback.message, reco].filter(Boolean) as ReactNode[] };
  const motionCard: { tone?: Tone; title: string; items: ReactNode[] } = live?.phase === "result" && motionResult
    ? motionResult.issue === "ok" ? { tone: "ok", title: "¡Correcto!", items: ["Trayectoria y pose compatibles."] } : { tone: "warn", title: "Para mejorar", items: [motionResult.reason] }
    : live?.phase === "moving" ? { title: "Siguiendo tu movimiento…", items: ["Deja la mano quieta al terminar."] }
      : live?.phase === "ready" ? { tone: "ok", title: "¡Listo!", items: ["Haz el movimiento cuando quieras."] }
        : feedback && !feedback.correct && feedback.issue !== "no_hand" ? { tone: "warn", title: "Posición inicial", items: [feedback.message] }
          : { title: "Esta letra requiere movimiento", items: [] };

  return (
    <div className="screen alfa-screen">
      <header className="screen__head screen__head--row screen__head--compact alfa-head">
        <div className="screen__head-text">
          <h2 className="screen__title">Practica el Alfabeto LSM</h2>
          <p className="screen__lead">Mira la referencia, haz la letra frente a la cámara y sigue la sugerencia hasta que quede correcta.</p>
        </div>
        <div className="alfa-mode-row">
          {(["sequential", "specific", "free"] as AlphabetMode[]).map((m) => (
            <button key={m} type="button" className={`btn ${mode === m ? "btn--primary" : "btn--secondary"}`} aria-pressed={mode === m}
              onClick={() => { setMode(m); if (m === "sequential") setLetterIdx(0); }}>
              {m === "sequential" ? "Secuencial" : m === "specific" ? "Letra específica" : "Libre"}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--change btn--small" onClick={onBack}>Volver a Práctica</button>
      </header>

      <ServerNotice />
      <CalibrationLostNotice onCalibrate={() => go("calibracion")} />

      {mode === "specific" && (
        <section className="sheet" aria-label="Elige una letra">
          <h3 className="sheet__title">Elige la letra a practicar</h3>
          <LetterPicker selected={freeLetter} done={doneLetters} onPick={setFreeLetter} />
        </section>
      )}

      {/* Como Práctica: la cámara con el medidor en la esquina y la sugerencia debajo; al lado, el
          ejemplo plegable y los dedos en vivo. */}
      <div className="practice-stage">
        <div className="practice-camera">
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
            <div className="alfa-camera-off">
              <p>{target ? `Abre la cámara para practicar la letra ${target}.` : "Abre la cámara y haz cualquier letra."}</p>
              <button type="button" className="btn btn--primary" onClick={() => setCameraOn(true)}>Abrir cámara</button>
            </div>
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
          {mode === "sequential" || cameraOn ? (
            <div className="alfa-cam-actions">
              {mode === "sequential" ? (
                <div className="alfa-letter-nav" role="group" aria-label="Cambiar de letra">
                  <button type="button" className="btn btn--secondary" onClick={prevLetter} disabled={letterIdx === 0}>← Anterior</button>
                  <span className="alfa-letter-nav__pos tabular" aria-live="polite">{letterIdx + 1} / {LETTERS.length}</span>
                  <button type="button" className="btn btn--secondary" onClick={nextLetter} disabled={letterIdx === LETTERS.length - 1}>Saltar letra →</button>
                </div>
              ) : null}
              {cameraOn ? <button type="button" className="btn btn--secondary alfa-camera-stop" onClick={() => setCameraOn(false)}>Detener cámara</button> : null}
            </div>
          ) : null}
          {complete && mode === "specific" ? <button type="button" className="btn btn--secondary" onClick={recognition.restart}>Repetir letra</button> : null}
          {complete && mode === "sequential" && letterIdx === LETTERS.length - 1 ? <p role="status" className="alfa-feedback__ok">✓ Llegaste al final del alfabeto.</p> : null}
        </div>
        <div className="practice-side">
          {target !== null ? (
            <section className="sheet practice-ref" aria-labelledby="alfa-ejemplo" data-open={showRef}>
              <div className="practice-ref__head">
                <h3 id="alfa-ejemplo" className="practice-ref__title">
                  {tutorial && TUTORIAL[target] ? "Tutorial" : "Ejemplo"}: <span translate="no">{target}</span>
                  {mode === "sequential" ? <span className="tabular"> · {letterIdx + 1} / {LETTERS.length}</span> : null}
                </h3>
                {TUTORIAL[target] ? (
                  <button type="button" className="btn btn--primary btn--small alfa-tutorial-btn" aria-pressed={tutorial}
                    onClick={() => { if (!showRef) toggleRef(); setTutorial((v) => !v); }}>
                    {tutorial ? "Ver foto" : "▶ Tutorial"}
                  </button>
                ) : null}
                <button type="button" className="eye-toggle" onClick={toggleRef} aria-expanded={showRef} aria-controls="alfa-ejemplo-cuerpo"
                  aria-label={showRef ? "Ocultar ejemplo" : "Mostrar ejemplo"} title={showRef ? "Ocultar ejemplo" : "Mostrar ejemplo"}>
                  {showRef ? <IconEye /> : <IconEyeOff />}
                </button>
              </div>
              <div id="alfa-ejemplo-cuerpo" hidden={!showRef}>
                {showRef ? (tutorial && TUTORIAL[target] ? <LetterTutorial letter={target} /> : <LetterReference letter={target} />) : null}
              </div>
            </section>
          ) : (
            <section className="sheet alfa-free-letters" aria-labelledby="alfa-detectadas">
              <div className="alfa-free-letters__head">
                <h3 id="alfa-detectadas" className="sheet__title">Letras detectadas</h3>
                {freeLetters.length ? <button type="button" className="btn btn--secondary btn--small" onClick={() => setFreeLetters([])}>Borrar</button> : null}
              </div>
              {freeLetters.length ? (
                <p className="alfa-free-letters__text" translate="no" aria-live="polite">
                  {freeLetters.map((l, i) => <span key={i} data-last={i === freeLetters.length - 1 || undefined}>{l}</span>)}
                </p>
              ) : (
                <p className="sheet__hint">Aún no hay letras. Haz una frente a la cámara y mantén la pose.</p>
              )}
            </section>
          )}
          <section className="sheet hands-panel" aria-labelledby="alfa-dedos">
            <h3 id="alfa-dedos" className="sheet__title">Tus dedos en vivo</h3>
            {/* Igual que Práctica: el video va en espejo, la mano derecha se ve a la DERECHA. */}
            <div className="hands-panel__pair">
              <HandDiagram side="izquierda" fingers={recognition.side === "izquierda" ? fingers : []} />
              <HandDiagram side="derecha" fingers={recognition.side === "derecha" ? fingers : []} />
            </div>
          </section>
        </div>
      </div>

      <div className="practice-result">
        {mode === "free" ? (
          <EvaluationCard tone={recognition.stable ? "ok" : undefined} title={recognition.stable ? `Letra detectada: ${recognition.stable[0]}` : "Letras más parecidas"}
            items={recognition.ranking.length && feedback?.type !== "capture"
              ? recognition.ranking.map(([l, share]) => <><strong translate="no">{l}</strong> <span className="tabular">{Math.round(share * 100)} %</span></>)
              : [feedback?.type === "capture" ? feedback.message : "Haz una letra frente a la cámara."]}>
            <p className="sheet__hint">Confianza relativa entre letras, no probabilidad de acierto.</p>
            <p className="sheet__hint">J, Ñ, Q, X y Z: sostén un momento la pose inicial (J desde I, Ñ desde N, Z desde D) y luego haz el movimiento.</p>
          </EvaluationCard>
        ) : motion && target ? (
          <EvaluationCard {...motionCard}>
            <MotionSteps phase={live?.phase ?? "pose"} progress={live?.phase === "result" && live.result?.issue === "ok" ? 1 : live?.progress ?? 0} base={base} target={target} />
            {live?.result ? <p className="sheet__hint tabular">{live.result.frames} cuadros · {(live.result.duration / 1000).toFixed(1)} s · {live.result.activeFrames} con desplazamiento</p> : null}
            <p className="sheet__hint">Evaluación experimental de pose y trayectoria; aún no hay un modelo temporal entrenado con señas completas.</p>
          </EvaluationCard>
        ) : (
          <EvaluationCard {...staticCard} />
        )}
      </div>

      {target === "K" && <p className="sheet__hint">En K se evalúa únicamente la pose; el giro que muestra la referencia no se califica.</p>}
      <p className="sheet__hint">Reconocimiento experimental. Confianza relativa, no probabilidad de acierto. Puede confundir letras parecidas (R/U/V, S/T, M/N); no sustituye la revisión de una persona que domine LSM.</p>
    </div>
  );
}
