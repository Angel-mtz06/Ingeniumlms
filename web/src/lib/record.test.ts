import { describe, expect, it } from "vitest";
import { canonicalGloss, labelError, MAX_REC_FRAMES, recordingErrorMessage, saveRecording, signerError } from "./record";

describe("canonicalGloss", () => {
  it("canoniza como el servidor", () => {
    expect(canonicalGloss(" buenos días ")).toBe("BUENOS_DIAS");
    expect(canonicalGloss("niño")).toBe("NIÑO");
    expect(canonicalGloss("niño")).toBe("NIÑO"); // Ñ descompuesta
    expect(canonicalGloss("ninguna")).toBe("NINGUNA");
  });
});

describe("validación", () => {
  it("glosa", () => {
    expect(labelError("hola")).toBeNull();
    expect(labelError("  ")).toMatch(/Escribe/);
    expect(labelError("hola!")).toMatch(/solo letras/);
    expect(labelError("a".repeat(41))).toMatch(/40/);
  });
  it("persona", () => {
    expect(signerError("ana-lopez")).toBeNull();
    expect(signerError("Ana2")).toBeNull();
    expect(signerError("")).toMatch(/Escribe/);
    expect(signerError("ana_lopez")).toMatch(/guion bajo/);
    expect(signerError("ana lopez")).toMatch(/espacios/);
    expect(signerError("josé")).toMatch(/sin acento/);
    expect(signerError("a".repeat(33))).toMatch(/32/);
  });
});

describe("saveRecording", () => {
  const frames = [{ type: "frame" as const, w: 1, h: 1, hands: [], pose: null, face: null, gloves: { L: null, R: null } }];

  it("envía la glosa canonizada y devuelve el sample_id", async () => {
    let body = "";
    const fake = (async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({ sample_id: "ana_HOLA_000", frames: 1 }));
    }) as unknown as typeof fetch;
    const r = await saveRecording("hola", " ana ", frames, fake);
    expect(r.sample_id).toBe("ana_HOLA_000");
    expect(JSON.parse(body)).toMatchObject({ label: "HOLA", signer: "ana" });
  });

  it("traduce el detalle del servidor", async () => {
    const fake = (async () => new Response(JSON.stringify({ detail: "glosa o persona inválida" }), { status: 400 })) as unknown as typeof fetch;
    await expect(saveRecording("hola", "ana", frames, fake)).rejects.toThrow(/rechazó la glosa/);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(saveRecording("hola", "ana", frames, down)).rejects.toThrow(/conexión/);
    expect(recordingErrorMessage(502, null)).toMatch(/no respondió/);
    expect(recordingErrorMessage(500, "otra cosa")).toMatch(/500/);
  });

  it("valida el número de cuadros antes de enviar", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(JSON.stringify({ sample_id: "x", frames: 0 }));
    }) as unknown as typeof fetch;
    await expect(saveRecording("hola", "ana", [], fake)).rejects.toThrow(/ningún cuadro/);
    const many = Array.from({ length: MAX_REC_FRAMES + 1 }, () => frames[0]);
    await expect(saveRecording("hola", "ana", many, fake)).rejects.toThrow(/demasiado larga/);
    expect(calls).toBe(0);
  });
});
