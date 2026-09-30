/*
 * wsGlove.ts: guante por WiFi. La pulsera (firmware/pulsera) es un servidor WebSocket en el puerto 81 que manda
 * las mismas líneas que por USB: ID,<L|R>,… al conectarse (y como respuesta a "ID?"), D,<L|R>,… a 50 Hz y
 * CAL,<L|R>,… tras el comando CAL. Misma API que GloveSerial para que useGloves los trate igual.
 */
import { parseCalLine } from "./gyroCal";
import { LineBuffer, parseIdLine } from "./lines";
import { acceptLine, dataLineSide, ID_TIMEOUT_MS } from "./serial";

export const WS_PORT = 81;

/** "pulsera-der.local", "192.168.137.45", "ws://…:81/" → URL del WebSocket de la pulsera (null si está vacía). */
export function gloveUrl(address: string): string | null {
  const a = address.trim();
  if (!a) return null;
  if (/^wss?:\/\//i.test(a)) return a;
  const host = a.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return host.includes(":") && !host.startsWith("[") ? `ws://${host}/` : `ws://${host}:${WS_PORT}/`;
}

export class GloveSocket {
  private ws: WebSocket | null = null;
  private closing = false;
  private identified = false;
  private buf = new LineBuffer();
  private state = { last: null as string | null, seen: 0 };
  side: "L" | "R" | null = null;
  /** Se llama una vez si la conexión se pierde después de identificarse. */
  onLost: (() => void) | null = null;
  /** Cada línea CAL,… (respuesta a la calibración de giroscopios). */
  onCal: ((line: string) => void) | null = null;

  constructor(private readonly factory: (url: string) => WebSocket = (url) => new WebSocket(url)) {}

  /** Se conecta a `address` y espera la identificación (ID o la primera línea D), máximo ID_TIMEOUT_MS. */
  connect(address: string): Promise<"L" | "R"> {
    const url = gloveUrl(address);
    if (!url) return Promise.reject(new Error("Escribe la dirección de la pulsera."));
    this.closing = false;
    this.identified = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.shutdown();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail("La pulsera no respondió por WiFi."), ID_TIMEOUT_MS);
      let ws: WebSocket;
      try {
        ws = this.factory(url);
      } catch {
        fail("La dirección de la pulsera no es válida.");
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        try {
          ws.send("ID?");
        } catch {
          /* el ID llega solo al conectar */
        }
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        for (const line of this.buf.push(ev.data.endsWith("\n") ? ev.data : `${ev.data}\n`)) {
          const side = this.handle(line);
          if (side && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(side);
          }
        }
      };
      ws.onerror = () => fail("No se pudo conectar con la pulsera por WiFi.");
      ws.onclose = () => {
        if (!settled) {
          fail("No se pudo conectar con la pulsera por WiFi.");
          return;
        }
        if (this.closing) return;
        this.shutdown();
        this.onLost?.();
      };
    });
  }

  /** Procesa una línea; devuelve el lado la primera vez que la pulsera se identifica. */
  private handle(line: string): "L" | "R" | null {
    if (parseCalLine(line)) {
      this.onCal?.(line);
      return null;
    }
    const id = parseIdLine(line);
    const side = id ? id.side : dataLineSide(line);
    if (!side) return null;
    let first: "L" | "R" | null = null;
    if (!this.identified) {
      this.identified = true;
      this.side = side;
      first = side;
    }
    if (!id && side === this.side) acceptLine(this.state, line, performance.now());
    return first;
  }

  /** Manda un comando de texto (p. ej. "CAL"). */
  send(command: string) {
    if (!this.ws || this.closing || this.ws.readyState !== 1) return;
    try {
      this.ws.send(command);
    } catch {
      /* conexión cerrándose: onclose avisa */
    }
  }

  latest(): string | null {
    return this.state.last;
  }

  lastSeenMs(): number {
    return this.state.seen;
  }

  private shutdown() {
    this.closing = true;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
    }
  }

  async disconnect(): Promise<void> {
    this.shutdown();
    this.side = null;
    this.identified = false;
    this.state = { last: null, seen: 0 };
    this.buf = new LineBuffer();
  }
}
