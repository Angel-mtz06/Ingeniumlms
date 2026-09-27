# Plan 3: Interfaz web (cámara, guantes y pantallas) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App web (React + Vite + TypeScript) que corre MediaPipe en el navegador, lee los guantes por Web Serial, habla con el servidor del Plan 2 por WebSocket y ofrece las pantallas Inicio, Calibración, Práctica, Traducción, Grabación y Diagnóstico.

**Architecture:** La lógica sin interfaz vive en `src/lib/` con pruebas Vitest (payload de cuadros, lector de líneas serie, cliente WebSocket, grabadora). Los componentes de `src/components/` y `src/screens/` solo consumen hooks. El diseño visual (tokens y estilo) se define en la Task 1 siguiendo el flujo obligatorio del `CLAUDE.md` del usuario; ninguna otra tarea inventa colores ni tipografías.

**Tech Stack:** Node 20+ (ya instalado en `C:\Program Files\nodejs`, solo ejecutable), Vite 5, React 18, TypeScript 5, `@mediapipe/tasks-vision@0.10.14`, Vitest 2, `@types/w3c-web-serial`.

**Spec:** `D:\Ingenium\docs\superpowers\specs\2026-09-27-lsm-ingenium-design.md` (secciones 3, 5.3, 6, 8)

## Global Constraints

- Todo en `D:\Ingenium\web`; caché de npm en `D:/Ingenium/tools/npm-cache` (`npm_config_cache` en `env.sh`). Nunca escribir en `C:`.
- `@mediapipe/tasks-vision` **0.10.14** (misma versión que Python). Los `.wasm` y los modelos `.task` se sirven **localmente** desde `web/public/mediapipe/` (la demo no depende de internet para la visión).
- Cuadros **sin espejo** para MediaPipe; el espejo es solo visual (CSS `transform: scaleX(-1)` en el `<video>` y el `<canvas>` superpuesto).
- Payload de cuadro exactamente como el **Contrato WebSocket** del Plan 2 (`docs/superpowers/plans/2026-09-27-plan2-servidor.md`): píxeles `x·W, y·H, z·W`; `face` = 22 puntos en el orden `FACE_IDX = [1, 234, 454, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 61, 291, 0, 17, 13, 14, 78, 308, 152]`.
- Slot 0 / guante `R` = mano derecha del signante.
- Todo el texto de la interfaz en español; todo aviso importante es visual (usuarios sordos); la voz (`speechSynthesis`, `lang="es-MX"`) es para la persona oyente.
- **Flujo de diseño obligatorio (CLAUDE.md del usuario):** `awesome-design` → `image-to-code` (solo si hay imágenes de referencia) → `design-taste-frontend` → `web-design-guidelines` → `playwright-cli` con `--browser=msedge` (no hay Chrome instalado). Las skills se invocan con la herramienta Skill.
- En desarrollo, Vite hace proxy de `/api` y `/ws` a `http://127.0.0.1:8000`; en producción los sirve el mismo FastAPI.
- Cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Estructura de archivos

```
D:\Ingenium\web\
├── package.json, tsconfig.json, vite.config.ts, index.html
├── DESIGN.md                        # dirección visual y tokens (Task 1)
├── public/mediapipe/                # wasm + .task copiados (Task 2)
└── src/
    ├── main.tsx, App.tsx            # navegación por pestañas (sin router)
    ├── styles/tokens.css            # variables CSS (Task 1) — única fuente de color/tipo/espaciado
    ├── styles/base.css
    ├── lib/
    │   ├── protocol.ts              # tipos del contrato WebSocket
    │   ├── frame.ts                 # resultados de MediaPipe → FramePayload
    │   ├── vision.ts                # carga de landmarkers y detección por cuadro
    │   ├── lines.ts                 # LineBuffer + parseIdLine
    │   ├── serial.ts                # GloveSerial (Web Serial)
    │   ├── socket.ts                # SessionSocket (reconexión)
    │   └── recorder.ts              # Recorder (grabaciones propias)
    ├── hooks/ useCamera.ts, useVision.ts, useGloves.ts, useSession.ts
    ├── components/ StatusBar, CameraView, HandDiagram, ScoreCard, GlossChips,
    │               SentencePanel, Catalog, ReferencePlayer
    └── screens/ Home, Calibration, Practice, Translate, Record, Diagnostics
```

---

### Task 1: Proyecto Vite y dirección visual (flujo del CLAUDE.md)

**Files:**
- Create: `D:\Ingenium\web\package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`
- Create: `D:\Ingenium\web\DESIGN.md`, `src/styles/tokens.css`, `src/styles/base.css`
- Modify: `D:\Ingenium\tools\env.sh` (agregar `export npm_config_cache=D:/Ingenium/tools/npm-cache`)

**Interfaces:**
- Produces: variables CSS con **estos nombres exactos** (los valores los decide la skill): `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-accent-contrast`, `--color-ok`, `--color-warn`, `--color-bad`, `--color-border`, `--font-sans`, `--font-display`, `--text-xs` … `--text-3xl`, `--space-1` … `--space-8`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--shadow-1`, `--shadow-2`, `--focus-ring`. Tema claro y oscuro (`prefers-color-scheme`). `--color-ok/warn/bad` deben distinguirse también sin color (los componentes agregan ícono o texto).

- [ ] **Step 1: Crear el proyecto** (pedir permiso al usuario: dependencias npm ~150 MB a `D:\Ingenium\web\node_modules` y la caché en `D:`)

```json
{
  "name": "lsm-web",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "test": "vitest run" },
  "dependencies": { "@mediapipe/tasks-vision": "0.10.14", "react": "18.3.1", "react-dom": "18.3.1" },
  "devDependencies": {
    "@types/react": "18.3.5", "@types/react-dom": "18.3.0", "@types/w3c-web-serial": "1.0.6",
    "@vitejs/plugin-react": "4.3.1", "typescript": "5.5.4", "vite": "5.4.6", "vitest": "2.1.1"
  }
}
```

```ts
// D:/Ingenium/web/vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  test: { environment: "node" },
});
```

`tsconfig.json`: `"strict": true`, `"jsx": "react-jsx"`, `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"types": ["vite/client", "w3c-web-serial"]`, `"include": ["src"]`.

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npm install && npx tsc --version`
Expected: `Version 5.5.4`

- [ ] **Step 2: Dirección visual con `awesome-design`**

Invocar la skill `awesome-design`. Brief para la skill: *app de accesibilidad para aprender y traducir Lengua de Señas Mexicana; la usan personas sordas y oyentes; debe verse confiable, clara y humana (no "tech gamer"); pantallas con cámara grande, retroalimentación por colores + ícono, texto grande; se presenta ante un jurado técnico y expertos en LSM.* Elegir 1–3 sistemas de referencia de la biblioteca, leer su DESIGN.md y escribir `web/DESIGN.md` con: sistemas elegidos y por qué, paleta (con contraste AA verificado para texto sobre fondo y sobre `--color-accent`), tipografía (fuentes de Google Fonts o del sistema), escala de espaciado, radios, sombras y reglas de uso. Luego volcar los valores en `src/styles/tokens.css` con los nombres exactos de la sección **Interfaces**.

- [ ] **Step 3: `base.css`, `main.tsx` y `App.tsx` mínimo**

`App.tsx` muestra una barra de pestañas (Inicio, Práctica, Traducción, Calibración, Grabar, Diagnóstico) y el título; cada pestaña renderiza por ahora un `<section>` con su nombre. Solo tokens de `tokens.css`; ningún color literal fuera de ese archivo (verificar con `grep -rE "#[0-9a-fA-F]{3,6}|rgb\(" src --include=*.tsx --include=*.css | grep -v tokens.css` → sin resultados).

- [ ] **Step 4: Verificar**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npm run build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/index.html web/DESIGN.md web/src
git add -f tools/env.sh
git commit -m "feat(web): proyecto Vite y dirección visual con tokens de diseño

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Visión en el navegador (MediaPipe → payload)

**Files:**
- Create: `D:\Ingenium\web\src\lib\protocol.ts`, `frame.ts`, `vision.ts`
- Create: `D:\Ingenium\web\scripts\copy-mediapipe.mjs` y script npm `"postinstall": "node scripts/copy-mediapipe.mjs"`
- Test: `D:\Ingenium\web\src\lib\frame.test.ts`

**Interfaces:**
- Produces:
  - `protocol.ts`: tipos `Mode`, `FramePayload`, `ClientMsg`, `ServerMsg` (unión discriminada por `type`, exactamente los campos del Contrato WebSocket del Plan 2).
  - `frame.ts`: `FACE_IDX: readonly number[]` (22); `toPixels(lms: {x,y,z}[], w, h): number[][]`; `buildFrame(input: {w, h, hands: {x,y,z}[][], pose: {x,y,z,visibility?}[] | null, face: {x,y,z}[] | null, gloves: {L: string|null, R: string|null}}): FramePayload`.
  - `vision.ts`: `createVision(base = "/mediapipe"): Promise<Vision>`; `Vision.detect(video: HTMLVideoElement, tsMs: number): FramePayload` (manos cada cuadro, pose cada 2, cara cada 3, reutilizando el último resultado) y `close()`.

- [ ] **Step 1: Escribir las pruebas**

```ts
// D:/Ingenium/web/src/lib/frame.test.ts
import { describe, expect, it } from "vitest";
import { buildFrame, FACE_IDX, toPixels } from "./frame";

const pt = (x: number, y: number, z = 0) => ({ x, y, z });

describe("frame", () => {
  it("FACE_IDX coincide con el servidor", () => {
    expect(FACE_IDX).toEqual([1, 234, 454, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 61, 291, 0, 17, 13, 14, 78, 308, 152]);
  });

  it("convierte a píxeles con z escalada por el ancho", () => {
    expect(toPixels([pt(0.5, 0.25, 0.1)], 640, 480)).toEqual([[320, 120, 64]]);
  });

  it("arma el payload con cara recortada y pose con visibilidad", () => {
    const face = Array.from({ length: 478 }, (_, i) => pt(i / 1000, 0));
    const pose = Array.from({ length: 33 }, () => ({ ...pt(0.5, 0.5), visibility: 0.9 }));
    const f = buildFrame({ w: 100, h: 100, hands: [Array.from({ length: 21 }, () => pt(0.1, 0.2))], pose, face, gloves: { L: null, R: "D,R,1" } });
    expect(f.type).toBe("frame");
    expect(f.hands[0]).toHaveLength(21);
    expect(f.face).toHaveLength(22);
    expect(f.face![1][0]).toBeCloseTo(23.4);
    expect(f.pose![0]).toEqual([50, 50, 0, 0.9]);
    expect(f.gloves).toEqual({ L: null, R: "D,R,1" });
  });

  it("pose y cara ausentes son null y máximo 2 manos", () => {
    const hand = Array.from({ length: 21 }, () => pt(0, 0));
    const f = buildFrame({ w: 10, h: 10, hands: [hand, hand, hand], pose: null, face: null, gloves: { L: null, R: null } });
    expect(f.hands).toHaveLength(2);
    expect(f.pose).toBeNull();
    expect(f.face).toBeNull();
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npx vitest run src/lib/frame.test.ts`
Expected: FAIL (`Failed to resolve import "./frame"`).

- [ ] **Step 3: Implementar `protocol.ts` y `frame.ts`**

```ts
// D:/Ingenium/web/src/lib/protocol.ts
export type Mode = "practice" | "translate";
export type Glosses = [string, number][];

export interface FramePayload {
  type: "frame";
  w: number;
  h: number;
  hands: number[][][];
  pose: number[][] | null;
  face: number[][] | null;
  gloves: { L: string | null; R: string | null };
}

export type ClientMsg =
  | { type: "hello"; mode: Mode; target: string | null }
  | FramePayload
  | { type: "calibrate"; step: "open" | "fist" | "done" }
  | { type: "confirm_gloss"; index: number; gloss: string }
  | { type: "remove_gloss"; index: number }
  | { type: "build_sentence" }
  | { type: "reset" };

export type Scores = { configuracion: number; ubicacion: number; movimiento: number; orientacion: number };

export type ServerMsg =
  | { type: "ready"; mode: Mode; target: string | null; has_reference: boolean }
  | { type: "live"; fingers: number[][]; hands: boolean[]; segment: "idle" | "active" }
  | { type: "evaluation"; target: string; recognized: Glosses; scores: Scores | Record<string, never>; total: number; tips: string[]; fingers: number[][] }
  | { type: "sign"; index: number; gloss: string; top3: Glosses; confident: boolean }
  | { type: "pending"; glosses: string[] }
  | { type: "sentence"; glosses: string[]; text: string; paragraph: string; source: "llm" | "template" }
  | { type: "calibration"; step: string; status?: string; sides?: { L: boolean; R: boolean } }
  | { type: "warning"; code: string; message: string }
  | { type: "error"; message: string };
```

```ts
// D:/Ingenium/web/src/lib/frame.ts
import type { FramePayload } from "./protocol";

type P = { x: number; y: number; z: number; visibility?: number };

export const FACE_IDX: readonly number[] = [1, 234, 454, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 61, 291, 0, 17, 13, 14, 78, 308, 152];

export function toPixels(lms: P[], w: number, h: number): number[][] {
  return lms.map((p) => [p.x * w, p.y * h, p.z * w]);
}

export function buildFrame(input: {
  w: number; h: number; hands: P[][]; pose: P[] | null; face: P[] | null;
  gloves: { L: string | null; R: string | null };
}): FramePayload {
  const { w, h } = input;
  return {
    type: "frame", w, h,
    hands: input.hands.slice(0, 2).map((hand) => toPixels(hand, w, h)),
    pose: input.pose ? input.pose.map((p) => [p.x * w, p.y * h, p.z * w, p.visibility ?? 0]) : null,
    face: input.face ? toPixels(FACE_IDX.map((i) => input.face![i]), w, h) : null,
    gloves: input.gloves,
  };
}
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npx vitest run src/lib/frame.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Copia local de wasm y modelos**

```js
// D:/Ingenium/web/scripts/copy-mediapipe.mjs
import { cpSync, existsSync, mkdirSync } from "node:fs";

const dst = "public/mediapipe";
mkdirSync(`${dst}/wasm`, { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", `${dst}/wasm`, { recursive: true });
for (const m of ["hand_landmarker", "pose_landmarker_full", "face_landmarker"]) {
  const src = `../models/mediapipe/${m}.task`;
  if (existsSync(src)) cpSync(src, `${dst}/${m}.task`);
  else console.warn(`falta ${src}: ejecuta training/download_models.py`);
}
```
Agregar `web/public/mediapipe/` al `.gitignore` de la raíz (son binarios regenerables).

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && node scripts/copy-mediapipe.mjs && ls public/mediapipe`
Expected: `face_landmarker.task hand_landmarker.task pose_landmarker_full.task wasm`

- [ ] **Step 6: Implementar `vision.ts`**

```ts
// D:/Ingenium/web/src/lib/vision.ts
import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { buildFrame } from "./frame";
import type { FramePayload } from "./protocol";

export interface Vision {
  detect(video: HTMLVideoElement, tsMs: number, gloves: FramePayload["gloves"]): FramePayload;
  lastHands(): { x: number; y: number; z: number }[][];
  close(): void;
}

export async function createVision(base = "/mediapipe"): Promise<Vision> {
  const fs = await FilesetResolver.forVisionTasks(`${base}/wasm`);
  const opts = (name: string) => ({ baseOptions: { modelAssetPath: `${base}/${name}.task`, delegate: "GPU" as const }, runningMode: "VIDEO" as const });
  const hands = await HandLandmarker.createFromOptions(fs, { ...opts("hand_landmarker"), numHands: 2, minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
  const pose = await PoseLandmarker.createFromOptions(fs, { ...opts("pose_landmarker_full"), minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3 });
  const face = await FaceLandmarker.createFromOptions(fs, { ...opts("face_landmarker"), numFaces: 1 });
  let n = 0;
  let lastPose: FramePayload["pose"] extends unknown ? any : never = null;
  let lastFace: any = null;
  let lastHands: { x: number; y: number; z: number }[][] = [];
  return {
    detect(video, tsMs, gloves) {
      const h = hands.detectForVideo(video, tsMs);
      lastHands = h.landmarks;
      if (n % 2 === 0) lastPose = pose.detectForVideo(video, tsMs).landmarks[0] ?? null;
      if (n % 3 === 0) lastFace = face.detectForVideo(video, tsMs).faceLandmarks[0] ?? null;
      n++;
      return buildFrame({ w: video.videoWidth, h: video.videoHeight, hands: h.landmarks, pose: lastPose, face: lastFace, gloves });
    },
    lastHands: () => lastHands,
    close() { hands.close(); pose.close(); face.close(); },
  };
}
```
(Si `delegate: "GPU"` falla en la laptop de la demo, usar `"CPU"`; queda documentado en el reporte.)

- [ ] **Step 7: Commit**

```bash
cd D:/Ingenium && git add .gitignore web/src/lib/protocol.ts web/src/lib/frame.ts web/src/lib/frame.test.ts web/src/lib/vision.ts web/scripts web/package.json
git commit -m "feat(web): MediaPipe en el navegador y payload del contrato WebSocket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Guantes por Web Serial

**Files:**
- Create: `D:\Ingenium\web\src\lib\lines.ts`, `serial.ts`
- Test: `D:\Ingenium\web\src\lib\lines.test.ts`

**Interfaces:**
- Produces:
  - `class LineBuffer { push(chunk: string): string[] }` (acumula fragmentos, devuelve líneas completas sin `\r`/`\n`, descarta líneas vacías, limita el búfer a 4096 caracteres).
  - `parseIdLine(line: string): { side: "L" | "R"; fw: string; imus: number; halls: number } | null`.
  - `class GloveSerial` con `static supported(): boolean`, `connect(): Promise<"L" | "R">` (pide el puerto, abre a 921600, envía `ID?\n`, espera hasta 3 s la línea `ID`), `latest(): string | null` (última línea `D,…`), `lastSeenMs(): number`, `disconnect()`.

- [ ] **Step 1: Escribir las pruebas**

```ts
// D:/Ingenium/web/src/lib/lines.test.ts
import { describe, expect, it } from "vitest";
import { LineBuffer, parseIdLine } from "./lines";

describe("LineBuffer", () => {
  it("une fragmentos y separa líneas", () => {
    const b = new LineBuffer();
    expect(b.push("D,R,1,2")).toEqual([]);
    expect(b.push(",3\r\nID,R,fw=1.0,imus=6,halls=8\nD,")).toEqual(["D,R,1,2,3", "ID,R,fw=1.0,imus=6,halls=8"]);
    expect(b.push("L\n\n")).toEqual(["D,L"]);
  });

  it("no crece sin límite", () => {
    const b = new LineBuffer();
    b.push("x".repeat(10000));
    expect(b.push("\n")[0].length).toBeLessThanOrEqual(4096);
  });
});

describe("parseIdLine", () => {
  it("lee la identidad del guante", () => {
    expect(parseIdLine("ID,L,fw=1.0,imus=6,halls=8")).toEqual({ side: "L", fw: "1.0", imus: 6, halls: 8 });
  });
  it("rechaza otras líneas", () => {
    expect(parseIdLine("D,R,1,2")).toBeNull();
    expect(parseIdLine("ID,X,fw=1")).toBeNull();
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npx vitest run src/lib/lines.test.ts`
Expected: FAIL (`Failed to resolve import "./lines"`).

- [ ] **Step 3: Implementar `lines.ts` y `serial.ts`**

```ts
// D:/Ingenium/web/src/lib/lines.ts
const MAX = 4096;

export class LineBuffer {
  private buf = "";
  push(chunk: string): string[] {
    this.buf = (this.buf + chunk).slice(-MAX);
    const parts = this.buf.split("\n");
    this.buf = parts.pop() ?? "";
    return parts.map((l) => l.replace(/\r$/, "").slice(0, MAX)).filter((l) => l.length > 0);
  }
}

export function parseIdLine(line: string) {
  const p = line.split(",");
  if (p[0] !== "ID" || (p[1] !== "L" && p[1] !== "R")) return null;
  const kv = Object.fromEntries(p.slice(2).map((s) => s.split("=")).filter((a) => a.length === 2));
  return { side: p[1] as "L" | "R", fw: kv.fw ?? "", imus: Number(kv.imus ?? 6), halls: Number(kv.halls ?? 0) };
}
```

```ts
// D:/Ingenium/web/src/lib/serial.ts
import { LineBuffer, parseIdLine } from "./lines";

export class GloveSerial {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private last: string | null = null;
  private seen = 0;
  side: "L" | "R" | null = null;

  static supported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  async connect(): Promise<"L" | "R"> {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 921600 });
    const decoder = new TextDecoderStream();
    this.port.readable!.pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>);
    this.reader = decoder.readable.getReader();
    const writer = this.port.writable!.getWriter();
    await writer.write(new TextEncoder().encode("ID?\n"));
    writer.releaseLock();
    const buf = new LineBuffer();
    const deadline = Date.now() + 3000;
    let resolveSide: (s: "L" | "R") => void;
    const got = new Promise<"L" | "R">((res) => (resolveSide = res));
    (async () => {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        for (const line of buf.push(value ?? "")) {
          const id = parseIdLine(line);
          if (id) { this.side = id.side; resolveSide(id.side); }
          else if (line.startsWith("D,")) { this.last = line; this.seen = performance.now(); }
        }
      }
    })();
    return Promise.race([got, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("El guante no respondió a ID?")), deadline - Date.now()))]);
  }

  latest(): string | null { return this.last; }
  lastSeenMs(): number { return this.seen; }

  async disconnect(): Promise<void> {
    await this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    await this.port?.close().catch(() => undefined);
    this.port = null;
  }
}
```

- [ ] **Step 4: Correr las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npx vitest run src/lib/lines.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add web/src/lib/lines.ts web/src/lib/lines.test.ts web/src/lib/serial.ts
git commit -m "feat(web): lectura de guantes por Web Serial con identificación L/R

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cliente WebSocket y grabadora

**Files:**
- Create: `D:\Ingenium\web\src\lib\socket.ts`, `recorder.ts`
- Test: `D:\Ingenium\web\src\lib\socket.test.ts`, `recorder.test.ts`

**Interfaces:**
- Produces:
  - `class SessionSocket(url: string, onMsg: (m: ServerMsg) => void, opts?: { WebSocketImpl?: typeof WebSocket; retryMs?: number })` con `send(m: ClientMsg): boolean` (descarta cuadros si el socket no está abierto; los demás mensajes se encolan y se envían al reconectar), `open: boolean`, `close()`. Reconecta cada `retryMs` (1000) y reenvía el último `hello` al reconectar.
  - `class Recorder(maxFrames = 90)` con `start()`, `add(f: FramePayload)`, `stop(): FramePayload[]`, `recording: boolean`; y `async upload(label: string, signer: string, frames: FramePayload[], fetchImpl = fetch): Promise<{ sample_id: string; frames: number }>` (POST `/api/recordings`).

- [ ] **Step 1: Escribir las pruebas**

```ts
// D:/Ingenium/web/src/lib/socket.test.ts
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

const frame = { type: "frame", w: 1, h: 1, hands: [], pose: null, face: null, gloves: { L: null, R: null } } as const;

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
```

```ts
// D:/Ingenium/web/src/lib/recorder.test.ts
import { describe, expect, it } from "vitest";
import { Recorder, upload } from "./recorder";

const frame = { type: "frame", w: 1, h: 1, hands: [], pose: null, face: null, gloves: { L: null, R: null } } as const;

describe("Recorder", () => {
  it("graba solo mientras está activo y respeta el máximo", () => {
    const r = new Recorder(3);
    r.add(frame);
    r.start();
    for (let i = 0; i < 5; i++) r.add(frame);
    expect(r.recording).toBe(false);
    expect(r.stop()).toHaveLength(3);
  });

  it("sube la grabación", async () => {
    const calls: { url: string; body: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ sample_id: "a_HOLA_000", frames: 1 }));
    }) as unknown as typeof fetch;
    const res = await upload("hola", "a", [frame], fake);
    expect(res.sample_id).toBe("a_HOLA_000");
    expect(calls[0].url).toBe("/api/recordings");
    expect(JSON.parse(calls[0].body)).toMatchObject({ label: "hola", signer: "a" });
  });
});
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npx vitest run src/lib/socket.test.ts src/lib/recorder.test.ts`
Expected: FAIL (imports no resueltos).

- [ ] **Step 3: Implementar**

```ts
// D:/Ingenium/web/src/lib/socket.ts
import type { ClientMsg, ServerMsg } from "./protocol";

export class SessionSocket {
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private hello: ClientMsg | null = null;
  private closed = false;
  private readonly Impl: typeof WebSocket;
  private readonly retryMs: number;

  constructor(private url: string, private onMsg: (m: ServerMsg) => void,
              opts: { WebSocketImpl?: typeof WebSocket; retryMs?: number } = {}) {
    this.Impl = opts.WebSocketImpl ?? WebSocket;
    this.retryMs = opts.retryMs ?? 1000;
    this.connect();
  }

  get open(): boolean { return this.ws?.readyState === 1; }

  private connect() {
    const ws = new this.Impl(this.url);
    this.ws = ws;
    ws.onopen = () => {
      const pending = this.hello && !this.queue.includes(this.hello) ? [this.hello, ...this.queue] : this.queue;
      this.queue = [];
      pending.forEach((m) => ws.send(JSON.stringify(m)));
    };
    ws.onmessage = (e: MessageEvent) => this.onMsg(JSON.parse(String(e.data)) as ServerMsg);
    ws.onclose = () => { if (!this.closed) setTimeout(() => this.connect(), this.retryMs); };
  }

  send(m: ClientMsg): boolean {
    if (m.type === "hello") this.hello = m;
    if (this.open) { this.ws!.send(JSON.stringify(m)); return true; }
    if (m.type !== "frame") this.queue.push(m);
    return false;
  }

  close() { this.closed = true; this.ws?.close(); }
}
```

```ts
// D:/Ingenium/web/src/lib/recorder.ts
import type { FramePayload } from "./protocol";

export class Recorder {
  private frames: FramePayload[] = [];
  recording = false;
  constructor(private maxFrames = 90) {}
  start() { this.frames = []; this.recording = true; }
  add(f: FramePayload) {
    if (!this.recording) return;
    this.frames.push(f);
    if (this.frames.length >= this.maxFrames) this.recording = false;
  }
  stop(): FramePayload[] { this.recording = false; return this.frames; }
}

export async function upload(label: string, signer: string, frames: FramePayload[], fetchImpl: typeof fetch = fetch) {
  const r = await fetchImpl("/api/recordings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, signer, frames }),
  });
  if (!r.ok) throw new Error(`Error al guardar la grabación (${r.status})`);
  return (await r.json()) as { sample_id: string; frames: number };
}
```

- [ ] **Step 4: Correr todas las pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npm test`
Expected: todas PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add web/src/lib/socket.ts web/src/lib/socket.test.ts web/src/lib/recorder.ts web/src/lib/recorder.test.ts
git commit -m "feat(web): cliente WebSocket con reconexión y grabadora de muestras

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hooks y componentes base (con `design-taste-frontend`)

**Files:**
- Create: `D:\Ingenium\web\src\hooks\useCamera.ts`, `useVision.ts`, `useGloves.ts`, `useSession.ts`
- Create: `D:\Ingenium\web\src\components\StatusBar.tsx`, `CameraView.tsx`, `HandDiagram.tsx`, `ScoreCard.tsx`, `GlossChips.tsx`, `SentencePanel.tsx`, `Catalog.tsx`, `ReferencePlayer.tsx`

**Interfaces (contratos que usan las pantallas):**
- `useCamera(): { videoRef, ready: boolean, error: string | null }` — `getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" } })`; mensaje de error en español si se niega el permiso.
- `useVision(videoRef, ready, onFrame: (f: FramePayload) => void, gloves: () => FramePayload["gloves"])` — bucle `requestVideoFrameCallback` (con respaldo `requestAnimationFrame`), llama `vision.detect` y `onFrame`; expone `{ loading, error, fps, lastHands }`.
- `useGloves(): { supported, sides: { L: GloveState, R: GloveState }, connect(): Promise<void>, latest(): FramePayload["gloves"] }` con `GloveState = { connected: boolean, stale: boolean }` (`stale` si no llega línea en 500 ms).
- `useSession(mode, target): { send, last: Record<ServerMsg["type"], ServerMsg>, connected: boolean, events: ServerMsg[] }` — un `SessionSocket` a `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`; envía `hello` al cambiar `mode`/`target`.
- `StatusBar({ camera, gloves, connected, fps })` — estados con ícono + texto, no solo color.
- `CameraView({ videoRef, hands, mirrored = true })` — `<video>` + `<canvas>` superpuesto que dibuja las manos (solo visual, espejo por CSS).
- `HandDiagram({ fingers: number[] /* 5 valores −1..2 */, side: "derecha" | "izquierda" })` — SVG de una mano; cada dedo con `--color-ok/warn/bad` y además patrón o ícono accesible (`aria-label` "índice: mal").
- `ScoreCard({ scores, total, tips })` — 4 barras (Configuración, Ubicación, Movimiento, Orientación) + total + hasta 2 correcciones.
- `GlossChips({ items: { gloss, top3, confident }[], onConfirm(i, gloss), onRemove(i) })` — etiqueta con estilo distinto si `!confident`; al tocarla muestra las 3 opciones.
- `SentencePanel({ text, paragraph, source, onSpeak, onCopy })` — texto grande; indica "generado por IA" o "plantilla".
- `Catalog({ vocab, onPick })` — lista por categoría con búsqueda; marca las glosas sin referencia.
- `ReferencePlayer({ gloss })` — carga `/api/reference/{gloss}` y anima `example_hands` (16 cuadros) en un canvas en bucle, con control de velocidad (1×, 0.5×).

- [ ] **Step 1: Invocar `design-taste-frontend`** con `web/DESIGN.md` y la lista de componentes de arriba; seguir sus reglas al escribir cada componente. Todos los estilos usan solo variables de `tokens.css`.

- [ ] **Step 2: Implementar hooks y componentes** según los contratos. Reglas no negociables: textos en español; objetivos táctiles ≥ 44 px; foco visible (`--focus-ring`); ningún estado comunicado solo por color; `prefers-reduced-motion` desactiva animaciones no esenciales (el `ReferencePlayer` sigue, pero sin transiciones decorativas).

- [ ] **Step 3: Verificar tipos y build**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npm run build && npm test`
Expected: build sin errores y pruebas en verde.

- [ ] **Step 4: Aplicar el pre-flight check de `design-taste-frontend`** y anotar el resultado en el reporte.

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add web/src/hooks web/src/components
git commit -m "feat(web): hooks de cámara/visión/guantes/sesión y componentes base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Pantallas

**Files:**
- Create: `D:\Ingenium\web\src\screens\Home.tsx`, `Calibration.tsx`, `Practice.tsx`, `Translate.tsx`, `Record.tsx`, `Diagnostics.tsx`
- Modify: `D:\Ingenium\web\src\App.tsx`

**Comportamiento requerido por pantalla:**
- **Inicio:** dos tarjetas grandes (Práctica, Traducción), botón "Conectar guantes" (si `GloveSerial.supported()`; si no, texto "Tu navegador no permite conectar guantes; la app funciona solo con cámara") y `StatusBar`.
- **Calibración:** 3 pasos guiados con cuenta regresiva de 3 s y grabación de 2 s cada uno: "Mano abierta" → `calibrate open`, "Puño cerrado" → `calibrate fist`, "Listo" → `calibrate done`; muestra el resultado por guante (`sides`).
- **Práctica:** `Catalog` → al elegir una glosa manda `hello {mode: "practice", target}`; muestra `ReferencePlayer` y `CameraView` lado a lado (apilados en móvil), `HandDiagram` ×2 alimentado por `live.fingers`, y `ScoreCard` con el último `evaluation`. Aviso visual si llega `warning`.
- **Traducción:** `CameraView` + `GlossChips` (de los mensajes `sign`, corregibles) + `SentencePanel` (último `sentence`; al llegar uno nuevo se lee en voz alta si el interruptor "Voz" está activo) + botones "Formar oración ahora" (`build_sentence`) y "Borrar todo" (`reset`).
- **Grabar:** campos "Glosa" (autocompleta con `/api/vocab`, permite `NINGUNA`) y "Persona"; botón "Grabar" con cuenta regresiva de 3 s y 3 s de grabación (90 cuadros); contador de repeticiones por glosa en la sesión; muestra el `sample_id` guardado. Botón "Grabar 10 s de NINGUNA".
- **Diagnóstico:** por guante, las 6 IMU con su pitch/roll y estado (bit de `status`), los Hall con su valor, la tasa de líneas por segundo y la línea cruda más reciente; parsea las líneas en el navegador solo para mostrar (el servidor sigue siendo la fuente de verdad).

- [ ] **Step 1: Implementar las pantallas** con los componentes de la Task 5 y los tokens; ningún estilo nuevo fuera de los tokens.

- [ ] **Step 2: Build y pruebas**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npm run build && npm test`
Expected: sin errores.

- [ ] **Step 3: Prueba integrada con el servidor**

Run (dos procesos):
```bash
source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m lsm.app   # en segundo plano
cd D:/Ingenium/web && npm run dev -- --port 5173                         # en segundo plano
```
Abrir `http://localhost:5173` con `playwright-cli open http://localhost:5173 --browser=msedge`, tomar captura de Inicio y de Traducción y revisar la consola: sin errores; `StatusBar` muestra "Servidor conectado".

- [ ] **Step 4: Commit**

```bash
cd D:/Ingenium && git add web/src/screens web/src/App.tsx
git commit -m "feat(web): pantallas de práctica, traducción, calibración, grabación y diagnóstico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Auditoría y verificación visual (flujo del CLAUDE.md)

**Files:**
- Modify: los archivos de `web/src` que la auditoría señale.

- [ ] **Step 1: `web-design-guidelines`** — invocar la skill sobre `web/src` y corregir todo lo que marque como error (accesibilidad, contraste, foco, etiquetas, tamaños táctiles, idioma `lang="es"` en `index.html`).

- [ ] **Step 2: `playwright-cli`** — con el servidor y Vite corriendo (Task 6 Step 3): capturas de cada pantalla en escritorio (1440×900) y móvil (`--mobile` o `resize 390 844`) usando `--browser=msedge`; revisar la consola en cada una. Corregir lo que se vea mal (desbordes, texto cortado, contraste) y repetir las capturas.

- [ ] **Step 3: Build de producción servido por FastAPI**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/web && npm run build && cd D:/Ingenium && python -m lsm.app` (segundo plano) y abrir `http://127.0.0.1:8000` con `playwright-cli --browser=msedge`.
Expected: la app carga desde el mismo puerto que la API, sin errores en consola.

- [ ] **Step 4: Commit**

```bash
cd D:/Ingenium && git add web
git commit -m "fix(web): correcciones de auditoría de diseño y accesibilidad

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
