/*
 * shared.tsx: estado de la app que comparten las pantallas. Una sola cámara, un solo MediaPipe,
 * un solo par de guantes y UNA sola sesión WebSocket para toda la app (la calibración de los
 * guantes vive en la sesión del servidor y debe sobrevivir al cambio de pestaña).
 */
import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { CameraView } from "../components/CameraView";
import { IconError, IconGlove, IconWarning, ToneIcon } from "../components/icons";
import type { CameraStatus } from "../components/StatusBar";
import type { CameraHandle } from "../hooks/useCamera";
import type { GlovesHandle } from "../hooks/useGloves";
import type { SessionHandle } from "../hooks/useSession";
import type { VisionHandle } from "../hooks/useVision";
import type { CalibrationState } from "../lib/calibration";
import { type Health, healthWarning, parseHealth } from "../lib/health";
import type { FramePayload, Mode, Topic } from "../lib/protocol";
import type { SavedRecording } from "../lib/record";
import type { TranslateAction, TranslateState } from "../lib/translate";
import type { VocabItem } from "../lib/ui";
import "./screens.css";

export type FrameSink = (f: FramePayload) => void;
export type TabId = "inicio" | "practica" | "traduccion" | "calibracion" | "grabar" | "diagnostico";

export interface SavedTake extends SavedRecording {
  label: string;
}

export interface AppState {
  camera: CameraHandle;
  vision: VisionHandle;
  gloves: GlovesHandle;
  session: SessionHandle;
  cameraStatus: CameraStatus;
  vocab: VocabItem[] | null;
  vocabError: string | null;
  /** Quién recibe cada cuadro de MediaPipe (solo una pantalla a la vez). */
  setFrameSink(fn: FrameSink | null): void;
  setSessionMode(mode: Mode, target: string | null): void;
  translate: TranslateState;
  /** Tema de la conversación en Interpretación (por defecto "todo"); vive en App para sobrevivir al cambio de pestaña. */
  topic: Topic;
  setTopic(topic: Topic): void;
  translateDispatch: Dispatch<TranslateAction>;
  /** Guantes calibrados en la sesión actual del servidor (se pierde al reconectar el WebSocket). */
  calibration: CalibrationState;
  /** Tomas guardadas en esta sesión del navegador (pantalla Grabar). */
  takes: SavedTake[];
  addTake(t: SavedTake): void;
  go(tab: TabId): void;
  /** Última respuesta de /api/health (null = aún no llega o el servidor no responde). */
  health: Health | null;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp fuera de AppContext");
  return ctx;
}

/** Registra la función que recibe los cuadros mientras la pantalla está montada (null = no recibir). */
export function useFrameSink(fn: FrameSink | null) {
  const { setFrameSink } = useApp();
  const ref = useRef(fn);
  ref.current = fn;
  const active = fn !== null;
  useEffect(() => {
    if (!active) return;
    setFrameSink((f) => ref.current?.(f));
    return () => setFrameSink(null);
  }, [active, setFrameSink]);
}

/**
 * Pide a la sesión el modo y la seña de esta pantalla (useSession manda `hello` solo si cambian).
 * Con `enabled = false` no toca el modo: cada `hello` vacía en el servidor las señas pendientes de
 * Traducción, así que solo se cambia de modo cuando la pantalla de verdad lo necesita.
 */
export function useSessionMode(mode: Mode, target: string | null, enabled = true) {
  const { setSessionMode } = useApp();
  useEffect(() => {
    if (enabled) setSessionMode(mode, target);
  }, [mode, target, enabled, setSessionMode]);
}

/** La cámara compartida, con avisos superpuestos (cuenta regresiva, "no veo tus manos"). */
export function CameraStage({ children }: { children?: ReactNode }) {
  const { camera, vision } = useApp();
  return (
    <CameraView
      videoRef={camera.videoRef}
      hands={vision.lastHands}
      loading={!camera.error && !vision.error && (!camera.ready || vision.loading)}
      error={camera.error ?? vision.error}
    >
      {children}
    </CameraView>
  );
}

/** Aviso para quien usa la app sin servidor: todo lo demás depende de él. */
export function ServerNotice() {
  const { session } = useApp();
  // Se muestra solo si la desconexión dura más de 1.5 s: al abrir la app el socket tarda un momento.
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (session.connected) {
      setLate(false);
      return;
    }
    const id = window.setTimeout(() => setLate(true), 1500);
    return () => window.clearTimeout(id);
  }, [session.connected]);
  if (session.connected || !late) return null;
  return (
    <p className="notice notice--bad" role="alert">
      <IconError />
      <span>Sin conexión con el servidor. Revisa que esté encendido; la app se reconecta sola.</span>
    </p>
  );
}

/**
 * Aviso tras una reconexión del WebSocket: el servidor abrió una sesión nueva y los guantes que
 * estaban calibrados ya no lo están. Con `onCalibrate` muestra el botón para ir a calibrar.
 */
export function CalibrationLostNotice({ onCalibrate }: { onCalibrate?: () => void }) {
  const { calibration } = useApp();
  if (!calibration.lost) return null;
  return (
    <div className="notice notice--warn notice--action" role="alert">
      <IconWarning />
      <span className="notice__text">Se reinició la conexión: vuelve a calibrar los guantes. Hasta entonces la app usa solo la cámara.</span>
      {onCalibrate ? (
        <button type="button" className="btn btn--secondary" onClick={onCalibrate}>
          Ir a Calibración
        </button>
      ) : null}
    </div>
  );
}

/**
 * Consulta /api/health al montar y cada vez que el WebSocket se (re)conecta (`generation` cambia):
 * si el servidor se reinició sin modelo, el aviso aparece sin recargar la página.
 */
export function useHealth(generation: number): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/health", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setHealth(parseHealth(await r.json()));
      })
      .catch(() => {
        /* sin servidor: ServerNotice ya lo avisa */
      });
    return () => ctrl.abort();
  }, [generation]);
  return health;
}

/** Aviso visible si el servidor no tiene cargado el modelo de reconocimiento o las referencias. */
export function HealthNotice() {
  const { health } = useApp();
  const text = healthWarning(health);
  if (!text) return null;
  return (
    <p className="notice notice--bad" role="alert">
      <IconError />
      <span>{text}</span>
    </p>
  );
}

/** Carga el vocabulario una vez. */
export function useVocab(): { vocab: VocabItem[] | null; error: string | null; retry(): void } {
  const [state, setState] = useState<{ vocab: VocabItem[] | null; error: string | null; n: number }>({ vocab: null, error: null, n: 0 });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/vocab", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as VocabItem[];
        setState((s) => ({ ...s, vocab: data, error: null }));
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, error: "No se pudo cargar el catálogo de señas. Revisa que el servidor esté encendido y recarga." }));
      });
    return () => ctrl.abort();
  }, [state.n, setState]);
  return { vocab: state.vocab, error: state.error, retry: () => setState((s) => ({ ...s, error: null, n: s.n + 1 })) };
}


/**
 * Conexión de guantes: botón "Conectar guantes" (un guante por vez; se identifica solo como derecho
 * o izquierdo), estado de cada lado con botón para desconectarlo, y el error visible si lo hay.
 * Sin Web Serial (Firefox, Safari, móvil) muestra el texto de que la app funciona solo con cámara.
 */
export function GloveControls({ compact = false }: { compact?: boolean }) {
  const { gloves } = useApp();
  if (!gloves.supported) {
    return (
      <p className="notice notice--info">
        <IconGlove />
        <span>Tu navegador no permite conectar guantes; la app funciona solo con cámara.</span>
      </p>
    );
  }
  // Izquierdo primero: con el video en espejo, lo derecho de la persona queda a la derecha de la pantalla.
  const sides = [
    { side: "L" as const, label: "Guante izquierdo" },
    { side: "R" as const, label: "Guante derecho" },
  ];
  const connectedCount = sides.filter((s) => gloves.sides[s.side].connected).length;
  return (
    <div className={compact ? "gloves gloves--compact" : "gloves"}>
      <div className="gloves__actions">
        {connectedCount === 2 ? null : (
          <button type="button" className="btn btn--secondary" onClick={() => void gloves.connect()} disabled={gloves.connecting}>
            <IconGlove />
            {gloves.connecting ? "Conectando…" : connectedCount === 0 ? "Conectar guantes" : "Conectar otro guante"}
          </button>
        )}
        {compact ? null : <p className="gloves__hint">Conecta cada guante por separado. Se identifica solo como derecho o izquierdo.</p>}
      </div>
      <ul className="gloves__list" hidden={connectedCount === 0}>
        {sides.map(({ side, label }) => {
          const g = gloves.sides[side];
          const tone = !g.connected ? "off" : g.stale ? "warn" : "ok";
          return (
            <li key={side} className="gloves__item" data-tone={tone}>
              {tone === "off" ? <IconGlove style={side === "L" ? { transform: "scaleX(-1)" } : undefined} /> : <ToneIcon tone={tone} />}
              <span className="gloves__name">{label}</span>
              <span className="gloves__state">{!g.connected ? "sin conectar" : g.stale ? "conectado, sin datos" : "conectado"}</span>
              {g.connected ? (
                <button type="button" className="btn btn--quiet gloves__off" onClick={() => void gloves.disconnect(side)}>
                  Desconectar<span className="visually-hidden"> {label.toLowerCase()}</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {gloves.error ? (
        <p className="notice notice--bad" role="alert">
          <IconError />
          <span>{gloves.error}</span>
        </p>
      ) : null}
    </div>
  );
}
