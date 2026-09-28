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

export class GloveSerial {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private last: string | null = null;
  /** Timestamp in ms using performance.now(); compare with performance.now(), not Date.now(). */
  private seen = 0;
  side: "L" | "R" | null = null;

  static supported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  async connect(): Promise<"L" | "R"> {
    try {
      // Clean up any previous connection
      if (this.port) await this.disconnect();

      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 921600 });
      const decoder = new TextDecoderStream();
      this.port.readable!.pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>).catch(() => undefined);
      this.reader = decoder.readable.getReader();
      const writer = this.port.writable!.getWriter();
      await writer.write(new TextEncoder().encode("ID?\n"));
      writer.releaseLock();
      const buf = new LineBuffer();
      const deadline = Date.now() + 3000;
      let resolveSide: (s: "L" | "R") => void = () => {};
      let timeoutId: ReturnType<typeof setTimeout> = 0 as any;
      const got = new Promise<"L" | "R">((res) => (resolveSide = res));

      // Capture reader to detect orphaned loops
      const capturedReader = this.reader;
      const state = { last: this.last, seen: this.seen };
      (async () => {
        while (capturedReader === this.reader) {
          const { value, done } = await capturedReader.read();
          if (done) break;
          for (const line of buf.push(value ?? "")) {
            const id = parseIdLine(line);
            if (id) { this.side = id.side; clearTimeout(timeoutId); resolveSide(id.side); }
            else if (acceptLine(state, line, performance.now())) {
              this.last = state.last;
              this.seen = state.seen;
            }
          }
        }
      })();

      // Create timeout promise and attach a handler before racing
      // to prevent "unhandled rejection" warnings from Vitest/Node
      const timeout = new Promise<never>((_, rej) => {
        timeoutId = setTimeout(() => rej(new Error("El guante no respondió a ID?")), deadline - Date.now());
      });
      // Mark rejection as handled without transforming the promise
      timeout.then(undefined, () => undefined);

      return await Promise.race([got, timeout]);
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  latest(): string | null { return this.last; }
  lastSeenMs(): number { return this.seen; }

  async disconnect(): Promise<void> {
    await this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    await this.port?.close().catch(() => undefined);
    this.port = null;
    this.side = null;
    this.last = null;
    this.seen = 0;
  }
}
