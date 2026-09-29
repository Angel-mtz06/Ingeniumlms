import { lazy, memo, Suspense, useCallback, useEffect, useState } from "react";
import { Catalog } from "../components/Catalog";
import { HandDiagram } from "../components/HandDiagram";
import { IconWarning, ToneIcon } from "../components/icons";
import { ReferencePlayer } from "../components/ReferencePlayer";
import { ScoreCard } from "../components/ScoreCard";
import { ScoreGauge } from "../components/ScoreGauge";
import { firstTip, gaugeView } from "../lib/gauge";
import { glossLabel, percent } from "../lib/ui";
import { LiveCamera } from "./LiveCamera";
import { CalibrationLostNotice, ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

// Las 121 señas no deben re-renderizarse con cada mensaje `live` (~15 por segundo).
const MemoCatalog = memo(Catalog);

const WARNING_MS = 6000;

/**
 * Práctica: se elige una seña del catálogo; al lado de la referencia animada va la cámara con el
 * puntaje de la última toma en una esquina y el primer consejo debajo (todo en la primera pantalla).
 * Más abajo, el detalle por parámetro y el estado de cada dedo en vivo.
 *
 * Incluye la nueva opción "Practicar Alfabeto" que abre AlphabetPractice.
 */
export function Practice() {
  const { session, vocab, vocabError, go } = useApp();
  const [target, setTarget] = useState<string | null>(null);
  /** "catalog" = vista normal | "alphabet" = practica del alfabeto */
  const [view, setView] = useState<"catalog" | "alphabet">("catalog");

  // En el catálogo no se cambia el modo: así no se pierden las señas pendientes de Traducción.
  useSessionMode("practice", target, target !== null);
  useFrameSink(target ? (f) => session.send(f) : null);

  const pick = useCallback((g: string) => {
    setTarget(g);
    window.scrollTo({ top: 0 });
  }, []);

  // Si el usuario entra al alfabeto, mostramos AlphabetPractice
  if (view === "alphabet") {
    return <Suspense fallback={<p role="status">Cargando práctica del alfabeto...</p>}><AlphabetPractice onBack={() => { setView("catalog"); setTarget(null); }} /></Suspense>;
  }

  if (!target) {
    return (
      <div className="screen">
        <header className="screen__head">
          <h2 className="screen__title">Elige una seña para practicar</h2>
          <p className="screen__lead">Verás cómo se hace y la app te dirá qué corregir en la configuración, ubicación, movimiento y orientación.</p>
        </header>
        <ServerNotice />
        <CalibrationLostNotice onCalibrate={() => go("calibracion")} />

        {/* ── Entrada rápida al Alfabeto ── */}
        <section className="sheet practica-entrada-alfabeto" aria-label="Practica el alfabeto">
          <div className="practica-alfa-info">
            <h3 className="sheet__title">Alfabeto LSM</h3>
            <p className="sheet__hint">
              Practica el alfabeto de la Lengua de Señas Mexicana con cámara en tiempo real,
              referencias fotográficas y reconocimiento experimental de poses.
            </p>
          </div>
          <button
            type="button"
            id="btn-practicar-alfabeto"
            className="btn btn--primary practica-alfa-btn"
            onClick={() => { setTarget(null); setView("alphabet"); window.scrollTo({ top: 0 }); }}
          >
            Practicar Alfabeto →
          </button>
        </section>

        <section className="sheet" aria-label="Catálogo de señas">
          <MemoCatalog vocab={vocab} onPick={pick} error={vocabError} />
        </section>
      </div>
    );
  }

  return <PracticeSession target={target} hasReference={vocab?.find((v) => v.gloss === target)?.has_reference ?? true} onChange={() => setTarget(null)} />;
}


function PracticeSession({ target, hasReference, onChange }: { target: string; hasReference: boolean; onChange(): void }) {
  const { session, go } = useApp();
  const { live, evaluation, warning, ready } = session.last;
  const label = glossLabel(target);
  const canScore = (ready?.target === target ? ready.has_reference : hasReference) !== false;

  // Aviso "no veo tus manos": visible hasta que vuelva a verse una mano o pasen 6 s.
  const [shownWarning, setShownWarning] = useState<string | null>(null);
  useEffect(() => {
    if (!warning) return;
    setShownWarning(warning.message);
    const id = window.setTimeout(() => setShownWarning(null), WARNING_MS);
    return () => window.clearTimeout(id);
  }, [warning]);
  useEffect(() => {
    if (live?.hands.some(Boolean)) setShownWarning(null);
  }, [live]);

  const result = evaluation && evaluation.target === target ? evaluation : null;
  const top = result?.recognized[0];
  const signing = live?.segment === "active";
  const handsSeen = live?.hands.some(Boolean) ?? false;
  const view = gaugeView(result, canScore);
  const tip = firstTip(result);

  return (
    <div className="screen">
      <header className="screen__head screen__head--row">
        <div className="screen__head-text">
          <h2 className="screen__title">
            Practica: <span translate="no">{label}</span>
          </h2>
          <p className="screen__lead">Mira el ejemplo, haz la seña y baja las manos al terminar para ver tu puntaje.</p>
        </div>
        <button type="button" className="btn btn--secondary" onClick={onChange}>
          Elegir otra seña
        </button>
      </header>

      <ServerNotice />
      <CalibrationLostNotice onCalibrate={() => go("calibracion")} />
      {canScore ? null : (
        <p className="notice notice--warn" role="status">
          <IconWarning />
          <span>Esta seña todavía no tiene referencia: puedes verla en el catálogo, pero la app no puede calificarla.</span>
        </p>
      )}

      {/* Primera pantalla: ejemplo y cámara lado a lado; el puntaje va sobre la cámara y el primer consejo justo debajo. */}
      <div className="practice-stage">
        <div className="practice-ref">
          <ReferencePlayer gloss={target} />
        </div>
        <div className="practice-camera">
          <LiveCamera corner={<ScoreGauge view={view} />}>
            {shownWarning ? (
              <p className="overlay-pill overlay-pill--warn" role="alert">
                <IconWarning />
                <span>{shownWarning}</span>
              </p>
            ) : signing ? (
              <p className="overlay-pill" role="status">
                <span className="rec-mark" aria-hidden="true" />
                <span>Leyendo tu seña. Baja las manos al terminar.</span>
              </p>
            ) : null}
          </LiveCamera>
          <div className="practice-note" data-tone={view.kind === "score" ? view.tone : view.kind === "guide" ? "warn" : undefined}>
            {result ? (
              <>
                <p className="practice-note__tip">
                  {view.kind === "score" ? <ToneIcon tone={view.tone} /> : <IconWarning />}
                  <span>
                    {tip ? (
                      <>
                        <strong>{result.evaluable ? "Para mejorar: " : "Para calificarla: "}</strong>
                        {tip}
                      </>
                    ) : !result.evaluable ? (
                      "Vuelve a hacer la seña con las manos dentro del cuadro."
                    ) : view.kind === "score" && view.tone === "ok" ? (
                      "Sin correcciones. Puedes repetirla o elegir otra seña."
                    ) : (
                      "Vuelve a intentarlo mirando el ejemplo."
                    )}
                  </span>
                </p>
                {top ? (
                  <p className="practice-note__meta">
                    La app reconoció: <strong translate="no">{glossLabel(top[0])}</strong>{" "}
                    <span className="tabular">({percent(top[1])})</span>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="practice-note__meta">
                {handsSeen ? "Te veo. Haz la seña cuando quieras." : "Coloca las manos dentro del cuadro para empezar."}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="practice-result">
        <div className="practice-score" aria-live="polite">
          {result ? (
            <ScoreCard scores={result.scores} total={result.total} tips={result.tips} evaluable={result.evaluable} showTotal={false} />
          ) : (
            <section className="sheet sheet--empty" aria-label="Cómo practicar">
              <h3 className="sheet__title">Cómo practicar</h3>
              <ol className="howto">
                <li>Mira la referencia animada.</li>
                <li>Haz la seña frente a la cámara.</li>
                <li>Baja las manos para terminar la toma. Tu puntaje aparece sobre la cámara.</li>
              </ol>
            </section>
          )}
        </div>

        <section className="sheet hands-panel" aria-labelledby="practica-dedos">
          <h3 id="practica-dedos" className="sheet__title">
            Tus dedos en vivo
          </h3>
          {/* El video va en espejo: la mano derecha (slot 0) se ve a la DERECHA de la pantalla, igual aquí. */}
          <div className="hands-panel__pair">
            <HandDiagram side="izquierda" fingers={live?.fingers[1] ?? []} />
            <HandDiagram side="derecha" fingers={live?.fingers[0] ?? []} />
          </div>
        </section>
      </div>
    </div>
  );
}
const AlphabetPractice = lazy(() => import("./AlphabetPractice").then((m) => ({ default: m.AlphabetPractice })));
