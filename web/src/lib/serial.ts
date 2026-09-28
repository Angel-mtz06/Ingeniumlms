import { LineBuffer, parseIdLine } from "./lines";

export class GloveSerial {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private last: string | null = null;
  private seen = 0;
  side: "L" | "R" | null = null;

  static supported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  async connect(): Promise<"L" | "R"> {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 921600 });
    const decoder = new TextDecoderStream();
    this.port.readable!.pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>);
    this.reader = decoder.readable.getReader();
    const writer = this.port.writable!.getWriter();
    await writer.write(new TextEncoder().encode("ID?\n"));
    writer.releaseLock();
    const buf = new LineBuffer();
    const deadline = Date.now() + 3000;
    let resolveSide: (s: "L" | "R") => void = () => {};
    const got = new Promise<"L" | "R">((res) => (resolveSide = res));
    (async () => {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        for (const line of buf.push(value ?? "")) {
          const id = parseIdLine(line);
          if (id) { this.side = id.side; resolveSide(id.side); }
          else if (line.startsWith("D,")) { this.last = line; this.seen = performance.now(); }
        }
      }
    })();
    return Promise.race([got, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("El guante no respondió a ID?")), deadline - Date.now()))]);
  }

  latest(): string | null { return this.last; }
  lastSeenMs(): number { return this.seen; }

  async disconnect(): Promise<void> {
    await this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    await this.port?.close().catch(() => undefined);
    this.port = null;
  }
}
