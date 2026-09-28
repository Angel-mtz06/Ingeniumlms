import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import type { CameraStatus } from "./components/StatusBar";
import { useCamera } from "./hooks/useCamera";
import { useGloves } from "./hooks/useGloves";
import { useSession } from "./hooks/useSession";
import { useVision } from "./hooks/useVision";
import type { FramePayload, Mode, ServerMsg } from "./lib/protocol";
import { newEvents, TRANSLATE_INITIAL, translateReducer } from "./lib/translate";
import { Calibration } from "./screens/Calibration";
import { Diagnostics } from "./screens/Diagnostics";
import { Home } from "./screens/Home";
import { Practice } from "./screens/Practice";
import { RecordScreen } from "./screens/Record";
import { AppContext, useVocab, type AppState, type FrameSink, type SavedTake, type TabId } from "./screens/shared";
import { Translate } from "./screens/Translate";

const TABS: readonly { id: TabId; label: string; camera: boolean }[] = [
  { id: "inicio", label: "Inicio", camera: false },
  { id: "practica", label: "Práctica", camera: true },
  { id: "traduccion", label: "Traducción", camera: true },
  { id: "calibracion", label: "Calibración", camera: true },
  { id: "grabar", label: "Grabar", camera: true },
  { id: "diagnostico", label: "Diagnóstico", camera: false },
];

const SCREENS: Record<TabId, () => JSX.Element> = {
  inicio: Home,
  practica: Practice,
  traduccion: Translate,
  calibracion: Calibration,
  grabar: RecordScreen,
  diagnostico: Diagnostics,
};

function hashTab(): TabId | null {
  const id = window.location.hash.replace("#", "");
  return TABS.some((t) => t.id === id) ? (id as TabId) : null;
}

const tabFromHash = (): TabId => hashTab() ?? "inicio";

export default function App() {
  const [active, setActive] = useState<TabId>(tabFromHash);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // ---------- Estado compartido: una cámara, un MediaPipe, unos guantes, una sesión ----------
  const camera = useCamera();
  const gloves = useGloves();
  const sinkRef = useRef<FrameSink | null>(null);
  const onFrame = useCallback((f: FramePayload) => sinkRef.current?.(f), []);
  // En Inicio y Diagnóstico nadie usa los cuadros: MediaPipe se pausa (la cámara sigue abierta).
  const usesCamera = TABS.find((t) => t.id === active)?.camera ?? false;
  const vision = useVision(camera.videoRef, camera.ready, onFrame, gloves.latest, undefined, !usesCamera);
  const [sessionMode, setSessionModeState] = useState<{ mode: Mode; target: string | null }>({ mode: "translate", target: null });
  const session = useSession(sessionMode.mode, sessionMode.target);
  const { vocab, error: vocabError } = useVocab();
  const [translate, translateDispatch] = useReducer(translateReducer, TRANSLATE_INITIAL);
  const [takes, setTakes] = useState<SavedTake[]>([]);

  // Las etiquetas y la oración de Traducción se derivan de todos los mensajes, aunque la pestaña no esté abierta.
  const lastSeen = useRef<ServerMsg | null>(null);
  useEffect(() => {
    const fresh = newEvents(session.events, lastSeen.current);
    if (fresh.length === 0) return;
    lastSeen.current = fresh[fresh.length - 1];
    for (const msg of fresh) translateDispatch({ kind: "msg", msg });
  }, [session.events]);

  const setFrameSink = useCallback((fn: FrameSink | null) => {
    sinkRef.current = fn;
  }, []);
  const setSessionMode = useCallback((mode: Mode, target: string | null) => {
    setSessionModeState((prev) => (prev.mode === mode && prev.target === target ? prev : { mode, target }));
  }, []);
  const addTake = useCallback((t: SavedTake) => setTakes((prev) => [t, ...prev]), []);

  const cameraStatus: CameraStatus = camera.error || vision.error ? "error" : camera.ready && !vision.loading ? "ready" : "loading";

  const select = useCallback((id: TabId, focus = false) => {
    setActive(id);
    if (window.location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
    if (focus) tabRefs.current[id]?.focus();
  }, []);

  /** Navegación desde un botón de una pantalla: cambia de pestaña y lleva el foco al panel nuevo. */
  const go = useCallback(
    (id: TabId) => {
      select(id);
      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => document.getElementById(`panel-${id}`)?.focus({ preventScroll: true }));
    },
    [select],
  );

  const ctx: AppState = useMemo(
    () => ({
      camera,
      vision,
      gloves,
      session,
      cameraStatus,
      vocab,
      vocabError,
      setFrameSink,
      setSessionMode,
      translate,
      translateDispatch,
      takes,
      addTake,
      go,
    }),
    [camera, vision, gloves, session, cameraStatus, vocab, vocabError, setFrameSink, setSessionMode, translate, takes, addTake, go],
  );

  useEffect(() => {
    // Solo reacciona a hashes de pestaña; "#contenido" (saltar al contenido) no cambia la pestaña.
    const onHash = () => {
      const id = hashTab();
      if (id) setActive(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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

  const activeTab = TABS.find((t) => t.id === active)!;
  const Screen = SCREENS[active];

  return (
    <AppContext.Provider value={ctx}>
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
            className="screen-panel"
            role="tabpanel"
            aria-labelledby={`tab-${t.id}`}
            hidden={t.id !== active}
            tabIndex={-1}
          >
            {/* Solo se monta la pantalla activa: sus bucles de dibujo y temporizadores se detienen al salir. */}
            {t.id === active ? <Screen /> : null}
          </section>
        ))}
        {/* Sin CameraView en pantalla, un <video> oculto mantiene la cámara reproduciendo (estado veraz en la barra). */}
        {activeTab.camera ? null : <video ref={camera.videoRef} hidden muted playsInline aria-hidden="true" />}
      </main>
    </AppContext.Provider>
  );
}
