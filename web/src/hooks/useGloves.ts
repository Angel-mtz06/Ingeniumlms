import { useCallback, useEffect, useRef, useState } from "react";
import type { FramePayload } from "../lib/protocol";
import { type GyroCal, parseCalLine } from "../lib/gyroCal";
import { GloveSerial } from "../lib/serial";
import { type GloveState, duplicateGloveMessage, gloveErrorMessage, gloveLostMessage, gloveState, sameGloveState, selectLatest } from "../lib/ui";

export type { GloveState } from "../lib/ui";
export type Side = "L" | "R";

export interface GlovesHandle {
  supported: boolean;
  sides: { L: GloveState; R: GloveState };
  /** Abre el selector de puertos del navegador; el guante se identifica solo (ID? → L/R). */
  connect(): Promise<void>;
  disconnect(side: Side): Promise<void>;
  connecting: boolean;
  error: string | null;
  /** Última línea cruda de cada guante conectado con datos frescos; null si está sin conectar o sin datos (> 500 ms). */
  latest(): FramePayload["gloves"];
  /** Calibración de giroscopios de cada guante (comando CAL del firmware). */
  gyro: { L: GyroCal; R: GyroCal };
  /** Manda CAL a los guantes conectados: deben quedarse quietos ~2 s; la respuesta llega a `gyro`. */
  calibrateGyro(): void;
}

const OFF: GloveState = { connected: false, stale: false };
const POLL_MS = 200;
const IDLE: GyroCal = { phase: "idle" };
/** Sin respuesta a CAL en este tiempo: firmware viejo (sin el comando) o guante colgado. */
export const CAL_TIMEOUT_MS = 6000;

/**
 * Guantes por Web Serial. Usa solo la API pública de GloveSerial:
 * supported(), connect(), latest(), lastSeenMs() (tiempo de performance.now()) y disconnect().
 * `stale` = conectado pero sin línea nueva en 500 ms.
 */
export function useGloves(): GlovesHandle {
  const supported = GloveSerial.supported();
  const ports = useRef<{ L: GloveSerial | null; R: GloveSerial | null }>({ L: null, R: null });
  const [sides, setSides] = useState<{ L: GloveState; R: GloveState }>({ L: OFF, R: OFF });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gyro, setGyro] = useState<{ L: GyroCal; R: GyroCal }>({ L: IDLE, R: IDLE });
  const calTimers = useRef<{ L: number | null; R: number | null }>({ L: null, R: null });
  const setSideCal = useCallback((side: Side, cal: GyroCal) => {
    setGyro((g) => ({ ...g, [side]: cal }));
    const t = calTimers.current[side];
    if (cal.phase === "ok" || cal.phase === "error") {
      if (t !== null) window.clearTimeout(t);
      calTimers.current[side] = null;
    }
  }, []);

  const refresh = useCallback(() => {
    const now = performance.now();
    const next = {
      L: ports.current.L ? gloveState(true, ports.current.L.lastSeenMs(), now) : OFF,
      R: ports.current.R ? gloveState(true, ports.current.R.lastSeenMs(), now) : OFF,
    };
    setSides((prev) => (sameGloveState(prev.L, next.L) && sameGloveState(prev.R, next.R) ? prev : next));
  }, []);

  // Sondeo ligero del estado: solo re-renderiza cuando algo cambia.
  useEffect(() => {
    if (!supported) return;
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [supported, refresh]);

  // Cerrar puertos al desmontar.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const current = ports.current;
    return () => {
      mounted.current = false;
      void current.L?.disconnect();
      void current.R?.disconnect();
      current.L = null;
      current.R = null;
    };
  }, []);

  const connect = useCallback(async () => {
    if (!supported) {
      setError("Este navegador no permite conectar los guantes. Usa Edge o Chrome en computadora.");
      return;
    }
    setConnecting(true);
    setError(null);
    const glove = new GloveSerial();
    try {
      const side = await glove.connect();
      if (!mounted.current) {
        // El hook se desmontó mientras se abría el puerto: no guardar un guante huérfano.
        await glove.disconnect();
        return;
      }
      const previous = ports.current[side];
      if (previous && previous !== glove) {
        // Dos guantes con el mismo lado: no se reemplaza en silencio al que ya funciona.
        await glove.disconnect();
        setError(duplicateGloveMessage(side));
        return;
      }
      ports.current[side] = glove;
      setSideCal(side, IDLE);
      glove.onCal = (line) => {
        const r = parseCalLine(line);
        if (r && r.side === side && ports.current[side] === glove && mounted.current) setSideCal(side, r.cal);
      };
      // Desenchufado o error fatal de lectura: el lado vuelve a "sin conectar" (reaparece "Conectar").
      glove.onLost = () => {
        if (ports.current[side] !== glove) return;
        ports.current[side] = null;
        if (mounted.current) {
          setError(gloveLostMessage(side));
          refresh();
        }
      };
    } catch (err) {
      // Sin depender del texto de serial.ts: cerrar el selector (NotFoundError) no es un error;
      // permiso, puerto ocupado o falta de respuesta (tiempo agotado) tienen su propio mensaje.
      if (mounted.current) setError(gloveErrorMessage(err));
    } finally {
      if (mounted.current) {
        setConnecting(false);
        refresh();
      }
    }
  }, [supported, refresh, setSideCal]);

  const calibrateGyro = useCallback(() => {
    for (const side of ["L", "R"] as const) {
      const glove = ports.current[side];
      if (!glove) continue;
      setSideCal(side, { phase: "waiting" });
      glove.send("CAL");
      const old = calTimers.current[side];
      if (old !== null) window.clearTimeout(old);
      calTimers.current[side] = window.setTimeout(() => {
        calTimers.current[side] = null;
        if (mounted.current) setSideCal(side, { phase: "error", reason: "sin_respuesta", imu: null });
      }, CAL_TIMEOUT_MS);
    }
  }, [setSideCal]);

  const disconnect = useCallback(
    async (side: Side) => {
      const glove = ports.current[side];
      ports.current[side] = null;
      if (glove) {
        glove.onLost = null;
        glove.onCal = null;
      }
      setSideCal(side, IDLE);
      await glove?.disconnect();
      refresh();
    },
    [refresh, setSideCal],
  );

  const latest = useCallback(
    (): FramePayload["gloves"] => {
      const now = performance.now();
      const { L, R } = ports.current;
      return {
        L: L ? selectLatest(L.latest(), L.lastSeenMs(), now) : null,
        R: R ? selectLatest(R.latest(), R.lastSeenMs(), now) : null,
      };
    },
    [],
  );

  return { supported, sides, connect, disconnect, connecting, error, latest, gyro, calibrateGyro };
}
