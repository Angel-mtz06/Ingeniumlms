import { describe, expect, it } from "vitest";
import type { ServerMsg } from "./protocol";
import { newEvents, TRANSLATE_INITIAL, translateReducer, type TranslateState, lostMessage } from "./translate";

const sign = (index: number, gloss: string, confident = true): ServerMsg => ({
  type: "sign",
  index,
  gloss,
  top3: [[gloss, 0.7], ["OTRA", 0.2], ["MAS", 0.1]],
  confident,
});
const run = (s: TranslateState, ...msgs: ServerMsg[]) => msgs.reduce((acc, msg) => translateReducer(acc, { kind: "msg", msg }), s);

describe("translateReducer", () => {
  it("acumula señas y las corrige o quita", () => {
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA"), sign(1, "COMO", false));
    expect(s.chips.map((c) => c.gloss)).toEqual(["HOLA", "COMO"]);
    s = translateReducer(s, { kind: "confirm", index: 1, gloss: "OTRA" });
    s = run(s, { type: "pending", glosses: ["HOLA", "OTRA"] });
    expect(s.chips[1]).toMatchObject({ gloss: "OTRA", confident: true });
    expect(s.chips[1].top3).toHaveLength(3);
    s = translateReducer(s, { kind: "remove", index: 0 });
    s = run(s, { type: "pending", glosses: ["OTRA"] });
    expect(s.chips.map((c) => c.gloss)).toEqual(["OTRA"]);
  });

  it("la oración vacía las etiquetas; ready también, pero conserva la oración", () => {
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA"), {
      type: "sentence",
      glosses: ["HOLA"],
      text: "Hola.",
      paragraph: "Hola.",
      source: "template",
    });
    expect(s.chips).toEqual([]);
    expect(s.sentence?.text).toBe("Hola.");
    s = run(s, sign(0, "GRACIAS"), { type: "ready", mode: "translate", target: null, has_reference: false });
    expect(s.chips).toEqual([]);
    expect(s.sentence?.text).toBe("Hola.");
    expect(translateReducer(s, { kind: "clear" }).sentence).toBeNull();
  });

  it("avisa si se pidió la oración sin señas pendientes", () => {
    let s = translateReducer(TRANSLATE_INITIAL, { kind: "build" });
    s = run(s, { type: "pending", glosses: [] });
    expect(s.notice).toBe("empty");
    expect(s.awaitingBuild).toBe(false);
    // quitar la última etiqueta (pending []) sin haber pedido oración no avisa
    expect(run(TRANSLATE_INITIAL, { type: "pending", glosses: [] }).notice).toBeNull();
  });
});

describe("señas perdidas", () => {
  const ready: ServerMsg = { type: "ready", mode: "practice", target: "HOLA", has_reference: true };
  it("un ready con señas pendientes cuenta las perdidas hasta que se descarta el aviso", () => {
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA"), sign(1, "GRACIAS"), ready);
    expect(s.chips).toEqual([]);
    expect(s.lost).toBe(2);
    s = run(s, sign(0, "BUENO"), ready);
    expect(s.lost).toBe(3);
    s = translateReducer(s, { kind: "dismissLost" });
    expect(s.lost).toBe(0);
  });
  it("sin señas o tras Borrar todo no avisa", () => {
    expect(run(TRANSLATE_INITIAL, ready).lost).toBe(0);
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA"));
    s = translateReducer(s, { kind: "clear" });
    // una seña en vuelo antes de que el servidor procese el reset
    s = run(s, sign(0, "GRACIAS"), ready);
    expect(s.lost).toBe(0);
    expect(s.awaitingReset).toBe(false);
    // el siguiente ready ya sí es una pérdida
    expect(run(s, sign(0, "BUENO"), ready).lost).toBe(1);
  });
});

describe("newEvents", () => {
  it("devuelve solo lo posterior al último visto", () => {
    const a = { n: 1 };
    const b = { n: 2 };
    const c = { n: 3 };
    expect(newEvents([a, b, c], null)).toEqual([a, b, c]);
    expect(newEvents([a, b, c], b)).toEqual([c]);
    expect(newEvents([a, b, c], c)).toEqual([]);
    expect(newEvents([b, c], { n: 9 })).toEqual([b, c]);
  });
});

describe("lostMessage", () => {
  it("texto del aviso de señas borradas (vacío si no hay)", () => {
    expect(lostMessage(0)).toBe("");
    expect(lostMessage(1)).toBe("Se borró 1 seña sin formar oración al cambiar de modo o al reiniciarse la conexión. Vuelve a hacerla si la necesitas.");
    expect(lostMessage(3)).toBe("Se borraron 3 señas sin formar oración al cambiar de modo o al reiniciarse la conexión. Vuelve a hacerlas si las necesitas.");
  });
});
