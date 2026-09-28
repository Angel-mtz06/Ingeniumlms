import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ClientMsg, Mode, ServerMsg } from "../lib/protocol";
import { SessionSocket } from "../lib/socket";
import { wsUrl } from "../lib/ui";

/** Último mensaje recibido de cada tipo, con su tipo exacto. */
export type LastByType = { [K in ServerMsg["type"]]?: Extract<ServerMsg, { type: K }> };

export interface SessionHandle {
  send(m: ClientMsg): boolean;
  last: LastByType;
  connected: boolean;
  /** Mensajes recientes (los más nuevos al final), máximo EVENTS_MAX. */
  events: ServerMsg[];
}

export const EVENTS_MAX = 200;

export type SessionState = { last: LastByType; events: ServerMsg[] };
export type SessionAction = { kind: "msg"; msg: ServerMsg } | { kind: "reset" };

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  if (a.kind === "reset") return { last: {}, events: s.events };
  const events = s.events.length >= EVENTS_MAX ? [...s.events.slice(-(EVENTS_MAX - 1)), a.msg] : [...s.events, a.msg];
  return { last: { ...s.last, [a.msg.type]: a.msg }, events };
}

const POLL_MS = 500;

/**
 * Un SessionSocket a /ws (ws o wss según la página). Envía `hello` cada vez que cambian
 * `mode` o `target` (el socket lo reenvía solo al reconectar) y limpia `last` en ese momento
 * para no mostrar la evaluación de la seña anterior.
 */
export function useSession(mode: Mode, target: string | null): SessionHandle {
  const socketRef = useRef<SessionSocket | null>(null);
  const [state, dispatch] = useReducer(sessionReducer, { last: {}, events: [] });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = new SessionSocket(wsUrl(window.location), (msg) => dispatch({ kind: "msg", msg }));
    socketRef.current = socket;
    const id = window.setInterval(() => setConnected(socket.open), POLL_MS);
    return () => {
      window.clearInterval(id);
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
      setConnected(false);
    };
  }, []);

  useEffect(() => {
    dispatch({ kind: "reset" });
    socketRef.current?.send({ type: "hello", mode, target });
  }, [mode, target]);

  const send = useCallback((m: ClientMsg) => socketRef.current?.send(m) ?? false, []);

  return { send, last: state.last, connected, events: state.events };
}
