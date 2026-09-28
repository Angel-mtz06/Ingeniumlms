import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Glosses } from "../lib/protocol";
import { focusAfterRemove, glossLabel, percent } from "../lib/ui";
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
  /**
   * Avisa cuando se abre o se cierra el panel de corrección (también `false` al desmontar abierto).
   * `onConfirm`/`onRemove` se llaman siempre ANTES del `false` de su cierre.
   */
  onOpenChange?(open: boolean): void;
}

/**
 * Señas reconocidas en orden. Las dudosas (`!confident`) llevan borde punteado, ícono de aviso
 * y la palabra "¿revisar?". Al tocar una etiqueta se abre, debajo, la elección entre sus tres
 * opciones más probables y el botón para quitarla.
 */
export function GlossChips({ items, onConfirm, onRemove, onOpenChange }: GlossChipsProps) {
  const [open, setOpen] = useState<number | null>(null);
  const panelId = useId();
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const firstOption = useRef<HTMLButtonElement | null>(null);
  const regionRef = useRef<HTMLDivElement | null>(null);
  // Quitar es asíncrono (lo confirma el servidor): se recuerda qué se quitó para mover el foco
  // cuando la lista realmente se acorta.
  const pendingFocus = useRef<{ removed: number; prevLength: number } | null>(null);

  useEffect(() => {
    const p = pendingFocus.current;
    if (!p || items.length >= p.prevLength) return;
    pendingFocus.current = null;
    const target = focusAfterRemove(p.removed, items.length);
    const el = target === null ? null : chipRefs.current[target];
    (el ?? regionRef.current)?.focus();
  }, [items.length]);

  // Si la lista cambia y la etiqueta abierta ya no existe, cerrar.
  useEffect(() => {
    if (open !== null && open >= items.length) setOpen(null);
  }, [items.length, open]);

  useEffect(() => {
    if (open !== null) firstOption.current?.focus();
  }, [open]);

  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  const isOpen = open !== null;
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current === isOpen) return;
    reported.current = isOpen;
    openChange.current?.(isOpen);
  }, [isOpen]);
  useEffect(
    () => () => {
      if (reported.current) openChange.current?.(false);
    },
    [],
  );

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

  const current = open !== null ? items[open] : null;

  return (
    // Contenedor enfocable por script: destino estable del foco cuando se quita la última etiqueta.
    <div ref={regionRef} className="chips" role="region" aria-label="Señas reconocidas" tabIndex={-1}>
      {items.length === 0 ? (
        <p className="chips__empty">Todavía no hay señas. Haz una seña frente a la cámara y aparecerá aquí.</p>
      ) : null}
      <ol className="chips__list" hidden={items.length === 0}>
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
                // El foco va al contenedor (estable) y, cuando la lista se acorta, a la etiqueta anterior.
                pendingFocus.current = { removed: i, prevLength: items.length };
                regionRef.current?.focus();
                onRemove(i);
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
