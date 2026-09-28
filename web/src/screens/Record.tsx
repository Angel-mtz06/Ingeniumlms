import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { IconCheck, IconError } from "../components/icons";
import { canonicalGloss, labelError, NONE_LABEL, saveRecording, signerError } from "../lib/record";
import { Recorder } from "../lib/recorder";
import { glossLabel } from "../lib/ui";
import { CameraStage, ServerNotice, useApp, useFrameSink } from "./shared";

const SIGNER_KEY = "lsm.persona";
const COUNTDOWN_S = 3;
const TAKE_S = 3;
const NONE_S = 10;
const FPS = 30;

type Phase =
  | { kind: "idle" }
  | { kind: "countdown"; left: number; label: string; seconds: number }
  | { kind: "recording"; elapsed: number; label: string; seconds: number }
  | { kind: "saving"; label: string }
  | { kind: "saved"; label: string; sampleId: string; frames: number }
  | { kind: "error"; message: string };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function readSigner(): string {
  try {
    return localStorage.getItem(SIGNER_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Grabar: tomas propias para ampliar el dataset. Cuenta regresiva de 3 s y 3 s de grabación
 * (90 cuadros); también 10 s de NINGUNA (reposo y movimientos que no son seña).
 */
export function RecordScreen() {
  const { vocab, cameraStatus, takes, addTake } = useApp();
  const [label, setLabel] = useState("");
  const [signer, setSigner] = useState(readSigner);
  const [tried, setTried] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const recRef = useRef<Recorder | null>(null);
  const runId = useRef(0);
  const ids = { label: useId(), signer: useId(), list: useId(), labelErr: useId(), signerErr: useId(), labelHelp: useId() };

  useFrameSink((f) => recRef.current?.add(f));

  // Al salir de la pantalla se cancela cualquier toma en curso.
  useEffect(
    () => () => {
      runId.current++;
      recRef.current?.stop();
      recRef.current = null;
    },
    [],
  );

  const busy = phase.kind === "countdown" || phase.kind === "recording" || phase.kind === "saving";
  const cameraReady = cameraStatus === "ready";
  const lErr = tried ? labelError(label) : null;
  const sErr = tried ? signerError(signer) : null;
  const current = canonicalGloss(label);
  const countFor = (g: string) => takes.filter((t) => t.label === g).length;

  const run = async (rawLabel: string, seconds: number) => {
    const id = ++runId.current;
    const alive = () => runId.current === id;
    const gloss = canonicalGloss(rawLabel);
    const person = signer.trim();
    try {
      localStorage.setItem(SIGNER_KEY, person);
    } catch {
      /* sin almacenamiento */
    }
    for (let n = COUNTDOWN_S; n > 0; n--) {
      setPhase({ kind: "countdown", left: n, label: gloss, seconds });
      await sleep(1000);
      if (!alive()) return;
    }
    const rec = new Recorder(seconds * FPS);
    recRef.current = rec;
    rec.start();
    const t0 = performance.now();
    while (rec.recording && performance.now() - t0 < seconds * 1000) {
      setPhase({ kind: "recording", elapsed: (performance.now() - t0) / 1000, label: gloss, seconds });
      await sleep(100);
      if (!alive()) {
        rec.stop();
        return;
      }
    }
    const frames = rec.stop();
    recRef.current = null;
    if (frames.length === 0) {
      setPhase({ kind: "error", message: "No se capturó ningún cuadro. Revisa que la cámara funcione y vuelve a grabar." });
      return;
    }
    setPhase({ kind: "saving", label: gloss });
    try {
      const saved = await saveRecording(gloss, person, frames);
      if (!alive()) return;
      addTake({ ...saved, label: gloss });
      setPhase({ kind: "saved", label: gloss, sampleId: saved.sample_id, frames: saved.frames });
    } catch (err) {
      if (alive()) setPhase({ kind: "error", message: err instanceof Error ? err.message : "No se pudo guardar la grabación." });
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    const le = labelError(label);
    const se = signerError(signer);
    if (le || se) {
      document.getElementById(le ? ids.label : ids.signer)?.focus();
      return;
    }
    void run(label, TAKE_S);
  };

  const recordNone = () => {
    setTried(true);
    if (signerError(signer)) {
      document.getElementById(ids.signer)?.focus();
      return;
    }
    void run(NONE_LABEL, NONE_S);
  };

  const cancel = () => {
    runId.current++;
    recRef.current?.stop();
    recRef.current = null;
    setPhase({ kind: "idle" });
  };

  // Avisos sobre el video solo visuales: el anuncio accesible es `.record-status` (el contador de
  // décimas de segundo no debe leerse 10 veces por segundo).
  const overlay =
    phase.kind === "countdown" ? (
      <p className="overlay-count" aria-hidden="true">
        <span className="overlay-count__n tabular">{phase.left}</span>
        <span>Prepárate: {glossLabel(phase.label)}</span>
      </p>
    ) : phase.kind === "recording" ? (
      <div className="overlay-pill overlay-pill--rec" aria-hidden="true">
        <span className="rec-mark" aria-hidden="true" />
        <span>
          Grabando {glossLabel(phase.label)}: <span className="tabular">{Math.min(phase.elapsed, phase.seconds).toFixed(1)}</span> de {phase.seconds} s
        </span>
        <span className="rec-progress" aria-hidden="true">
          <span className="rec-progress__fill" style={{ inlineSize: `${Math.min(100, (phase.elapsed / phase.seconds) * 100)}%` }} />
        </span>
      </div>
    ) : null;

  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">Grabar tomas nuevas</h2>
        <p className="screen__lead">Cada toma se guarda en el servidor para entrenar el modelo. Graba varias repeticiones de cada seña.</p>
      </header>

      <ServerNotice />

      <div className="record-grid">
        <CameraStage>{overlay}</CameraStage>

        <form className="sheet record-form" onSubmit={onSubmit} noValidate aria-labelledby="grabar-form">
          <h3 id="grabar-form" className="sheet__title">
            Datos de la toma
          </h3>

          <div className="form-field">
            <label className="field__label" htmlFor={ids.label}>
              Glosa
            </label>
            <input
              id={ids.label}
              className="text-input"
              name="glosa"
              list={ids.list}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Ej. HOLA…"
              aria-invalid={lErr ? true : undefined}
              aria-describedby={`${ids.labelHelp}${lErr ? ` ${ids.labelErr}` : ""}`}
              disabled={busy}
            />
            <datalist id={ids.list}>
              <option value={NONE_LABEL}>Ninguna seña (reposo)</option>
              {(vocab ?? []).map((v) => (
                <option key={v.gloss} value={v.gloss} />
              ))}
            </datalist>
            <p id={ids.labelHelp} className="form-field__help">
              Elige una del catálogo o escribe una nueva. {current && !labelError(label) ? `Se guardará como ${current}.` : ""}
            </p>
            {lErr ? (
              <p id={ids.labelErr} className="form-field__error">
                <IconError size={18} />
                {lErr}
              </p>
            ) : null}
          </div>

          <div className="form-field">
            <label className="field__label" htmlFor={ids.signer}>
              Persona
            </label>
            <input
              id={ids.signer}
              className="text-input"
              name="persona"
              value={signer}
              onChange={(e) => setSigner(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Ej. ana-lopez…"
              aria-invalid={sErr ? true : undefined}
              aria-describedby={sErr ? ids.signerErr : undefined}
              disabled={busy}
            />
            {sErr ? (
              <p id={ids.signerErr} className="form-field__error">
                <IconError size={18} />
                {sErr}
              </p>
            ) : (
              <p className="form-field__help">Letras sin acento, números y guiones, sin espacios.</p>
            )}
          </div>

          <div className="sheet__actions">
            {busy && phase.kind !== "saving" ? (
              <button type="button" className="btn btn--secondary" onClick={cancel}>
                Cancelar
              </button>
            ) : (
              <>
                <button type="submit" className="btn btn--primary" disabled={busy || !cameraReady}>
                  Grabar
                </button>
                <button type="button" className="btn btn--secondary" onClick={recordNone} disabled={busy || !cameraReady}>
                  Grabar 10 s de NINGUNA
                </button>
              </>
            )}
          </div>
          {cameraReady ? null : <p className="form-field__help">Para grabar, la cámara tiene que estar lista.</p>}

          <div className="record-status" role="status">
            {phase.kind === "countdown" ? (
              <p>
                Empieza en <span className="tabular">{phase.left}</span>. Prepárate para {glossLabel(phase.label)} ({phase.seconds} s).
              </p>
            ) : phase.kind === "recording" ? (
              <p>Grabando {glossLabel(phase.label)}…</p>
            ) : phase.kind === "saving" ? (
              <p>Guardando la toma…</p>
            ) : phase.kind === "saved" ? (
              <p className="record-status__ok">
                <IconCheck />
                <span>
                  Guardada como <code translate="no">{phase.sampleId}</code> ({phase.frames} cuadros). Llevas{" "}
                  <strong className="tabular">{countFor(phase.label)}</strong> {countFor(phase.label) === 1 ? "toma" : "tomas"} de {glossLabel(phase.label)}.
                </span>
              </p>
            ) : phase.kind === "error" ? (
              <p className="record-status__bad">
                <IconError />
                <span>{phase.message}</span>
              </p>
            ) : current && !labelError(label) ? (
              <p>
                {countFor(current) === 0 ? `Aún no hay tomas de ${glossLabel(current)} en esta sesión.` : `Llevas ${countFor(current)} ${countFor(current) === 1 ? "toma" : "tomas"} de ${glossLabel(current)} en esta sesión.`}
              </p>
            ) : null}
          </div>
        </form>
      </div>

      <section className="sheet" aria-labelledby="grabar-tomas">
        <h3 id="grabar-tomas" className="sheet__title">
          Tomas de esta sesión
        </h3>
        {takes.length === 0 ? (
          <p className="sheet__hint">Todavía no has guardado tomas. Aparecerán aquí con su identificador.</p>
        ) : (
          <>
            <ul className="take-counts" aria-label="Repeticiones por glosa">
              {[...new Set(takes.map((t) => t.label))].map((g) => (
                <li key={g} className="take-count">
                  <span translate="no">{glossLabel(g)}</span>
                  <strong className="tabular">{countFor(g)}</strong>
                </li>
              ))}
            </ul>
            <ol className="take-list" aria-label="Últimas tomas guardadas">
              {takes.slice(0, 8).map((t) => (
                <li key={t.sample_id}>
                  <code translate="no">{t.sample_id}</code>
                  <span className="take-list__frames tabular">{t.frames} cuadros</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
