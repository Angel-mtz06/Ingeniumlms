import { useCallback, useEffect, useRef, useState } from "react";
import type { FramePayload } from "../lib/protocol";
import { type GyroCal, parseCalLine } from "../lib/gyroCal";
import { GloveSerial } from "../lib/serial";
import { GloveSocket } from "../lib/wsGlove";
import { type GloveState, duplicateGloveMessage, gloveErrorMessage, gloveLostMessage, gloveState, gloveWifiLostMessage, sameGloveState, selectLatest } from "../lib/ui";

export type { GloveState } from "../lib/ui";
export type Side = "L" | "R";
export type Via = "usb" | "wifi";
/** Un guante por USB (Web Serial) o por WiFi (WebSocket de la pulsera): misma API. */
type GloveLink = GloveSerial | GloveSocket;

export interface GlovesHandle {
  supported: boolean;
  sides: { L: GloveState; R: GloveState };
  /** Abre el selector de puertos del navegador; el guante se identifica solo (ID? → L/R). */
  connect(): Promise<void>;
  /** Se conecta por WiFi a la pulsera (nombre .local o IP que muestra su monitor serie). */
  connectWifi(address: string): Promise<void>;
  /** Por dónde está conectado cada guante (null = sin conectar). */
  via: { L: Via | null; R: Via | null };
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
  const ports = useRef<{ L: GloveLink | null; R: GloveLink | null }>({ L: null, R: null });
  const [via, setVia] = useState<{ L: Via | null; R: Via | null }>({ L: null, R: null });
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
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

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

  /** Conecta `glove` con `open` (USB o WiFi) y lo deja listo: lado, CAL y aviso si se pierde. */
  const attach = useCallback(async (glove: GloveLink, open: () => Promise<Side>, how: Via) => {
    setConnecting(true);
    setError(null);
    try {
      const side = await open();
      if (!mounted.current) {
        // El hook se desmontó mientras se conectaba: no guardar un guante huérfano.
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
      setVia((v) => ({ ...v, [side]: how }));
      setSideCal(side, IDLE);
      glove.onCal = (line) => {
        const r = parseCalLine(line);
        if (r && r.side === side && ports.current[side] === glove && mounted.current) setSideCal(side, r.cal);
      };
      // Desenchufado, WiFi caído o error fatal de lectura: el lado vuelve a "sin conectar".
      glove.onLost = () => {
        if (ports.current[side] !== glove) return;
        ports.current[side] = null;
        if (mounted.current) {
          setVia((v) => ({ ...v, [side]: null }));
          setError(how === "wifi" ? gloveWifiLostMessage(side) : gloveLostMessage(side));
          refresh();
        }
      };
    } catch (err) {
      // USB: sin depender del texto de serial.ts (cerrar el selector no es un error). WiFi: el mensaje ya es para la persona.
      if (mounted.current) setError(how === "wifi" ? (err instanceof Error ? err.message : "No se pudo conectar por WiFi.") : gloveErrorMessage(err));
    } finally {
      if (mounted.current) {
        setConnecting(false);
        refresh();
      }
    }
  }, [refresh, setSideCal]);

  const connect = useCallback(async () => {
    if (!supported) {
      setError("Este navegador no permite conectar los guantes por USB. Usa Edge o Chrome en computadora, o conéctalos por WiFi.");
      return;
    }
    const glove = new GloveSerial();
    await attach(glove, () => glove.connect(), "usb");
  }, [supported, attach]);

  const connectWifi = useCallback(async (address: string) => {
    const glove = new GloveSocket();
    await attach(glove, () => glove.connect(address), "wifi");
  }, [attach]);

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
      setVia((v) => ({ ...v, [side]: null }));
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

  return { supported, sides, connect, connectWifi, via, disconnect, connecting, error, latest, gyro, calibrateGyro };
}
