import { describe, expect, it, vi, test } from "vitest";
import { acceptLine, asciiText, dataLineSide, GloveSerial, isNonFatalSerialError } from "./serial";

describe("acceptLine", () => {
  it("actualiza seen con una línea D nueva", () => {
    const state = { last: null, seen: 0 };
    const now = 100;
    const result = acceptLine(state, "D,L,1,2,3", now);
    expect(result).toBe(true);
    expect(state.last).toBe("D,L,1,2,3");
    expect(state.seen).toBe(100);
  });

  it("ignora repeticiones idénticas", () => {
    const state = { last: "D,R,1,2", seen: 50 };
    const now = 200;
    const result = acceptLine(state, "D,R,1,2", now);
    expect(result).toBe(false);
    expect(state.seen).toBe(50); // no cambió
  });

  it("no modifica last/seen para líneas ID", () => {
    const state = { last: null, seen: 0 };
    const now = 100;
    const result = acceptLine(state, "ID,L,fw=1.0,imus=6,halls=8", now);
    expect(result).toBe(false);
    expect(state.last).toBeNull();
    expect(state.seen).toBe(0);
  });
});

describe("GloveSerial", () => {
  test(
    "cierra puerto y desconecta en timeout de ID",
    async () => {
      vi.useFakeTimers();
      const closeSpy = vi.fn().mockResolvedValue(undefined);

      // Mock TextDecoderStream: su readable cierra inmediatamente
      class FakeTextDecoderStream {
        readable = new ReadableStream<string>({
          start: (controller: ReadableStreamDefaultController<string>) => {
            controller.close();
          },
        });
        writable = new WritableStream<Uint8Array>();
      }

      const fakePort = {
        open: vi.fn().mockResolvedValue(undefined),
        close: closeSpy,
        readable: new ReadableStream<Uint8Array>({
          start: () => {},
        }),
        writable: new WritableStream<Uint8Array>(),
      } as any;

      vi.stubGlobal("navigator", {
        serial: {
          requestPort: vi.fn().mockResolvedValue(fakePort),
        },
      });

      // @ts-ignore
      globalThis.TextDecoderStream = FakeTextDecoderStream;

      const glove = new GloveSerial();
      const connectPromise = glove.connect();

      // Adjuntar el manejador ANTES de avanzar los temporizadores: el rechazo
      // ocurre durante runAllTimersAsync, así que si se adjunta después,
      // Node ya lo marcó como "unhandled".
      const settled = connectPromise.then(
        () => null,
        (err: unknown) => err
      );

      // Ejecutar todos los timers
      await vi.runAllTimersAsync();

      // Capturar rechazo
      const rejectError = await settled;

      // Verificar
      expect(rejectError).toBeInstanceOf(Error);
      expect((rejectError as Error).message).toBe("El guante no respondió a ID?");
      expect(closeSpy).toHaveBeenCalled();

      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    },
    { timeout: 10000 }
  );
});

// ---------- Robustez (I1): fakes de SerialPort con lecturas controladas ----------

const enc = new TextEncoder();
/** Línea D válida (20 campos base + 2 Hall) del lado indicado. */
const dLine = (side: "L" | "R", seq: number) =>
  ["D", side, seq, seq * 10, ...Array.from({ length: 12 }, (_, i) => (i + 0.25).toFixed(2)), "0.1", "0.2", "0.3", "512", "513", "63"].join(",");

interface FakeStream {
  stream: ReadableStream<Uint8Array>;
  push(s: string | Uint8Array): void;
  fail(name: string): void;
  errored: boolean;
}

function fakeStream(): FakeStream {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const fs: FakeStream = {
    stream: new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c; } }),
    push: (s) => ctrl.enqueue(typeof s === "string" ? enc.encode(s) : s),
    fail: (name) => {
      fs.errored = true;
      ctrl.error(Object.assign(new Error(name), { name }));
    },
    errored: false,
  };
  return fs;
}

function fakePort(nStreams = 1) {
  const streams = Array.from({ length: nStreams }, fakeStream);
  const writes: string[] = [];
  const dec = new TextDecoder();
  const port = {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    get readable() {
      return streams.find((s) => !s.errored)?.stream ?? null;
    },
    writable: new WritableStream<Uint8Array>({ write: (chunk) => { writes.push(dec.decode(chunk)); } }),
  };
  return { port, streams, writes };
}

/** Deja correr microtareas (lecturas de streams) sin avanzar el reloj falso. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

function stubSerial(port: unknown) {
  const listeners: ((e: { target: unknown }) => void)[] = [];
  vi.stubGlobal("navigator", {
    serial: {
      requestPort: vi.fn().mockResolvedValue(port),
      addEventListener: vi.fn((_t: string, fn: (e: { target: unknown }) => void) => listeners.push(fn)),
      removeEventListener: vi.fn(),
    },
  });
  return listeners;
}

describe("GloveSerial robusto", () => {
  test("abre a 921600 con bufferSize 8192 y reenvía ID? cada 500 ms hasta identificarse", async () => {
    vi.useFakeTimers();
    try {
      const { port, streams, writes } = fakePort();
      stubSerial(port);
      const glove = new GloveSerial();
      const p = glove.connect();
      const settled = p.then((s) => s, (e: unknown) => e);
      await flush();
      expect(port.open).toHaveBeenCalledWith({ baudRate: 921600, bufferSize: 8192 });
      expect(writes).toEqual(["ID?\n"]);
      await vi.advanceTimersByTimeAsync(1600);
      expect(writes.length).toBe(4);
      streams[0].push("ID,R,fw=1.0,imus=6,halls=2\n");
      await flush();
      expect(await settled).toBe("R");
      await vi.advanceTimersByTimeAsync(2000);
      expect(writes.length).toBe(4);
      await glove.disconnect();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  test("se identifica con el lado de la primera línea D válida e ignora basura no ASCII", async () => {
    vi.useFakeTimers();
    try {
      const { port, streams } = fakePort();
      stubSerial(port);
      const glove = new GloveSerial();
      const settled = glove.connect().then((s) => s, (e: unknown) => e);
      await flush();
      // Cola de una línea anterior + bytes basura del arranque del ESP32 + una línea válida.
      streams[0].push("3,0.5,63\n");
      streams[0].push(new Uint8Array([0xff, 0xfe, 0x00, 0x80]));
      streams[0].push(dLine("L", 7) + "\r\n");
      await flush();
      expect(await settled).toBe("L");
      expect(glove.side).toBe("L");
      expect(glove.latest()).toBe(dLine("L", 7));
      await glove.disconnect();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  test("un error no fatal (BreakError) no detiene la lectura", async () => {
    vi.useFakeTimers();
    try {
      const { port, streams } = fakePort(2);
      stubSerial(port);
      const glove = new GloveSerial();
      const lost = vi.fn();
      glove.onLost = lost;
      const settled = glove.connect().then((s) => s, (e: unknown) => e);
      await flush();
      streams[0].push("ID,R,fw=1.0,imus=6,halls=2\n" + dLine("R", 1) + "\n" + dLine("R", 2).slice(0, 20));
      await flush();
      expect(await settled).toBe("R");
      streams[0].fail("BreakError");
      await flush();
      // Tras el error llega el resto de la línea cortada (se descarta) y luego una línea completa.
      streams[1].push(dLine("R", 2).slice(20) + "\n" + dLine("R", 3) + "\n");
      await flush();
      expect(glove.latest()).toBe(dLine("R", 3));
      expect(lost).not.toHaveBeenCalled();
      expect(port.close).not.toHaveBeenCalled();
      await glove.disconnect();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  test("un error fatal de lectura o el evento disconnect avisan con onLost y cierran el puerto", async () => {
    vi.useFakeTimers();
    try {
      // Error fatal (el dispositivo se perdió).
      const a = fakePort();
      stubSerial(a.port);
      const g1 = new GloveSerial();
      const lost1 = vi.fn();
      g1.onLost = lost1;
      const s1 = g1.connect().then((s) => s, (e: unknown) => e);
      await flush();
      a.streams[0].push("ID,L,fw=1.0\n");
      await flush();
      expect(await s1).toBe("L");
      a.streams[0].fail("NetworkError");
      await flush();
      expect(lost1).toHaveBeenCalledTimes(1);
      expect(a.port.close).toHaveBeenCalled();
      expect(g1.side).toBeNull();

      // Evento `disconnect` de navigator.serial para este puerto.
      const b = fakePort();
      const listeners = stubSerial(b.port);
      const g2 = new GloveSerial();
      const lost2 = vi.fn();
      g2.onLost = lost2;
      const s2 = g2.connect().then((s) => s, (e: unknown) => e);
      await flush();
      b.streams[0].push("ID,R,fw=1.0\n");
      await flush();
      expect(await s2).toBe("R");
      listeners.forEach((fn) => fn({ target: {} })); // otro puerto: no afecta
      await flush();
      expect(lost2).not.toHaveBeenCalled();
      listeners.forEach((fn) => fn({ target: b.port }));
      await flush();
      expect(lost2).toHaveBeenCalledTimes(1);
      expect(b.port.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe("helpers de serial", () => {
  it("asciiText conserva ASCII imprimible y saltos de línea", () => {
    expect(asciiText(new Uint8Array([0x44, 0x2c, 0xff, 0x00, 0x0d, 0x0a, 0x52]))).toBe("D,\nR");
  });
  it("dataLineSide exige D, lado L/R, 20 campos y seq/t enteros", () => {
    expect(dataLineSide(dLine("R", 1))).toBe("R");
    expect(dataLineSide(dLine("L", 1))).toBe("L");
    expect(dataLineSide("D,R,1,2,3")).toBeNull();
    expect(dataLineSide(dLine("R", 1).replace("D,R,1,", "D,X,1,"))).toBeNull();
    expect(dataLineSide(dLine("R", 1).replace("D,R,1,", "D,R,a,"))).toBeNull();
  });
  it("isNonFatalSerialError reconoce los errores recuperables de Web Serial", () => {
    for (const name of ["FramingError", "BufferOverrunError", "BreakError", "ParityError"]) expect(isNonFatalSerialError({ name })).toBe(true);
    expect(isNonFatalSerialError({ name: "NetworkError" })).toBe(false);
    expect(isNonFatalSerialError(new Error("x"))).toBe(false);
  });
});
