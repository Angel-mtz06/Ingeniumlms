import { describe, expect, it } from "vitest";
import type { ServerMsg } from "../lib/protocol";
import { EVENTS_MAX, sessionReducer } from "./useSession";

const live = (n: number): ServerMsg => ({ type: "live", fingers: [[n, 0, 0, 0, 0], [-1, -1, -1, -1, -1]], hands: [true, false], segment: "idle" });

describe("sessionReducer", () => {
  it("guarda el último mensaje por tipo y la lista de eventos", () => {
    let s = sessionReducer({ last: {}, events: [] }, { kind: "msg", msg: live(0) });
    s = sessionReducer(s, { kind: "msg", msg: { type: "warning", code: "no_hands", message: "x" } });
    s = sessionReducer(s, { kind: "msg", msg: live(2) });
    expect(s.last.live?.fingers[0][0]).toBe(2);
    expect(s.last.warning?.code).toBe("no_hands");
    expect(s.events).toHaveLength(3);
  });
  it("limita los eventos y el reset solo limpia `last`", () => {
    let s = { last: {}, events: [] as ServerMsg[] };
    for (let i = 0; i < EVENTS_MAX + 5; i++) s = sessionReducer(s, { kind: "msg", msg: live(i) });
    expect(s.events).toHaveLength(EVENTS_MAX);
    expect((s.events.at(-1) as Extract<ServerMsg, { type: "live" }>).fingers[0][0]).toBe(EVENTS_MAX + 4);
    const r = sessionReducer(s, { kind: "reset" });
    expect(r.last).toEqual({});
    expect(r.events).toHaveLength(EVENTS_MAX);
  });
});
