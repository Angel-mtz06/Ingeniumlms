import { useEffect, useRef, useState } from "react";
import { IconCheck, IconError, IconWarning, ToneIcon } from "../components/icons";
import type { FramePayload } from "../lib/protocol";
import { CalibrationLostNotice, CameraStage, GloveControls, ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

const COUNTDOWN_S = 3;
const RECORD_S = 2;
const RESULT_TIMEOUT_MS = 5000;

const STEPS = [
  { id: "open", title: "Mano abierta", text: "Extiende y separa todos los dedos, con la palma hacia la cámara." },
  { id: "fist", title: "Puño cerrado", text: "Cierra la mano en un puño firme, con el pulgar por fuera." },
  { id: "done", title: "Listo", text: "La app guarda la calibración de cada guante." },
] as const;

type Phase =
  | { kind: "idle" }
  | { kind: "countdown"; step: 0 | 1; left: number }
  | { kind: "recording"; step: 0 | 1; elapsed: number }
  | { kind: "finishing" }
  | { kind: "done"; sides: { L: boolean; R: boolean }; had: { L: boolean; R: boolean } }
  | { kind: "error"; message: string };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Paso activo (0..2) para la lista de pasos; -1 antes de empezar. */
function activeStep(p: Phase): number {
  if (p.kind === "countdown" || p.kind === "recording") return p.step;
  if (p.kind === "finishing" || p.kind === "done") return 2;
  return -1;
}

/**
 * Calibración de guantes en 3 pasos guiados: mano abierta y puño (3 s de cuenta regresiva y 2 s
 * de grabación cada uno) y "Listo". Solo se mandan cuadros al servidor durante los 2 s de cada paso,
 * para que el cambio de postura durante la cuenta regresiva no contamine las muestras.
 */
export function Calibration() {
  const { session, gloves, cameraStatus, calibration } = useApp();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const forwarding = useRef(false);
  const runId = useRef(0);
  const prevCal = useRef<unknown>(null);
  const prevErr = useRef<unknown>(null);
  const had = useRef({ L: false, R: false });

  useFrameSink((f) => {
    if (forwarding.current) session.send(f);
  });

  useEffect(
    () => () => {
      runId.current++;
      forwarding.current = false;
    },
    [],
  );

  // Reconexión del WebSocket: el servidor abrió una sesión nueva sin calibración. Un intento en curso
  // ya no sirve (sus pasos quedaron en la sesión anterior) y un resultado "calibrado" ya no es cierto.
  const generationAtStart = useRef(0);
  const phaseKind = phase.kind;
  useEffect(() => {
    const g = session.generation;
    const running = phaseKind === "countdown" || phaseKind === "recording" || phaseKind === "finishing";
    if (running && generationAtStart.current > 0 && g > 0 && g !== generationAtStart.current) {
      runId.current++;
      forwarding.current = false;
      setPhase({ kind: "error", message: "Se reinició la conexión durante la calibración. Vuelve a calibrar los guantes." });
    }
  }, [session.generation, phaseKind]);
  useEffect(() => {
    if (calibration.lost && phaseKind === "done") setPhase({ kind: "idle" });
  }, [calibration.lost, phaseKind]);

  // Resultado de "calibrate done".
  const cal = session.last.calibration;
  const err = session.last.error;
  useEffect(() => {
    if (phase.kind !== "finishing") return;
    if (cal && cal !== prevCal.current && cal.step === "done" && cal.sides) {
      setPhase({ kind: "done", sides: cal.sides, had: had.current });
    } else if (err && err !== prevErr.current) {
      setPhase({ kind: "error", message: "El servidor no pudo terminar la calibración. Vuelve a empezar." });
    }
  }, [phase.kind, cal, err]);
  useEffect(() => {
    if (phase.kind !== "finishing") return;
    const id = window.setTimeout(
      () => setPhase({ kind: "error", message: "El servidor no respondió a tiempo. Revisa la conexión y vuelve a empezar." }),
      RESULT_TIMEOUT_MS,
    );
    return () => window.clearTimeout(id);
  }, [phase.kind]);

  const start = async () => {
    const id = ++runId.current;
    const alive = () => runId.current === id;
    had.current = { L: gloves.sides.L.connected, R: gloves.sides.R.connected };
    generationAtStart.current = session.generation;
    for (const step of [0, 1] as const) {
      for (let n = COUNTDOWN_S; n > 0; n--) {
        setPhase({ kind: "countdown", step, left: n });
        await sleep(1000);
        if (!alive()) return;
      }
      session.send({ type: "calibrate", step: STEPS[step].id as "open" | "fist" });
      forwarding.current = true;
      // Sin cámara lista no hay cuadros de MediaPipe: se mandan cuadros solo con los guantes.
      const glovesOnly = cameraStatus !== "ready";
      const t0 = performance.now();
      while (performance.now() - t0 < RECORD_S * 1000) {
        setPhase({ kind: "recording", step, elapsed: (performance.now() - t0) / 1000 });
        if (glovesOnly) {
          for (let k = 0; k < 3; k++) {
            const frame: FramePayload = { type: "frame", w: 1280, h: 720, hands: [], pose: null, face: null, gloves: gloves.latest() };
            session.send(frame);
            await sleep(33);
          }
        } else {
          await sleep(100);
        }
        if (!alive()) return;
      }
      forwarding.current = false;
    }
    prevCal.current = session.last.calibration ?? null;
    prevErr.current = session.last.error ?? null;
    setPhase({ kind: "finishing" });
    session.send({ type: "calibrate", step: "done" });
  };

  const cancel = () => {
    runId.current++;
    forwarding.current = false;
    setPhase({ kind: "idle" });
  };

  const noGloves = !gloves.sides.L.connected && !gloves.sides.R.connected;
  const running = phase.kind === "countdown" || phase.kind === "recording" || phase.kind === "finishing";
  // Modo práctica sin seña solo mientras se calibra (el segmentador de traducción no emite señas);
  // abrir la pantalla sin calibrar no vacía las señas pendientes de Traducción.
  useSessionMode("practice", null, running);
  const cur = activeStep(phase);

  // Los avisos sobre el video son solo visuales: el único anuncio accesible es `.calib-status` (abajo).
  const overlay =
    phase.kind === "countdown" ? (
      <p className="overlay-count" aria-hidden="true">
        <span className="overlay-count__n tabular">{phase.left}</span>
        <span>Prepárate: {STEPS[phase.step].title.toLowerCase()}</span>
      </p>
    ) : phase.kind === "recording" ? (
      <div className="overlay-pill overlay-pill--rec" aria-hidden="true">
        <span className="rec-mark" aria-hidden="true" />
        <span>Mantén {STEPS[phase.step].title.toLowerCase()}</span>
        <span className="rec-progress" aria-hidden="true">
          <span className="rec-progress__fill" style={{ inlineSize: `${Math.min(100, (phase.elapsed / RECORD_S) * 100)}%` }} />
        </span>
      </div>
    ) : null;

  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">Calibración de guantes</h2>
        <p className="screen__lead">La app aprende cómo se ven tu mano abierta y tu puño. Hazlo cada vez que te pongas los guantes.</p>
      </header>

      <ServerNotice />
      <CalibrationLostNotice />

      <div className="calib-grid">
        <section className="sheet" aria-labelledby="calib-pasos">
          <h3 id="calib-pasos" className="sheet__title">
            Pasos
          </h3>
          <ol className="steps">
            {STEPS.map((s, i) => {
              const state = i < cur || phase.kind === "done" ? "done" : i === cur ? "current" : "todo";
              return (
                <li key={s.id} className="step" data-state={state} aria-current={state === "current" ? "step" : undefined}>
                  <span className="step__mark" aria-hidden="true">
                    {state === "done" ? <IconCheck size={22} /> : <span className="tabular">{i + 1}</span>}
                  </span>
                  <span className="step__body">
                    <span className="step__title">{s.title}</span>
                    <span className="step__text">{s.text}</span>
                    <span className="visually-hidden">{state === "done" ? " (hecho)" : state === "current" ? " (en curso)" : ""}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          {noGloves && !running ? (
            <div className="notice notice--warn">
              <IconWarning />
              <span>No hay guantes conectados. Conéctalos primero; sin guantes la calibración no guarda nada.</span>
            </div>
          ) : null}

          <div className="sheet__actions">
            {running ? (
              <button type="button" className="btn btn--secondary" onClick={cancel} disabled={phase.kind === "finishing"}>
                Cancelar
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={() => void start()} disabled={!session.connected}>
                {phase.kind === "done" || phase.kind === "error" ? "Calibrar de nuevo" : "Empezar calibración"}
              </button>
            )}
          </div>

          <div className="calib-status" role="status">
            {phase.kind === "countdown" ? (
              <p>
                {STEPS[phase.step].title}: empieza en <span className="tabular">{phase.left}</span>.
              </p>
            ) : phase.kind === "recording" ? (
              <p>{STEPS[phase.step].title}: mantén la postura.</p>
            ) : phase.kind === "finishing" ? (
              <p>Guardando la calibración…</p>
            ) : phase.kind === "error" ? (
              <p className="record-status__bad">
                <IconError />
                <span>{phase.message}</span>
              </p>
            ) : null}
          </div>

          {phase.kind === "done" ? <CalibrationResult sides={phase.sides} had={phase.had} /> : null}
        </section>

        <div className="calib-side">
          <CameraStage>{overlay}</CameraStage>
          <GloveControls compact />
        </div>
      </div>
    </div>
  );
}

function CalibrationResult({ sides, had }: { sides: { L: boolean; R: boolean }; had: { L: boolean; R: boolean } }) {
  const rows = [
    { side: "R" as const, label: "Guante derecho" },
    { side: "L" as const, label: "Guante izquierdo" },
  ];
  return (
    <div className="calib-result">
      <h4 className="calib-result__title">Resultado</h4>
      <ul className="calib-result__list">
        {rows.map(({ side, label }) => {
          const ok = sides[side];
          const tone = ok ? "ok" : had[side] ? "bad" : "warn";
          const text = ok ? "calibrado" : had[side] ? "no se pudo calibrar: faltaron lecturas. Repite la calibración." : "sin conectar, no se calibró";
          return (
            <li key={side} className="calib-result__item" data-tone={tone}>
              <ToneIcon tone={tone} />
              <span>
                <strong>{label}:</strong> {text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
