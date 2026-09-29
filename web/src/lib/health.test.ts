import { describe, expect, it } from "vitest";
import { healthWarning, parseHealth, sentencesLabel } from "./health";

describe("health", () => {
  it("parseHealth valida la respuesta de /api/health", () => {
    expect(parseHealth({ ok: true, classifier: true, references: 121, llm: false })).toEqual({ ok: true, classifier: true, references: 121, llm: false, model: null });
    expect(parseHealth(null)).toBeNull();
    expect(parseHealth({ ok: true })).toBeNull();
    expect(parseHealth({ ok: true, classifier: "sí", references: 1, llm: true })).toBeNull();
  });
  it("parseHealth lee el nombre del modelo activo (opcional: servidores viejos no lo mandan)", () => {
    expect(parseHealth({ ok: true, classifier: true, references: 121, llm: false, model: "classifier_v2" })?.model).toBe("classifier_v2");
    expect(parseHealth({ ok: true, classifier: false, references: 0, llm: false, model: null })?.model).toBeNull();
    expect(parseHealth({ ok: true, classifier: true, references: 1, llm: false, model: 7 })?.model).toBeNull();
  });
  it("healthWarning avisa si falta el clasificador o no hay referencias", () => {
    expect(healthWarning(null)).toBeNull();
    expect(healthWarning({ ok: true, classifier: true, references: 121, llm: true })).toBeNull();
    expect(healthWarning({ ok: true, classifier: false, references: 121, llm: true })).toMatch(/^El modelo de reconocimiento no está cargado/);
    expect(healthWarning({ ok: true, classifier: true, references: 0, llm: true })).toMatch(/^El modelo de reconocimiento no está cargado/);
    expect(healthWarning({ ok: true, classifier: true, references: 0, llm: true })).toMatch(/referencia/);
  });
  it("sentencesLabel: sin LLM, frases con plantillas", () => {
    expect(sentencesLabel(false)).toBe("frases con plantillas");
    expect(sentencesLabel(true)).toMatch(/IA/);
  });
});
