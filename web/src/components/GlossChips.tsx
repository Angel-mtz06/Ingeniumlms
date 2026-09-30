import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Glosses } from "../lib/protocol";
import { spelledLabel } from "../lib/spell";
import { validateKey } from "../lib/translate";
import { focusAfterRemove, glossLabel, percent } from "../lib/ui";
import { IconCheck, IconClose, IconWarning } from "./icons";
import "./components.css";

export interface GlossChipItem {
  gloss: string;
  top3: Glosses;
  confident: boolean;
  /** El contexto (la seña anterior) eligió esta glosa sobre el top-1 del clasificador: etiqueta "por contexto". */
  reranked?: boolean;
  /** Palabra deletreada (alfabeto manual): fija, sin candidatas; se muestra letra por letra con "deletreo". */
  spelled?: boolean;
  /** Validada por la persona ("Validar cada seña"). */
  confirmed?: boolean;
  /** Quitada: en "Validar cada seña" se ve tachada; en el modo de etiquetas no se muestra. */
  removed?: boolean;
}

const EMPTY = "…";

export interface GlossChipsProps {
  items: GlossChipItem[];
  /**
   * "Validar cada seña": cada seña muestra sus candidatas como botones grandes (la primera, sugerida) y
   * "Ninguna" para quitarla; teclas 1/2/3, X o Supr y flechas arriba/abajo. Sin él, etiquetas con panel.
   */
  validate?: boolean;
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
export function GlossChips(props: GlossChipsProps) {
  return props.validate ? <ValidateList {...props} /> : <ChipList {...props} />;
}

function ChipList({ items, onConfirm, onRemove, onOpenChange }: GlossChipsProps) {
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
  const shown = items.filter((it) => !it.removed).length;

  return (
    // Contenedor enfocable por script: destino estable del foco cuando se quita la última etiqueta.
    <div ref={regionRef} className="chips" role="region" aria-label="Señas reconocidas" tabIndex={-1}>
      {shown === 0 ? <p className="chips__empty">{EMPTY}</p> : null}
      <ol className="chips__list" hidden={shown === 0}>
        {items.map((it, i) =>
          it.removed ? null : (
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
              <span className="chip__gloss">{it.spelled ? spelledLabel(it.gloss) : glossLabel(it.gloss)}</span>
              {it.spelled ? <span className="chip__tag">deletreo</span> : null}
              {it.reranked ? (
                <span className="chip__tag chip__tag--context" title="Elegida por la seña anterior; toca para ver las otras opciones">
                  por contexto
                </span>
              ) : null}
              {it.confident ? null : <span className="chip__doubt">¿revisar?</span>}
            </button>
          </li>
          ),
        )}
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

const STATE_TEXT = { pending: "sin validar", confirmed: "validada", removed: "quitada" } as const;

/**
 * "Validar cada seña": una fila por seña con sus candidatas (hasta 3, ya ordenadas por contexto y tema).
 * Tocar una la valida (confirm_gloss); "Ninguna" la quita (remove_gloss) y la fila queda tachada.
 * Cada fila es un grupo enfocable: 1/2/3 eligen, X o Supr quitan, flechas arriba/abajo cambian de seña.
 */
function ValidateList({ items, onConfirm, onRemove }: GlossChipsProps) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusRow = (i: number) => rowRefs.current[i]?.focus();

  /** Tras validar, el foco va a la siguiente seña sin validar (o se queda en la fila). */
  const pick = (i: number, gloss: string) => {
    onConfirm(i, gloss);
    const next = items.findIndex((it, k) => k > i && !it.removed && !it.confirmed);
    requestAnimationFrame(() => focusRow(next >= 0 ? next : i));
  };

  const remove = (i: number) => {
    onRemove(i);
    requestAnimationFrame(() => focusRow(i));
  };

  const onRowKey = (i: number, e: KeyboardEvent<HTMLDivElement>) => {
    const a = validateKey(e);
    if (!a) return;
    const it = items[i];
    if (a.kind === "move") {
      const j = i + a.delta;
      if (j < 0 || j >= items.length) return;
      e.preventDefault();
      focusRow(j);
      return;
    }
    if (it.removed) return;
    if (a.kind === "pick" && it.spelled) return;
    if (a.kind === "remove") {
      e.preventDefault();
      remove(i);
      return;
    }
    const cand = candidates(it)[a.n];
    if (!cand) return;
    e.preventDefault();
    pick(i, cand[0]);
  };

  if (items.length === 0) {
    return (
      <div className="chips" role="region" aria-label="Señas reconocidas">
        <p className="chips__empty">{EMPTY}</p>
      </div>
    );
  }

  return (
    <ol className="validate-list" aria-label="Señas reconocidas" translate="no">
      {items.map((it, i) => {
        const state = it.removed ? "removed" : it.confirmed ? "confirmed" : "pending";
        const label = it.spelled ? spelledLabel(it.gloss) : glossLabel(it.gloss);
        return (
          <li key={`${i}-${it.gloss}`} className="validate-item" data-state={state}>
            <div
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className="validate-item__row"
              role="group"
              tabIndex={0}
              aria-label={`${it.spelled ? "Palabra deletreada" : "Seña"} ${i + 1}: ${it.spelled ? it.gloss : label}, ${STATE_TEXT[state]}`}
              aria-keyshortcuts="1 2 3 X Delete ArrowUp ArrowDown"
              onKeyDown={(e) => onRowKey(i, e)}
            >
              <div className="validate-item__head">
                <span className="validate-item__n tabular" aria-hidden="true">
                  {i + 1}
                </span>
                {state === "removed" ? (
                  <span className="validate-item__gloss">
                    <s>{label}</s>
                  </span>
                ) : it.spelled ? (
                  <span className="validate-item__gloss validate-item__gloss--spelled" translate="no">
                    {label}
                  </span>
                ) : null}
                {it.spelled ? <span className="chip__tag">deletreo</span> : null}
                <span className="validate-item__state">
                  {state === "confirmed" ? <IconCheck size={18} /> : state === "removed" ? <IconClose size={18} /> : null}
                  {state === "confirmed" ? "Validada" : state === "removed" ? "Quitada" : "Elige la correcta"}
                </span>
                {it.reranked && state !== "removed" ? (
                  <span className="chip__tag chip__tag--context" title="Elegida por la seña anterior o el tema">
                    por contexto
                  </span>
                ) : null}
              </div>
              {state === "removed" ? null : it.spelled ? (
                <div className="validate-item__options">
                  <button type="button" className="btn btn--quiet validate-remove" aria-keyshortcuts="X Delete" onClick={() => remove(i)}>
                    <IconClose size={18} />
                    Quitar
                  </button>
                </div>
              ) : (
                <div className="validate-item__options">
                  {candidates(it).map(([g, p], k) => {
                    const chosen = !!it.confirmed && g === it.gloss;
                    return (
                      <button
                        key={g}
                        type="button"
                        className="option validate-option"
                        data-suggested={k === 0 || undefined}
                        aria-pressed={chosen}
                        aria-keyshortcuts={String(k + 1)}
                        onClick={() => pick(i, g)}
                      >
                        <span className="validate-option__key tabular" aria-hidden="true">
                          {k + 1}
                        </span>
                        <span className="option__gloss">{glossLabel(g)}</span>
                        <span className="option__p tabular">{percent(p)}</span>
                        {k === 0 ? <span className="validate-option__tag">sugerida</span> : null}
                        {chosen ? <IconCheck size={18} /> : null}
                      </button>
                    );
                  })}
                  <button type="button" className="btn btn--quiet validate-remove" aria-keyshortcuts="X Delete" onClick={() => remove(i)}>
                    <IconClose size={18} />
                    Ninguna
                  </button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Candidatas a mostrar (hasta 3). Sin top3 (glosa corregida por el servidor) queda la glosa actual. */
function candidates(it: GlossChipItem): Glosses {
  const top = it.top3.slice(0, 3);
  return top.length > 0 ? top : [[it.gloss, 1]];
}
