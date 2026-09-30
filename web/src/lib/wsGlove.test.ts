import { afterEach, describe, expect, it, vi } from "vitest";
import { GloveSocket, gloveUrl } from "./wsGlove";

class FakeWs {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {}
  send(t: string) { this.sent.push(t); }
  close() { this.closed = true; }
  open() { this.readyState = 1; this.onopen?.(); }
  msg(data: string) { this.onmessage?.({ data }); }
}

const D = "D,R,7,140,1,2,3,4,5,6,7,8,9,10,11,12,0.1,0.2,0.3,63";

function socket() {
  let ws: FakeWs | null = null;
  const g = new GloveSocket((url) => {
    ws = new FakeWs(url);
    return ws as unknown as WebSocket;
  });
  return { g, ws: () => ws! };
}

afterEach(() => vi.useRealTimers());

describe("gloveUrl", () => {
  it("arma la URL del puerto 81", () => {
    expect(gloveUrl("pulsera-der.local")).toBe("ws://pulsera-der.local:81/");
    expect(gloveUrl(" 192.168.137.45 ")).toBe("ws://192.168.137.45:81/");
    expect(gloveUrl("192.168.137.45:82")).toBe("ws://192.168.137.45:82/");
    expect(gloveUrl("ws://x:81/")).toBe("ws://x:81/");
    expect(gloveUrl("  ")).toBeNull();
  });
});

describe("GloveSocket", () => {
  it("se identifica con la línea ID, pide ID? al abrir y guarda las líneas D", async () => {
    const { g, ws } = socket();
    const p = g.connect("pulsera-der.local");
    ws().open();
    expect(ws().sent).toEqual(["ID?"]);
    ws().msg("ID,R,fw=1.1,imus=6,halls=0");
    await expect(p).resolves.toBe("R");
    ws().msg(D);
    expect(g.latest()).toBe(D);
    expect(g.lastSeenMs()).toBeGreaterThan(0);
  });

  it("también se identifica con la primera línea D y reparte las CAL", async () => {
    const { g, ws } = socket();
    const cal = vi.fn();
    g.onCal = cal;
    const p = g.connect("x");
    ws().open();
    ws().msg(D);
    await expect(p).resolves.toBe("R");
    ws().msg("CAL,R,ok,0.40");
    expect(cal).toHaveBeenCalledWith("CAL,R,ok,0.40");
    g.send("CAL");
    expect(ws().sent).toContain("CAL");
  });

  it("falla si no responde a tiempo y cierra el socket", async () => {
    vi.useFakeTimers();
    const { g, ws } = socket();
    const p = g.connect("x");
    const done = expect(p).rejects.toThrow("no respondió");
    vi.advanceTimersByTime(6000);
    await done;
    expect(ws().closed).toBe(true);
  });

  it("avisa onLost si se cae después de identificarse", async () => {
    const { g, ws } = socket();
    const lost = vi.fn();
    g.onLost = lost;
    const p = g.connect("x");
    ws().open();
    ws().msg("ID,L,fw=1.1");
    await p;
    ws().onclose?.();
    expect(lost).toHaveBeenCalledOnce();
  });
});
