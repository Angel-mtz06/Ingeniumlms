import { useCallback, useEffect, useRef, useState } from "react";
import type { FramePayload } from "../lib/protocol";
import { GloveSerial } from "../lib/serial";
import { type GloveState, gloveErrorMessage, gloveState, sameGloveState, selectLatest } from "../lib/ui";

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
}

const OFF: GloveState = { connected: false, stale: false };
const POLL_MS = 200;

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
      ports.current[side] = glove;
      if (previous && previous !== glove) await previous.disconnect();
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
  }, [supported, refresh]);

  const disconnect = useCallback(
    async (side: Side) => {
      const glove = ports.current[side];
      ports.current[side] = null;
      await glove?.disconnect();
      refresh();
    },
    [refresh],
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

  return { supported, sides, connect, disconnect, connecting, error, latest };
}
