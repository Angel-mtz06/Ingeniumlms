import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

const TABS = [
  { id: "inicio", label: "Inicio" },
  { id: "practica", label: "Práctica" },
  { id: "traduccion", label: "Traducción" },
  { id: "calibracion", label: "Calibración" },
  { id: "grabar", label: "Grabar" },
  { id: "diagnostico", label: "Diagnóstico" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function hashTab(): TabId | null {
  const id = window.location.hash.replace("#", "");
  return TABS.some((t) => t.id === id) ? (id as TabId) : null;
}

const tabFromHash = (): TabId => hashTab() ?? "inicio";

export default function App() {
  const [active, setActive] = useState<TabId>(tabFromHash);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    // Solo reacciona a hashes de pestaña; "#contenido" (saltar al contenido) no cambia la pestaña.
    const onHash = () => {
      const id = hashTab();
      if (id) setActive(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = useCallback((id: TabId, focus = false) => {
    setActive(id);
    if (window.location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
    if (focus) tabRefs.current[id]?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(TABS[next].id, true);
  };

  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <h1 className="brand">
            <span className="brand__mark" translate="no">LSM</span>
            <span className="brand__name">Aprende y traduce Lengua de Señas Mexicana</span>
          </h1>
          <div className="tabs" role="tablist" aria-label="Secciones de la aplicación" onKeyDown={onKeyDown}>
            {TABS.map((t) => {
              const selected = t.id === active;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  className="tab"
                  aria-selected={selected}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(t.id)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main id="contenido" className="app-main" tabIndex={-1}>
        {TABS.map((t) => (
          <section
            key={t.id}
            id={`panel-${t.id}`}
            className="panel"
            role="tabpanel"
            aria-labelledby={`tab-${t.id}`}
            hidden={t.id !== active}
          >
            <h2 className="panel__title">{t.label}</h2>
            <p className="panel__body">Esta sección todavía no tiene contenido.</p>
          </section>
        ))}
      </main>
    </>
  );
}
