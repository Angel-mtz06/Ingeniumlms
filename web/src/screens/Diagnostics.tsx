import { useEffect, useRef, useState } from "react";
import { ToneIcon } from "../components/icons";
import { StatusBar } from "../components/StatusBar";
import { formatAngle, IMU_NAMES, parseGloveLine, SeqRate, type GloveLine } from "../lib/diagnostics";
import { GloveControls, useApp } from "./shared";

const POLL_MS = 200;

interface SideView {
  raw: string | null;
  parsed: GloveLine | null;
  rate: number | null;
}

const EMPTY: SideView = { raw: null, parsed: null, rate: null };

/**
 * Diagnóstico de los guantes: por cada guante, las 6 IMU (pitch, roll y si funcionan según el bit
 * de `status`), los sensores Hall, las líneas por segundo y la línea cruda más reciente.
 * Se interpreta en el navegador solo para mostrarlo; el servidor sigue siendo la fuente de verdad.
 */
export function Diagnostics() {
  const { gloves, session, vision, cameraStatus } = useApp();
  const [view, setView] = useState<{ L: SideView; R: SideView }>({ L: EMPTY, R: EMPTY });
  const meters = useRef({ L: new SeqRate(), R: new SeqRate() });
  const latest = gloves.latest; // función estable del hook

  const viewRef = useRef(view);

  // El medidor tiene estado: se actualiza fuera del updater de setState (StrictMode lo llama dos veces).
  useEffect(() => {
    const id = window.setInterval(() => {
      const lines = latest();
      const now = performance.now();
      const prev = viewRef.current;
      const next = { ...prev };
      for (const side of ["L", "R"] as const) {
        const raw = lines[side];
        if (raw === null) {
          // Sin línea fresca: se conserva la última que se vio, con tasa 0.
          meters.current[side].reset();
          next[side] = { ...prev[side], rate: prev[side].raw ? 0 : null };
          continue;
        }
        const parsed = parseGloveLine(raw);
        const r = parsed ? meters.current[side].push(parsed.seq, now) : null;
        next[side] = { raw, parsed: parsed ?? prev[side].parsed, rate: r ?? prev[side].rate };
      }
      viewRef.current = next;
      setView(next);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [latest]);

  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">Diagnóstico de guantes</h2>
        <p className="screen__lead">Revisa que cada sensor responda antes de una demostración. Mueve los dedos y mira cómo cambian los valores.</p>
      </header>

      <section className="sheet" aria-labelledby="diag-estado">
        <h3 id="diag-estado" className="sheet__title">
          Estado del sistema
        </h3>
        <StatusBar
          camera={cameraStatus}
          gloves={{ L: gloves.sides.L, R: gloves.sides.R, supported: gloves.supported }}
          connected={session.connected}
          fps={vision.fps}
        />
        {vision.delegate ? (
          <p className="sheet__meta">
            Visión con MediaPipe en <strong>{vision.delegate === "GPU" ? "GPU" : "CPU (la GPU no estaba disponible)"}</strong>.
          </p>
        ) : null}
        <GloveControls compact />
      </section>

      <div className="diag-grid">
        <GlovePanel title="Guante derecho" connected={gloves.sides.R.connected} stale={gloves.sides.R.stale} view={view.R} />
        <GlovePanel title="Guante izquierdo" connected={gloves.sides.L.connected} stale={gloves.sides.L.stale} view={view.L} />
      </div>
    </div>
  );
}

function GlovePanel({ title, connected, stale, view }: { title: string; connected: boolean; stale: boolean; view: SideView }) {
  const p = view.parsed;
  const tone = !connected ? null : stale ? "warn" : "ok";
  return (
    <section className="sheet diag-glove" aria-label={title}>
      <header className="diag-glove__head">
        <h3 className="sheet__title">{title}</h3>
        <p className="diag-glove__state" data-tone={tone ?? "off"}>
          {tone ? <ToneIcon tone={tone} size={18} /> : null}
          {!connected ? "sin conectar" : stale ? "sin datos" : "recibiendo datos"}
        </p>
      </header>

      {!connected || !p ? (
        <p className="sheet__hint">
          {!connected ? `Conecta el ${title.toLowerCase()} para ver sus sensores.` : "Esperando la primera línea de datos…"}
        </p>
      ) : (
        <>
          <dl className="diag-kv">
            <div>
              <dt>Líneas por segundo</dt>
              <dd className="tabular">{view.rate ?? "…"}</dd>
            </div>
            <div>
              <dt>Secuencia</dt>
              <dd className="tabular">{p.seq}</dd>
            </div>
          </dl>

          <div className="diag-table-wrap">
            <table className="diag-table">
              <caption className="visually-hidden">Sensores de movimiento (IMU) del {title.toLowerCase()}</caption>
              <thead>
                <tr>
                  <th scope="col">IMU</th>
                  <th scope="col">Pitch</th>
                  <th scope="col">Roll</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {IMU_NAMES.map((name, i) => (
                  <tr key={name} data-tone={p.imuOk[i] ? "ok" : "bad"}>
                    <th scope="row">{name}</th>
                    <td className="tabular">{formatAngle(p.pitch[i])}</td>
                    <td className="tabular">{formatAngle(p.roll[i])}</td>
                    <td>
                      <span className="diag-ok">
                        <ToneIcon tone={p.imuOk[i] ? "ok" : "bad"} size={18} />
                        {p.imuOk[i] ? "funciona" : "falla"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="diag-halls">
            <h4 className="diag-sub">Sensores Hall</h4>
            {p.hall.length === 0 ? (
              <p className="sheet__hint">Este guante no reporta sensores Hall.</p>
            ) : (
              <ol className="diag-hall-list">
                {p.hall.map((h, i) => (
                  <li key={i}>
                    <span className="diag-hall-list__n">H{i + 1}</span>
                    <span className="tabular">{h}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <h4 className="diag-sub">Línea cruda más reciente</h4>
            <code className="diag-raw" translate="no">
              {view.raw}
            </code>
          </div>
        </>
      )}
    </section>
  );
}
