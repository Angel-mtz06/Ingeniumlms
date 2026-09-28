import { describe, expect, it, vi, test } from "vitest";
import { acceptLine, GloveSerial } from "./serial";

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
