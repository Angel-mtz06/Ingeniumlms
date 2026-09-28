import { useId } from "react";
import type { Scores } from "../lib/protocol";
import { clampScore, SCORE_PARAMS, scoreTone, TONE_WORD } from "../lib/ui";
import { IconWarning, ToneIcon } from "./icons";
import "./components.css";

export interface ScoreCardProps {
  scores: Scores | Record<string, never>;
  total: number;
  tips: string[];
  /** false: la toma no se pudo calificar (falta una mano o no hay referencia); se muestra el consejo. */
  evaluable?: boolean;
}

/**
 * Resultado de una toma de práctica: total grande con ícono y palabra de estado, cuatro barras
 * (Configuración, Ubicación, Movimiento, Orientación) con su número, y hasta dos correcciones.
 * Si la toma no es evaluable, en lugar de puntajes muestra los consejos como guía.
 */
export function ScoreCard({ scores, total, tips, evaluable = true }: ScoreCardProps) {
  const id = useId();
  const shownTips = tips.slice(0, 2);

  if (!evaluable) {
    return (
      <section className="score score--guide" aria-labelledby={id}>
        <div className="score__guide-head">
          <IconWarning size={28} />
          <h3 id={id} className="score__title">
            Esta toma no se pudo calificar
          </h3>
        </div>
        {shownTips.length > 0 ? (
          <ul className="score__tips score__tips--plain">
            {shownTips.map((t, i) => (
              <li key={`${i}-${t}`}>{t}</li>
            ))}
          </ul>
        ) : (
          <p>Vuelve a hacer la seña con las manos dentro del cuadro.</p>
        )}
      </section>
    );
  }

  const t = clampScore(total);
  const tone = scoreTone(t);
  return (
    <section className="score" aria-labelledby={id}>
      <h3 id={id} className="visually-hidden">
        Resultado
      </h3>
      <div className="score__total" data-tone={tone}>
        <ToneIcon tone={tone} size={40} />
        <p>
          <span className="score__word">{TONE_WORD[tone]}</span>
          <span className="score__number tabular">
            {Math.round(t)}
            <span className="score__of"> de 100</span>
          </span>
        </p>
      </div>

      <dl className="score__bars">
        {SCORE_PARAMS.map(({ key, label }) => {
          const v = clampScore((scores as Partial<Scores>)[key]);
          const vt = scoreTone(v);
          return (
            <div key={key} className="score__row" data-tone={vt}>
              <dt>{label}</dt>
              <dd>
                <span className="score__bar" aria-hidden="true">
                  <span className="score__fill" style={{ inlineSize: `${v}%` }} />
                </span>
                <span className="score__value">
                  <ToneIcon tone={vt} size={18} />
                  <span className="tabular">{Math.round(v)}</span>
                  <span className="visually-hidden"> de 100, {TONE_WORD[vt].toLowerCase()}</span>
                </span>
              </dd>
            </div>
          );
        })}
      </dl>

      {shownTips.length > 0 ? (
        <div className="score__fix">
          <h4 className="score__fix-title">Para mejorar</h4>
          <ul className="score__tips">
            {shownTips.map((tip, i) => (
              <li key={`${i}-${tip}`}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
