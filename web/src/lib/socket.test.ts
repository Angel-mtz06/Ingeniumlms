import { describe, expect, it } from "vitest";
import { SessionSocket } from "./socket";

class FakeWS {
  static last: FakeWS;
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void; onclose?: () => void; onmessage?: (e: { data: string }) => void;
  constructor(public url: string) { FakeWS.last = this; }
  send(s: string) { this.sent.push(s); }
  close() { this.readyState = 3; this.onclose?.(); }
  openNow() { this.readyState = 1; this.onopen?.(); }
}

const frame = { type: "frame", w: 1, h: 1, hands: [], pose: null, face: null, gloves: { L: null, R: null } } as any;

describe("SessionSocket", () => {
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
});
