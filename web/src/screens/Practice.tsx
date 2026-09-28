import { memo, useCallback, useEffect, useState } from "react";
import { Catalog } from "../components/Catalog";
import { HandDiagram } from "../components/HandDiagram";
import { IconWarning } from "../components/icons";
import { ReferencePlayer } from "../components/ReferencePlayer";
import { ScoreCard } from "../components/ScoreCard";
import { glossLabel, percent } from "../lib/ui";
import { CameraStage, ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

// Las 121 señas no deben re-renderizarse con cada mensaje `live` (~15 por segundo).
const MemoCatalog = memo(Catalog);

const WARNING_MS = 6000;

/**
 * Práctica: se elige una seña del catálogo; al lado de la referencia animada va la cámara, abajo
 * la calificación de la última toma y el estado de cada dedo en vivo.
 */
export function Practice() {
  const { session, vocab, vocabError } = useApp();
  const [target, setTarget] = useState<string | null>(null);

  useSessionMode("practice", target);
  useFrameSink(target ? (f) => session.send(f) : null);

  const pick = useCallback((g: string) => {
    setTarget(g);
    window.scrollTo({ top: 0 });
  }, []);

  if (!target) {
    return (
      <div className="screen">
        <header className="screen__head">
          <h2 className="screen__title">Elige una seña para practicar</h2>
          <p className="screen__lead">Verás cómo se hace y la app te dirá qué corregir en la configuración, ubicación, movimiento y orientación.</p>
        </header>
        <ServerNotice />
        <section className="sheet" aria-label="Catálogo de señas">
          <MemoCatalog vocab={vocab} onPick={pick} error={vocabError} />
        </section>
      </div>
    );
  }

  return <PracticeSession target={target} hasReference={vocab?.find((v) => v.gloss === target)?.has_reference ?? true} onChange={() => setTarget(null)} />;
}

function PracticeSession({ target, hasReference, onChange }: { target: string; hasReference: boolean; onChange(): void }) {
  const { session } = useApp();
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

  return (
    <div className="screen">
      <header className="screen__head screen__head--row">
        <div className="screen__head-text">
          <h2 className="screen__title">
            Practica: <span translate="no">{label}</span>
          </h2>
          <p className="screen__lead">Mira el ejemplo, haz la seña frente a la cámara y baja las manos al terminar para recibir tu calificación.</p>
        </div>
        <button type="button" className="btn btn--secondary" onClick={onChange}>
          Elegir otra seña
        </button>
      </header>

      <ServerNotice />
      {canScore ? null : (
        <p className="notice notice--warn" role="status">
          <IconWarning />
          <span>Esta seña todavía no tiene referencia: puedes verla en el catálogo, pero la app no puede calificarla.</span>
        </p>
      )}

      <div className="practice-stage">
        <ReferencePlayer gloss={target} />
        <div className="practice-camera">
          <CameraStage>
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
          </CameraStage>
          <p className="stage-caption">
            {handsSeen ? "Te veo. Haz la seña cuando quieras." : "Coloca las manos dentro del cuadro para empezar."}
          </p>
        </div>
      </div>

      <div className="practice-result">
        <div className="practice-score" aria-live="polite">
          {result ? (
            <>
              <ScoreCard scores={result.scores} total={result.total} tips={result.tips} evaluable={result.evaluable} />
              {top ? (
                <p className="recognized">
                  La app reconoció: <strong translate="no">{glossLabel(top[0])}</strong>{" "}
                  <span className="tabular">({percent(top[1])})</span>
                </p>
              ) : null}
            </>
          ) : (
            <section className="sheet sheet--empty" aria-label="Calificación">
              <h3 className="sheet__title">Tu calificación aparecerá aquí</h3>
              <ol className="howto">
                <li>Mira la referencia animada.</li>
                <li>Haz la seña frente a la cámara.</li>
                <li>Baja las manos para terminar la toma.</li>
              </ol>
            </section>
          )}
        </div>

        <section className="sheet hands-panel" aria-labelledby="practica-dedos">
          <h3 id="practica-dedos" className="sheet__title">
            Tus dedos en vivo
          </h3>
          <div className="hands-panel__pair">
            <HandDiagram side="derecha" fingers={live?.fingers[0] ?? []} />
            <HandDiagram side="izquierda" fingers={live?.fingers[1] ?? []} />
          </div>
        </section>
      </div>
    </div>
  );
}
