import { describe, expect, it } from "vitest";
import type { ServerMsg } from "./protocol";
import { bestCandidate, lostMessage, newEvents, pausingFraction, pausingText, serverIndex, TRANSLATE_INITIAL, translateReducer, type TranslateState, validateKey, validation, validCorrected } from "./translate";

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

describe("pausa de oración (pausing)", () => {
  const pausing = (remaining: number | null, total = 3.5): ServerMsg =>
    remaining === null ? { type: "pausing", remaining: null } : { type: "pausing", remaining, total };

  it("guarda la cuenta regresiva y la cancela con remaining null", () => {
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA"), pausing(3.3));
    expect(s.pausing).toEqual({ remaining: 3.3, total: 3.5 });
    s = run(s, pausing(2.8));
    expect(s.pausing).toEqual({ remaining: 2.8, total: 3.5 });
    s = run(s, pausing(null));
    expect(s.pausing).toBeNull();
  });

  it("la oración, un ready y Borrar todo quitan el aviso", () => {
    const withPause = run(TRANSLATE_INITIAL, sign(0, "HOLA"), pausing(1.2));
    expect(run(withPause, { type: "sentence", glosses: ["HOLA"], text: "Hola.", paragraph: "Hola.", source: "template" }).pausing).toBeNull();
    expect(run(withPause, { type: "ready", mode: "translate", target: null, has_reference: false }).pausing).toBeNull();
    expect(translateReducer(withPause, { kind: "clear" }).pausing).toBeNull();
  });

  it("texto y fracción del indicador", () => {
    expect(pausingText(3.3)).toBe("Formando oración en 4 s… sube las manos para seguir");
    expect(pausingText(0.2)).toBe("Formando oración en 1 s… sube las manos para seguir");
    expect(pausingFraction({ remaining: 1.75, total: 3.5 })).toBe(0.5);
    expect(pausingFraction({ remaining: 9, total: 3.5 })).toBe(1);
    expect(pausingFraction({ remaining: 1, total: 0 })).toBe(0);
  });
});

describe("contexto", () => {
  it("sign con reranked marca la etiqueta; confirmarla quita la marca", () => {
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA"), {
      type: "sign",
      index: 1,
      gloss: "YO",
      top3: [["YO", 0.3], ["BOMBEROS", 0.4], ["NO", 0.1]],
      confident: false,
      reranked: true,
    });
    expect(s.chips.map((c) => c.reranked ?? false)).toEqual([false, true]);
    s = translateReducer(s, { kind: "confirm", index: 1, gloss: "BOMBEROS" });
    expect(s.chips[1]).toEqual({ gloss: "BOMBEROS", top3: [["YO", 0.3], ["BOMBEROS", 0.4], ["NO", 0.1]], confident: true, confirmed: true });
  });

  it("sentence guarda las glosas elegidas y los índices corregidos", () => {
    const s = run(TRANSLATE_INITIAL, sign(0, "HOLA"), sign(1, "BOMBEROS", false), {
      type: "sentence",
      glosses: ["HOLA", "YO"],
      text: "Hola, yo.",
      paragraph: "Hola, yo.",
      source: "llm",
      corrected: [1],
    });
    expect(s.chips).toEqual([]);
    expect(s.sentence).toEqual({ text: "Hola, yo.", paragraph: "Hola, yo.", source: "llm", glosses: ["HOLA", "YO"], corrected: [1] });
  });

  it("sin corrected (servidor anterior) queda vacío; índices inválidos se descartan", () => {
    const s = run(TRANSLATE_INITIAL, { type: "sentence", glosses: ["HOLA"], text: "Hola.", paragraph: "Hola.", source: "template" });
    expect(s.sentence?.corrected).toEqual([]);
    expect(validCorrected([2, 0, 0, -1, 1.5, 9, "1"], 3)).toEqual([0, 2]);
    expect(validCorrected(null, 3)).toEqual([]);
  });
});

describe("validar cada seña", () => {
  const three = () => run(TRANSLATE_INITIAL, sign(0, "HOLA", false), sign(1, "YO"), sign(2, "BOMBEROS", false));

  it("confirmar marca la seña; quitar con ghost la deja visible como quitada", () => {
    let s = three();
    expect(s.chips.map((c) => c.confirmed ?? false)).toEqual([false, false, false]);
    s = translateReducer(s, { kind: "confirm", index: 1, gloss: "YO" });
    s = translateReducer(s, { kind: "remove", index: 2, ghost: true });
    expect(s.chips.map((c) => [c.gloss, !!c.confirmed, !!c.removed])).toEqual([
      ["HOLA", false, false],
      ["YO", true, false],
      ["BOMBEROS", false, true],
    ]);
    expect(validation(s.chips)).toEqual({ live: 2, confirmed: 1, unvalidated: 1, ready: false });
    s = translateReducer(s, { kind: "confirm", index: 0, gloss: "ADIOS" });
    expect(validation(s.chips)).toEqual({ live: 2, confirmed: 2, unvalidated: 0, ready: true });
  });

  it("el índice del servidor salta las quitadas; sign y pending se acomodan a las vivas", () => {
    let s = translateReducer(three(), { kind: "remove", index: 0, ghost: true });
    expect([0, 1, 2].map((i) => serverIndex(s.chips, i))).toEqual([-1, 0, 1]);
    s = run(s, { type: "pending", glosses: ["YO", "BOMBEROS"], confirmed: [true, false] });
    expect(s.chips.map((c) => [c.gloss, !!c.confirmed, !!c.removed])).toEqual([
      ["HOLA", false, true],
      ["YO", true, false],
      ["BOMBEROS", false, false],
    ]);
    s = run(s, sign(2, "GRACIAS"));
    expect(s.chips.map((c) => c.gloss)).toEqual(["HOLA", "YO", "BOMBEROS", "GRACIAS"]);
    expect(serverIndex(s.chips, 3)).toBe(2);
  });

  it("aceptar todas confirma las sugeridas vivas", () => {
    let s = translateReducer(three(), { kind: "remove", index: 1, ghost: true });
    s = translateReducer(s, { kind: "acceptAll" });
    expect(s.chips.map((c) => [c.gloss, !!c.confirmed])).toEqual([
      ["HOLA", true],
      ["YO", false],
      ["BOMBEROS", true],
    ]);
    expect(validation(s.chips).ready).toBe(true);
  });

  it("quitar la única seña deja el estado vacío (no se puede formar oración)", () => {
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA", false));
    s = translateReducer(s, { kind: "remove", index: 0, ghost: true });
    s = run(s, { type: "pending", glosses: [], confirmed: [] });
    expect(validation(s.chips)).toEqual({ live: 0, confirmed: 0, unvalidated: 0, ready: false });
  });

  it("la oración y ready borran también las quitadas; las perdidas cuentan solo las vivas", () => {
    let s = translateReducer(three(), { kind: "remove", index: 0, ghost: true });
    s = run(s, { type: "ready", mode: "practice", target: "HOLA", has_reference: true });
    expect(s.chips).toEqual([]);
    expect(s.lost).toBe(2);
  });

  it("pending con awaiting_validation avisa que faltan señas por validar", () => {
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA", false));
    s = translateReducer(s, { kind: "build" });
    s = run(s, { type: "pending", glosses: ["HOLA"], confirmed: [false], awaiting_validation: true });
    expect(s.notice).toBe("validate");
    expect(s.awaitingBuild).toBe(false);
    s = translateReducer(s, { kind: "confirm", index: 0, gloss: "HOLA" });
    expect(s.notice).toBeNull();
  });
});

describe("teclas de validación", () => {
  const k = (key: string, mod: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
    validateKey({ key, ctrlKey: false, altKey: false, metaKey: false, ...mod });
  it("1, 2 y 3 eligen; X y Supr quitan; flechas arriba y abajo cambian de seña", () => {
    expect(k("1")).toEqual({ kind: "pick", n: 0 });
    expect(k("3")).toEqual({ kind: "pick", n: 2 });
    expect(k("4")).toBeNull();
    expect(k("x")).toEqual({ kind: "remove" });
    expect(k("X")).toEqual({ kind: "remove" });
    expect(k("Delete")).toEqual({ kind: "remove" });
    expect(k("ArrowDown")).toEqual({ kind: "move", delta: 1 });
    expect(k("ArrowUp")).toEqual({ kind: "move", delta: -1 });
    expect(k("Enter")).toBeNull();
    expect(k("1", { ctrlKey: true })).toBeNull();
    expect(k("x", { metaKey: true })).toBeNull();
  });
});

describe("deletreo", () => {
  it("sign con spelled entra ya validada y como deletreada; se puede quitar", () => {
    let s = run(TRANSLATE_INITIAL, sign(0, "HOLA", false), { type: "sign", index: 1, gloss: "ANGEL", top3: [], confident: true, spelled: true, confirmed: true });
    expect(s.chips[1]).toEqual({ gloss: "ANGEL", top3: [], confident: true, spelled: true, confirmed: true });
    expect(validation(s.chips)).toEqual({ live: 2, confirmed: 1, unvalidated: 1, ready: false });
    s = translateReducer(s, { kind: "confirm", index: 0, gloss: "HOLA" });
    expect(validation(s.chips).ready).toBe(true);
    s = translateReducer(s, { kind: "remove", index: 1, ghost: true });
    expect(s.chips[1]).toMatchObject({ gloss: "ANGEL", spelled: true, removed: true });
    // pending del servidor conserva la marca de deletreo
    s = run(TRANSLATE_INITIAL, { type: "sign", index: 0, gloss: "ANGEL", top3: [], confident: true, spelled: true, confirmed: true });
    s = run(s, { type: "pending", glosses: ["ANGEL"], confirmed: [true] });
    expect(s.chips[0].spelled).toBe(true);
  });
});

describe("bestCandidate", () => {
  it("elige la de mayor % aunque la sugerida (por contexto) sea otra", () => {
    expect(bestCandidate({ gloss: "NO", top3: [["NO", 0.3], ["HOLA", 0.5], ["SI", 0.2]] })).toBe("HOLA");
    expect(bestCandidate({ gloss: "SI", top3: [["SI", 0.8], ["NO", 0.1]] })).toBe("SI");
  });
  it("sin candidatas se queda la glosa mostrada", () => {
    expect(bestCandidate({ gloss: "MARIO", top3: [] })).toBe("MARIO");
  });
});

