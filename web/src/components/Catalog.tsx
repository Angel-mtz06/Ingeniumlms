import { useDeferredValue, useId, useMemo, useState } from "react";
import { glossLabel, groupVocab, type VocabItem } from "../lib/ui";
import { IconSearch } from "./icons";
import "./components.css";

export type { VocabItem } from "../lib/ui";

export interface CatalogProps {
  /** null mientras se carga /api/vocab. */
  vocab: VocabItem[] | null;
  onPick(gloss: string): void;
  /** Glosa elegida actualmente (se marca con aria-pressed, borde y peso). */
  selected?: string | null;
  error?: string | null;
}

/**
 * Catálogo de señas agrupado por categoría, con búsqueda sin acentos. Las glosas sin
 * referencia llevan borde punteado y el texto "sin referencia" (no solo color).
 */
export function Catalog({ vocab, onPick, selected = null, error = null }: CatalogProps) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const searchId = useId();
  const groups = useMemo(() => groupVocab(vocab ?? [], deferred), [vocab, deferred]);
  const count = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="catalog">
      <div className="field">
        <label className="field__label" htmlFor={searchId}>
          Buscar seña
        </label>
        <div className="field__control">
          <IconSearch />
          <input
            id={searchId}
            className="field__input"
            type="search"
            name="buscar-sena"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ej. hola, familia…"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      {error ? (
        <p className="catalog__msg" role="alert">
          {error}
        </p>
      ) : vocab === null ? (
        <div className="catalog__skeleton" aria-busy="true" aria-label="Cargando señas…">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="skeleton skeleton--chip" />
          ))}
        </div>
      ) : (
        <>
          <p className="catalog__count" role="status">
            {count === 0
              ? query
                ? `No hay señas que coincidan con “${query}”.`
                : "Todavía no hay señas en el catálogo."
              : `${count} ${count === 1 ? "seña" : "señas"}`}
          </p>
          {groups.map((g) => (
            <section key={g.category} className="catalog__group" aria-label={g.category}>
              <h3 className="catalog__heading">{g.category}</h3>
              <ul className="catalog__grid">
                {g.items.map((v) => (
                  <li key={v.gloss}>
                    <button
                      type="button"
                      className="pick"
                      data-ref={v.has_reference}
                      aria-pressed={selected === v.gloss}
                      onClick={() => onPick(v.gloss)}
                    >
                      <span className="pick__gloss">{glossLabel(v.gloss)}</span>
                      {v.has_reference ? null : <span className="pick__note">sin referencia</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
