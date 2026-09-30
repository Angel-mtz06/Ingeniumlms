import { describe, expect, it, beforeEach, vi } from "vitest";
import type { FramePayload } from "./protocol";
import { SessionSocket } from "./socket";

class FakeWS {
  static last: FakeWS;
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void; onclose?: () => void; onmessage?: (e: { data: string }) => void;
  constructor(public url: string) {
    FakeWS.last = this;
    FakeWS.instances.push(this);
  }
  send(s: string) { this.sent.push(s); }
  close() { this.readyState = 3; this.onclose?.(); }
  openNow() { this.readyState = 1; this.onopen?.(); }
}

const frame: FramePayload = { type: "frame", w: 1, h: 1, hands: [], pose: null, face: null, gloves: { L: null, R: null } };

describe("SessionSocket", () => {
  beforeEach(() => {
    FakeWS.instances = [];
  });

  it("encola hello, descarta cuadros cerrados y entrega mensajes", () => {
    const got: unknown[] = [];
    const s = new SessionSocket("ws://x/ws", (m) => got.push(m), { WebSocketImpl: FakeWS as unknown as typeof WebSocket, retryMs: 1e9 });
    expect(s.send({ type: "hello", mode: "translate", target: null })).toBe(false);
    expect(s.send(frame)).toBe(false);
    FakeWS.last.openNow();
    expect(FakeWS.last.sent.map((x) => JSON.parse(x).type)).toEqual(["hello"]);
    FakeWS.last.onmessage?.({ data: JSON.stringify({ type: "pending", glosses: [] }) });
    expect(got).toEqual([{ type: "pending", glosses: [] }]);
    expect(s.send(frame)).toBe(true);
    s.close();
  });

  it("reenvía solo el último hello tras reconectar", () => {
    vi.useFakeTimers();
    try {
      const s = new SessionSocket("ws://x/ws", () => {}, { WebSocketImpl: FakeWS as unknown as typeof WebSocket, retryMs: 100 });
      const helloA = { type: "hello", mode: "translate", target: null } as const;
      const helloB = { type: "hello", mode: "translate", target: "test" } as const;

      // Send two hellos while closed
      s.send(helloA);
      s.send(helloB);
      expect(FakeWS.instances).toHaveLength(1);

      // Open first connection → should send only helloB
      FakeWS.last.openNow();
      expect(FakeWS.last.sent).toHaveLength(1);
      expect(JSON.parse(FakeWS.last.sent[0])).toEqual(helloB);
      expect(s.opens).toBe(1);

      // Simulate drop
      FakeWS.last.close();

      // Advance timers to trigger reconnect
      vi.advanceTimersByTime(100);
      expect(FakeWS.instances).toHaveLength(2);

      // Open second connection → should send helloB exactly once
      FakeWS.last.openNow();
      expect(s.opens).toBe(2);
      expect(FakeWS.last.sent).toHaveLength(1);
      expect(JSON.parse(FakeWS.last.sent[0])).toEqual(helloB);

      s.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("el tema y validate son persistentes: se manda al abrir tras hello y se reenvía (solo el último) al reconectar", () => {
    vi.useFakeTimers();
    try {
      const s = new SessionSocket("ws://x/ws", () => {}, { WebSocketImpl: FakeWS as unknown as typeof WebSocket, retryMs: 100 });
      s.send({ type: "hello", mode: "translate", target: null });
      s.send({ type: "topic", topic: "salud" });
      s.send({ type: "validate", enabled: true });
      s.send({ type: "topic", topic: "saludos" });
      FakeWS.last.openNow();
      expect(FakeWS.last.sent.map((x) => JSON.parse(x))).toEqual([
        { type: "hello", mode: "translate", target: null },
        { type: "topic", topic: "saludos" },
        { type: "validate", enabled: true },
      ]);
      expect(s.send({ type: "topic", topic: "emergencias" })).toBe(true);
      FakeWS.last.close();
      vi.advanceTimersByTime(100);
      FakeWS.last.openNow();
      expect(FakeWS.last.sent.map((x) => JSON.parse(x))).toEqual([
        { type: "hello", mode: "translate", target: null },
        { type: "topic", topic: "emergencias" },
        { type: "validate", enabled: true },
      ]);
      s.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("close cancela la reconexión", () => {
    vi.useFakeTimers();
    try {
      const s = new SessionSocket("ws://x/ws", () => {}, { WebSocketImpl: FakeWS as unknown as typeof WebSocket, retryMs: 100 });
      const initialCount = FakeWS.instances.length;

      // Simulate drop
      FakeWS.last.close();

      // Close before timer fires
      s.close();

      // Advance timers
      vi.advanceTimersByTime(200);

      // No new FakeWS should be created
      expect(FakeWS.instances).toHaveLength(initialCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("descarta cuadros si el socket tiene más de 64 KB sin enviar, pero nunca mensajes de control", () => {
    const s = new SessionSocket("ws://x/ws", () => {}, { WebSocketImpl: FakeWS as unknown as typeof WebSocket, retryMs: 1e9 });
    FakeWS.last.openNow();
    const ws = FakeWS.last as FakeWS & { bufferedAmount: number };
    ws.bufferedAmount = 64 * 1024; // justo en el límite: todavía se envía
    expect(s.send(frame)).toBe(true);
    ws.bufferedAmount = 64 * 1024 + 1;
    const before = ws.sent.length;
    expect(s.send(frame)).toBe(false);
    expect(ws.sent.length).toBe(before);
    const control = [
      { type: "hello", mode: "translate", target: null },
      { type: "confirm_gloss", index: 0, gloss: "HOLA" },
      { type: "remove_gloss", index: 0 },
      { type: "build_sentence" },
      { type: "calibrate", step: "open" },
      { type: "reset" },
    ] as const;
    for (const m of control) expect(s.send(m)).toBe(true);
    expect(ws.sent.slice(before).map((x) => JSON.parse(x).type)).toEqual(control.map((m) => m.type));
    s.close();
  });
});

