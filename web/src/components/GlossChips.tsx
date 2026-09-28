import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Glosses } from "../lib/protocol";
import { glossLabel, percent } from "../lib/ui";
import { IconWarning } from "./icons";
import "./components.css";

export interface GlossChipItem {
  gloss: string;
  top3: Glosses;
  confident: boolean;
}

export interface GlossChipsProps {
  items: GlossChipItem[];
  onConfirm(i: number, gloss: string): void;
  onRemove(i: number): void;
}

/**
 * Señas reconocidas en orden. Las dudosas (`!confident`) llevan borde punteado, ícono de aviso
 * y la palabra "¿revisar?". Al tocar una etiqueta se abre, debajo, la elección entre sus tres
 * opciones más probables y el botón para quitarla.
 */
export function GlossChips({ items, onConfirm, onRemove }: GlossChipsProps) {
  const [open, setOpen] = useState<number | null>(null);
  const panelId = useId();
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const firstOption = useRef<HTMLButtonElement | null>(null);

  // Si la lista cambia y la etiqueta abierta ya no existe, cerrar.
  useEffect(() => {
    if (open !== null && open >= items.length) setOpen(null);
  }, [items.length, open]);

  useEffect(() => {
    if (open !== null) firstOption.current?.focus();
  }, [open]);

  const close = (focusChip = true) => {
    const i = open;
    setOpen(null);
    if (focusChip && i !== null) requestAnimationFrame(() => chipRefs.current[i]?.focus());
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  if (items.length === 0) {
    return <p className="chips__empty">Todavía no hay señas. Haz una seña frente a la cámara y aparecerá aquí.</p>;
  }

  const current = open !== null ? items[open] : null;

  return (
    <div className="chips">
      <ol className="chips__list" aria-label="Señas reconocidas">
        {items.map((it, i) => (
          <li key={`${i}-${it.gloss}`}>
            <button
              ref={(el) => {
                chipRefs.current[i] = el;
              }}
              type="button"
              className="chip"
              data-confident={it.confident}
              aria-expanded={open === i}
              aria-controls={open === i ? panelId : undefined}
              onClick={() => (open === i ? close(false) : setOpen(i))}
            >
              {it.confident ? null : <IconWarning size={18} />}
              <span className="chip__gloss">{glossLabel(it.gloss)}</span>
              {it.confident ? null : <span className="chip__doubt">¿revisar?</span>}
            </button>
          </li>
        ))}
      </ol>

      {current && open !== null ? (
        <div id={panelId} className="chips__panel" role="group" aria-label={`Opciones para la seña ${open + 1}`} onKeyDown={onPanelKey}>
          <p className="chips__prompt">¿Cuál seña hiciste?</p>
          <div className="chips__options">
            {current.top3.slice(0, 3).map(([g, p], k) => (
              <button
                key={g}
                ref={k === 0 ? firstOption : undefined}
                type="button"
                className="option"
                aria-pressed={g === current.gloss}
                onClick={() => {
                  onConfirm(open, g);
                  close();
                }}
              >
                <span className="option__gloss">{glossLabel(g)}</span>
                <span className="option__p tabular">{percent(p)}</span>
              </button>
            ))}
          </div>
          <div className="chips__actions">
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                const i = open;
                setOpen(null);
                onRemove(i);
                // La etiqueta desaparece: el foco pasa a la anterior (o a la primera).
                requestAnimationFrame(() => chipRefs.current[Math.max(0, i - 1)]?.focus());
              }}
            >
              Quitar esta seña
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => close()}>
              Cerrar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
