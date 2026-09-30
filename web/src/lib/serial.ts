import { parseCalLine } from "./gyroCal";
import { LineBuffer, parseIdLine } from "./lines";

/** Pure helper for testing: accepts a new line if it's new data or updates state. */
export function acceptLine(
  state: { last: string | null; seen: number },
  line: string,
  now: number
): boolean {
  if (!line.startsWith("D,")) return false;
  if (line === state.last) return false; // ignore repeat
  state.last = line;
  state.seen = now;
  return true;
}

/** Campos mínimos de una línea D (igual que el servidor): D, lado, seq, t, 12 ángulos, 3 giro, status. */
export const DATA_BASE_FIELDS = 20;
const INT_RE = /^\d+$/;

/**
 * Lado de una línea de datos `D,<L|R>,seq,t_ms,…,status` bien formada; null si no lo es
 * (línea parcial, basura del arranque del ESP32, otro mensaje).
 */
export function dataLineSide(line: string): "L" | "R" | null {
  const p = line.split(",");
  if (p[0] !== "D" || (p[1] !== "L" && p[1] !== "R") || p.length < DATA_BASE_FIELDS) return null;
  if (!INT_RE.test(p[2]) || !INT_RE.test(p[3])) return null;
  return p[1];
}

/**
 * Bytes del puerto → texto. Solo conserva ASCII imprimible y "\n": el protocolo es ASCII y así
 * la basura (arranque del ESP32 a otra velocidad, bytes corruptos) no ensucia las líneas.
 */
export function asciiText(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a || (b >= 0x20 && b <= 0x7e)) out += String.fromCharCode(b);
  }
  return out;
}

const NON_FATAL = new Set(["FramingError", "BufferOverrunError", "BreakError", "ParityError"]);

/** Errores de Web Serial tras los que se puede seguir leyendo (port.readable se recrea). */
export function isNonFatalSerialError(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  return NON_FATAL.has(name);
}

/** Tiempo para identificarse: el ESP32 se reinicia al abrir el puerto y tarda en responder. */
export const ID_TIMEOUT_MS = 5000;
/** Cada cuánto se repite "ID?" mientras el guante no se identifica. */
export const ID_RETRY_MS = 500;

export class GloveSerial {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private loop: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private closing = false;
  private identified = false;
  private onPortDisconnect: ((e: Event) => void) | null = null;
  private last: string | null = null;
  /** Timestamp in ms using performance.now(); compare with performance.now(), not Date.now(). */
  private seen = 0;
  side: "L" | "R" | null = null;
  /**
   * Se llama una vez si la conexión se pierde después de identificarse (guante desconectado
   * físicamente o error de lectura fatal). Cuando se llama, el puerto ya quedó cerrado.
   */
  onLost: (() => void) | null = null;
  /** Cada línea CAL,… del guante (respuesta al comando CAL: calibración de giroscopios). */
  onCal: ((line: string) => void) | null = null;

  static supported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  /**
   * Abre el selector de puertos y se identifica: manda "ID?" cada 500 ms hasta recibir
   * `ID,<L|R>,…` o la primera línea `D,<L|R>,…` válida (lo que llegue primero), máximo 5 s.
   */
  async connect(): Promise<"L" | "R"> {
    // Clean up any previous connection
    if (this.port) await this.disconnect();
    this.closing = false;
    this.identified = false;
    let retry: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const port = await navigator.serial.requestPort();
      this.port = port;
      await port.open({ baudRate: 921600, bufferSize: 8192 });

      let resolveSide: (s: "L" | "R") => void = () => {};
      let rejectSide: (e: Error) => void = () => {};
      const got = new Promise<"L" | "R">((res, rej) => {
        resolveSide = res;
        rejectSide = rej;
      });
      got.then(undefined, () => undefined); // manejado: el rechazo se lee en el race de abajo

      this.loop = this.readLoop(
        port,
        (side) => {
          this.identified = true;
          this.side = side;
          resolveSide(side);
        },
        () => rejectSide(new Error("El guante se desconectó")),
      );

      this.sendId(port);
      retry = setInterval(() => this.sendId(port), ID_RETRY_MS);
      const timeout = new Promise<never>((_, rej) => {
        timeoutId = setTimeout(() => rej(new Error("El guante no respondió a ID?")), ID_TIMEOUT_MS);
      });
      timeout.then(undefined, () => undefined);

      const side = await Promise.race([got, timeout]);
      this.watchUnplug(port);
      return side;
    } catch (err) {
      await this.disconnect();
      throw err;
    } finally {
      if (retry !== null) clearInterval(retry);
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  /** Escribe "ID?\n" (escrituras encadenadas: nunca dos writers a la vez). */
  private sendId(port: SerialPort) {
    if (this.identified || this.closing || port !== this.port) return;
    this.write(port, "ID?\n", () => this.identified);
  }

  /** Manda un comando de texto al guante ya identificado (p. ej. "CAL"). */
  send(command: string) {
    if (!this.port || !this.identified || this.closing) return;
    this.write(this.port, `${command}\n`, () => false);
  }

  private write(port: SerialPort, text: string, skip: () => boolean) {
    this.writing = this.writing.then(async () => {
      const w = port.writable;
      if (!w || w.locked || this.closing || skip()) return;
      const writer = w.getWriter();
      try {
        await writer.write(new TextEncoder().encode(text));
      } catch {
        /* ID? se reintenta en el siguiente intervalo; CAL lo repite la persona */
      } finally {
        writer.releaseLock();
      }
    });
  }

  /**
   * Bucle de lectura estándar de Web Serial. Los errores no fatales (framing, overrun, break,
   * paridad) solo descartan la línea en curso y se sigue leyendo del nuevo `port.readable`;
   * cualquier otro error (p. ej. el guante se desconectó) termina la lectura.
   */
  private async readLoop(port: SerialPort, onSide: (s: "L" | "R") => void, onDeadBeforeId: () => void): Promise<void> {
    let buf = new LineBuffer();
    let dropPartial = false;
    const state = { last: this.last, seen: this.seen };
    const handle = (line: string) => {
      if (dropPartial) {
        dropPartial = false; // resto de una línea cortada por el error
        return;
      }
      if (parseCalLine(line)) {
        this.onCal?.(line);
        return;
      }
      const id = parseIdLine(line);
      if (id) {
        if (!this.identified) onSide(id.side);
        return;
      }
      const side = dataLineSide(line);
      if (!side) return;
      if (!this.identified) onSide(side);
      if (side !== this.side) return;
      if (acceptLine(state, line, performance.now())) {
        this.last = state.last;
        this.seen = state.seen;
      }
    };

    let fatal = false;
    while (port.readable && !this.closing) {
      const reader = port.readable.getReader();
      this.reader = reader;
      let ended = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            ended = true;
            break;
          }
          if (value) for (const line of buf.push(asciiText(value))) handle(line);
        }
      } catch (err) {
        if (isNonFatalSerialError(err)) {
          buf = new LineBuffer();
          dropPartial = true;
        } else {
          fatal = true;
        }
      } finally {
        reader.releaseLock();
        if (this.reader === reader) this.reader = null;
      }
      if (fatal || ended) break;
    }
    if (this.closing) return;
    // La lectura terminó sin que se pidiera cerrar: el guante se perdió.
    if (!this.identified) onDeadBeforeId();
    else void this.lost();
  }

  /** Evento `disconnect` de navigator.serial (guante desenchufado) para este puerto. */
  private watchUnplug(port: SerialPort) {
    const serial = navigator.serial as unknown as EventTarget | undefined;
    if (!serial?.addEventListener) return;
    const fn = (e: Event) => {
      if (e.target === port) void this.lost();
    };
    this.onPortDisconnect = fn;
    serial.addEventListener("disconnect", fn);
  }

  private async lost(): Promise<void> {
    if (this.closing || !this.port) return;
    const cb = this.onLost;
    await this.disconnect();
    cb?.();
  }

  latest(): string | null { return this.last; }
  lastSeenMs(): number { return this.seen; }

  async disconnect(): Promise<void> {
    this.closing = true;
    const serial = typeof navigator !== "undefined" ? (navigator.serial as unknown as EventTarget | undefined) : undefined;
    if (this.onPortDisconnect && serial?.removeEventListener) serial.removeEventListener("disconnect", this.onPortDisconnect);
    this.onPortDisconnect = null;
    await this.reader?.cancel().catch(() => undefined);
    await this.loop?.catch(() => undefined);
    this.loop = null;
    this.reader = null;
    // Una escritura colgada (guante desenchufado) no debe impedir cerrar el puerto.
    let wait: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      this.writing.catch(() => undefined),
      new Promise<void>((r) => {
        wait = setTimeout(r, 300);
      }),
    ]);
    if (wait !== null) clearTimeout(wait);
    await this.port?.close().catch(() => undefined);
    this.port = null;
    this.side = null;
    this.identified = false;
    this.last = null;
    this.seen = 0;
  }
}
