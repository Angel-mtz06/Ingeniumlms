import type { ClientMsg, ServerMsg } from "./protocol";

/**
 * Mensajes que fijan una preferencia de la conexión: se recuerda el último de cada tipo y se reenvía después
 * de `hello` en cada conexión nueva (cada conexión es una Session nueva en el servidor).
 */
const STICKY: readonly ClientMsg["type"][] = ["topic"];

/** Si el WebSocket acumula más de esto sin enviar, los cuadros se descartan (los de control nunca). */
export const MAX_BUFFERED_BYTES = 64 * 1024;

export class SessionSocket {
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private hello: ClientMsg | null = null;
  private sticky = new Map<ClientMsg["type"], ClientMsg>();
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly Impl: typeof WebSocket;
  private readonly retryMs: number;
  private openCount = 0;

  constructor(private url: string, private onMsg: (m: ServerMsg) => void,
              opts: { WebSocketImpl?: typeof WebSocket; retryMs?: number } = {}) {
    this.Impl = opts.WebSocketImpl ?? WebSocket;
    this.retryMs = opts.retryMs ?? 1000;
    this.connect();
  }

  get open(): boolean { return this.ws?.readyState === 1; }

  /**
   * Conexiones abiertas hasta ahora (1 = la primera). Cada conexión es una Session nueva en el
   * servidor, así que un valor > 1 significa que se perdió el estado del servidor (p. ej. la calibración).
   */
  get opens(): number { return this.openCount; }

  private connect() {
    if (this.closed) return;
    const ws = new this.Impl(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.openCount++;
      const pending = [...(this.hello ? [this.hello] : []), ...this.sticky.values(), ...this.queue];
      this.queue = [];
      pending.forEach((m) => ws.send(JSON.stringify(m)));
    };
    ws.onmessage = (e: MessageEvent) => this.onMsg(JSON.parse(String(e.data)) as ServerMsg);
    ws.onclose = () => {
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.retryMs);
      }
    };
  }

  send(m: ClientMsg): boolean {
    if (m.type === "hello") this.hello = m;
    const sticky = STICKY.includes(m.type);
    if (sticky) this.sticky.set(m.type, m);
    if (this.open) {
      // Red lenta: un cuadro viejo no sirve; mejor soltarlo que acumular latencia.
      if (m.type === "frame" && (this.ws!.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) return false;
      this.ws!.send(JSON.stringify(m));
      return true;
    }
    if (m.type !== "frame" && m.type !== "hello" && !sticky) this.queue.push(m);
    return false;
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}
