import { describe, expect, it } from "vitest";
import { analyzeMotion, analyzeMotionFor, BASE_EXTRA_MS, CAPTURE_MS, FREE_MOTION_LETTERS, FreeMotion, HAND_GAP_MS, LiveMotion, MOTION_START_POSES, motionStartOk, STATIC_EXTRA_MS, StaticGate, motionBaseLetter, PREPARE_MS, significantMotion, startPoseOk, trajectoryProgress, type MotionFrame } from "./alphabetMotion";
import { MOTION_LETTERS, predictAlphabet } from "./alphabet";
import { outOfFrame } from "./alphabetFeedback";
import references from "../data/alphabet_references.json";
import samples from "../data/alphabet_samples.json";

function sequence(letter: string, path: number[][], scale=100, offset=[320,240]): MotionFrame[] {
  const h=references.A;
  const unit=Math.hypot(...h[9].map((v,i)=>v-h[0][i]));
  return Array.from({length:26},(_,i)=>{
    const p=i/25*(path.length-1), j=Math.min(Math.floor(p),path.length-2), r=p-j;
    const xy=[0,1].map(a=>path[j][a]*(1-r)+path[j+1][a]*r);
    return {t:i*100,pose:[letter,.99],hand:h.map(v=>[v[0]*scale+offset[0]+xy[0]*unit*scale,v[1]*scale+offset[1]+xy[1]*unit*scale,v[2]*scale])};
  });
}

describe("dynamic sequence evidence (synthetic geometry, not linguistic accuracy)", () => {
  it("Ñ exige amplitud real aunque un arco pequeño tenga la forma correcta", () => {
    const small = sequence("Ñ", [[0,0],[.125,.08],[.25,.11],[.375,.08],[.5,0]]);
    expect(trajectoryProgress(small, "Ñ")).toBeLessThan(.9);
    expect(analyzeMotionFor(small, "Ñ").issue).toBe("too_small");
    expect(analyzeMotion(small).prediction).toBeNull();
  });
  it("Q acepta un arco suave sin aceptar una línea recta", () => {
    const arc = sequence("Q", [[0,0],[.25,.07],[.5,.1],[.75,.07],[1,0]]);
    expect(trajectoryProgress(arc, "Q")).toBeGreaterThanOrEqual(.9);
    expect(trajectoryProgress(sequence("Q", [[0,0],[1,0]]), "Q")).toBeLessThan(.9);
  });
  it("X acepta una ida y vuelta corta, pero exige el regreso", () => {
    expect(trajectoryProgress(sequence("X", [[0,0],[.35,0],[0,0]]), "X")).toBeGreaterThanOrEqual(.9);
    expect(trajectoryProgress(sequence("X", [[0,0],[.35,0]]), "X")).toBeLessThan(.9);
  });
  it("allows preparation and a full 2.5 second capture", () => {
    expect(PREPARE_MS).toBe(3000); expect(CAPTURE_MS).toBe(2500);
  });
  it.each([...MOTION_LETTERS])("never approves %s from one frame, stillness or straight movement", letter=>{
    expect(analyzeMotion(sequence(letter,[[0,0],[0,0]]).slice(0,1)).prediction).toBeNull();
    expect(analyzeMotion(sequence(letter,[[0,0],[0,0]])).prediction).toBeNull();
    expect(analyzeMotion(sequence(letter,[[0,0],[1,0]])).prediction).toBeNull();
  });
  it.each([
    ["J",[[0,0],[0,.8],[-.1,1],[-.35,1.1],[-.55,.95],[-.55,.7]]],
    ["Ñ",[[0,0],[.25,.16],[.5,.22],[.75,.16],[1,0]]],
    ["Q",[[0,0],[.25,.16],[.5,.22],[.75,.16],[1,0]]],
    ["X",[[0,0],[.7,0],[0,0]]],
    ["Z",[[0,0],[1,0],[0,.8],[1,.8]]],
  ] as [string,number[][]][])("requires compatible pose AND ordered %s trajectory; tolerates scale/translation", (letter,path)=>{
    expect(analyzeMotion(sequence(letter,path)).prediction?.[0]).toBe(letter);
    expect(analyzeMotion(sequence(letter,path,180,[700,400])).prediction?.[0]).toBe(letter);
    expect(analyzeMotion(sequence("A",path)).prediction).toBeNull();
  });
  it("rejects missing hands, sampling gaps and reversed Z",()=>{
    const z=sequence("Z",[[0,0],[1,0],[0,.8],[1,.8]]);
    const missing=z.map(f=>({...f}));missing[10].hand=null;
    expect(analyzeMotion(missing).prediction).toBeNull();
    expect(analyzeMotion(z.filter((_,i)=>i<10 || i>15)).prediction).toBeNull();
    expect(analyzeMotion([...z].reverse().map((f,i)=>({...f,t:i*100}))).prediction).toBeNull();
  });
  it("routes significant movement separately from a stationary pose",()=>{
    expect(significantMotion(sequence("A",[[0,0],[0,0]]))).toBe(false);
    expect(significantMotion(sequence("Z",[[0,0],[1,0],[0,.8],[1,.8]]))).toBe(true);
  });
});

describe("movement feedback for a known target (30 fps synthetic sequences from real J/D samples)", () => {
  const handOf = (s: number[]) => Array.from({length:21},(_,i)=>s.slice(i*3,i*3+3));
  const byLetter = (l: string) => samples.samples.filter((_,i)=>samples.letters[samples.labels[i]]===l).map(handOf);
  const J=[[0,0],[0,.8],[-.1,1],[-.35,1.1],[-.55,.95],[-.55,.7]], Z=[[0,0],[1,0],[0,.8],[1,.8]];
  const along=(path:number[][],u:number)=>{
    const seg=path.slice(1).map((p,i)=>Math.hypot(p[0]-path[i][0],p[1]-path[i][1]));
    let d=u*seg.reduce((a,b)=>a+b,0);
    for (let i=0;i<seg.length;i++){ if(d<=seg[i]||i===seg.length-1){const r=seg[i]?Math.min(1,d/seg[i]):0;return [0,1].map(a=>path[i][a]+(path[i+1][a]-path[i][a])*r);} d-=seg[i]; }
    return path.at(-1)!;
  };
  function capture(letter: string, path: number[][], t0: number, t1: number, o: {lost?: [number,number]; oy?: number; hand?: (t:number)=>number[][]}={}): MotionFrame[] {
    const base=byLetter(letter)[0], out: MotionFrame[]=[];
    for (let t=0;t<=CAPTURE_MS;t+=1000/30) {
      const [dx,dy]=along(path,Math.max(0,Math.min(1,(t-t0)/(t1-t0))));
      const h=o.lost && t>=o.lost[0] && t<=o.lost[1] ? null : (o.hand?.(t) ?? base).map(p=>[p[0]*110+320+dx*110,p[1]*110+(o.oy??260)+dy*110,p[2]*110]);
      out.push({t,hand:h,pose:h?predictAlphabet(h).pose:null,out:h?outOfFrame(h,640,480).out:false});
    }
    return out;
  }
  it.each([
    ["J correct", "J", () => capture("J",J,400,1900), "ok"],
    ["Z correct", "Z", () => capture("D",Z,400,1900), "ok"],
    ["J in 0.1 s", "J", () => capture("J",J,400,500), "too_fast"],
    ["Z in 0.15 s", "Z", () => capture("D",Z,400,550), "too_fast"],
    ["J without the hook", "J", () => capture("J",J.slice(0,2),400,1900), "incomplete"],
    ["J cut by the window", "J", () => capture("J",J,2000,3700), "cut_off"],
    ["J reversed", "J", () => capture("J",[...J].reverse().map(p=>[p[0]+.55,p[1]-.7]),400,1900), "reversed"],
    ["no movement", "J", () => capture("J",[[0,0],[0,0]],400,1900), "no_motion"],
    ["hand lost 0.3 s", "J", () => capture("J",J,400,1900,{lost:[1000,1300]}), "hand_lost"],
    ["hand leaves through the bottom", "J", () => capture("J",J,400,1900,{oy:400}), "out_of_frame"],
  ] as [string,string,()=>MotionFrame[],string][])("%s", (_name, target, make, issue) => {
    const r=analyzeMotionFor(make(), target);
    expect(r.issue).toBe(issue);
    expect(r.prediction?.[0] ?? null).toBe(issue === "ok" ? target : null);
  });
  it("wrong hand shape → says which finger, from the start pose (J starts as I)", () => {
    const r=analyzeMotionFor(capture("A",J,400,1900), "J");
    expect(r.issue).toBe("pose_lost");
    expect(r.reason).toBe("Mantén la forma de la mano durante todo el movimiento. Extiende el dedo meñique.");
  });
  it("start pose policy: J starts from I, Z from D, Q/X from their own pose", () => {
    expect(motionBaseLetter("J")).toBe("I"); expect(motionBaseLetter("Z")).toBe("D"); expect(motionBaseLetter("X")).toBe("X");
    expect(startPoseOk(["I",.9],"J")).toBe(true); expect(startPoseOk(["A",.9],"J")).toBe(false); expect(startPoseOk(["I",.3],"J")).toBe(false);
  });
  it("free mode reports too fast instead of approving a 0.1 s J", () => {
    expect(analyzeMotion(capture("J",J,400,500)).issue).toBe("too_fast");
    expect(analyzeMotion(capture("J",J,400,1900)).prediction?.[0]).toBe("J");
  });
});

describe("live tracking (no countdown, no fixed window)", () => {
  const handOf = (s: number[]) => Array.from({length:21},(_,i)=>s.slice(i*3,i*3+3));
  const byLetter = (l: string) => samples.samples.filter((_,i)=>samples.letters[samples.labels[i]]===l).map(handOf);
  const J=[[0,0],[0,.8],[-.1,1],[-.35,1.1],[-.55,.95],[-.55,.7]];
  const along=(path:number[][],u:number)=>{
    const seg=path.slice(1).map((p,i)=>Math.hypot(p[0]-path[i][0],p[1]-path[i][1]));
    let d=u*seg.reduce((a,b)=>a+b,0);
    for (let i=0;i<seg.length;i++){ if(d<=seg[i]||i===seg.length-1){const r=seg[i]?Math.min(1,d/seg[i]):0;return [0,1].map(a=>path[i][a]+(path[i+1][a]-path[i][a])*r);} d-=seg[i]; }
    return path.at(-1)!;
  };
  /** Holds the start pose, moves over [t0,t1] (optionally pausing), then stays still. */
  function run(letter: string, t0: number, t1: number, o: {path?: number[][]; lost?: [number,number]; pause?: [number,number]; end?: number} = {}) {
    const live=new LiveMotion("J"), base=byLetter(letter)[0], phases: string[]=[];
    let last: ReturnType<LiveMotion["push"]> | null = null;
    const pd=o.pause ? o.pause[1]-o.pause[0] : 0;
    for (let t=0;t<=(o.end ?? t1+1200);t+=1000/30) {
      const tt=o.pause && t>o.pause[0] ? Math.max(o.pause[0],t-pd) : t;
      const [dx,dy]=along(o.path ?? J,Math.max(0,Math.min(1,(tt-t0)/(t1-pd-t0))));
      const h=o.lost && t>=o.lost[0] && t<=o.lost[1] ? null : base.map(p=>[p[0]*110+320+dx*110,p[1]*110+230+dy*110,p[2]*110]);
      last=live.push({t,hand:h,pose:h?predictAlphabet(h).pose:null,out:h?outOfFrame(h,640,480).out:false});
      if (phases.at(-1)!==last.phase) phases.push(last.phase);
      if (last.phase==="result") break;
    }
    return {phases, result: last!.result};
  }
  it("waits for the start pose, follows the movement and evaluates when the hand stops", () => {
    const r=run("J",1200,2700);
    expect(r.phases).toEqual(["pose","ready","moving","result"]);
    expect(r.result?.issue).toBe("ok");
  });
  it("a slow J (3 s) and a short pause (0.3 s) are still one movement", () => {
    expect(run("J",1200,4200).result?.issue).toBe("ok");
    expect(run("J",1200,3000,{pause:[1900,2200]}).result?.issue).toBe("ok");
  });
  it.each([
    ["too fast", {t1:1350}, "too_fast"],
    ["stops halfway (0.8 s pause)", {t1:3500, pause:[1900,2700] as [number,number]}, "incomplete"],
    ["no hook", {t1:2200, path:J.slice(0,2)}, "incomplete"],
    ["hand lost (0.6 s: no es un cuadro perdido)", {t1:2700, lost:[1900,2500] as [number,number]}, "hand_lost"],
  ] as [string, {t1:number; path?: number[][]; pause?: [number,number]; lost?: [number,number]}, string][])("%s", (_n, o, issue) => {
    expect(run("J",1200,o.t1,o).result?.issue).toBe(issue);
  });
  it("reaching 100 % counts: moving the hand afterwards does not turn it into a wrong direction", () => {
    const after=[...J,[-.55,.7],[-.2,1.6],[.2,2.2]]; // J completa y luego la mano baja y se va de lado
    const r=run("J",1200,3200,{path:after});
    expect(r.result?.issue).toBe("ok");
  });
  it("if the live progress reached 100 %, a lost hand shape during the movement does not reject it", () => {
    const live=new LiveMotion("J"), base=byLetter("J")[0]; let last=null as ReturnType<LiveMotion["push"]> | null;
    for (let t=0;t<=4000 && last?.phase!=="result";t+=1000/30) {
      const [dx,dy]=along(J,Math.max(0,Math.min(1,(t-1200)/1500)));
      const h=base.map(p=>[p[0]*110+320+dx*110,p[1]*110+230+dy*110,p[2]*110]);
      // Al girar la mano el clasificador deja de ver la pose (como pasa con la cámara real).
      const lost = t>1500;
      last=live.push({t,hand:h,pose:lost ? null : predictAlphabet(h).pose,out:false, startOk: lost ? false : undefined});
    }
    expect(last?.result?.issue).toBe("ok");
  });
  it("X counts in any direction (out and back) and answers as soon as it is complete", () => {
    const hand=byLetter("X")[0];
    for (const path of [[[0,0],[.7,0],[0,0]], [[0,0],[0,.7],[0,.05]], [[0,0],[.5,.5],[.05,.05]]]) {
      const live=new LiveMotion("X"); let last=null as ReturnType<LiveMotion["push"]> | null, doneT=0;
      for (let t=0;t<=4000 && last?.phase!=="result";t+=1000/30) {
        const [dx,dy]=along(path,Math.max(0,Math.min(1,(t-1200)/1000)));
        const h=hand.map(p=>[p[0]*110+320+dx*110,p[1]*110+230+dy*110,p[2]*110]);
        last=live.push({t,hand:h,pose:predictAlphabet(h).pose,out:false,startOk:true}); doneT=t;
      }
      expect(last?.result?.issue).toBe("ok");
      expect(doneT).toBeLessThan(2500); // el trazo termina a los 2200 ms: no esperó la quietud
    }
  });
  it("X only going out (no return) is not approved", () => {
    const f=Array.from({length:40},(_,i)=>{const h=byLetter("X")[0].map(p=>[p[0]*110+320+Math.min(1,i/20)*.8*110,p[1]*110+230,p[2]*110]);return {t:i*33,hand:h,pose:predictAlphabet(h).pose,startOk:true} as MotionFrame;});
    expect(analyzeMotionFor(f,"X",{live:true}).issue).not.toBe("ok");
  });
  it("never leaves 'pose' with a wrong hand shape", () => {
    expect(run("A",1200,2700,{end:3000}).phases).toEqual(["pose"]);
  });
  it("progress estimates how much of the trajectory was done", () => {
    const f=(u:number)=>{const h=byLetter("J")[0]; return Array.from({length:30},(_,i)=>{const [dx,dy]=along(J,u*i/29);return {t:i*33,hand:h.map(p=>[p[0]*110+320+dx*110,p[1]*110+230+dy*110,p[2]*110]),pose:null} as MotionFrame;});};
    expect(trajectoryProgress(f(.4),"J")).toBeLessThan(.6);
    expect(trajectoryProgress(f(1),"J")).toBeGreaterThan(.9);
  });
});

describe("Libre: las letras con movimiento se siguen en vivo, sin letra objetivo", () => {
  const handOf = (s: number[]) => Array.from({length:21},(_,i)=>s.slice(i*3,i*3+3));
  const byLetter = (l: string) => samples.samples.filter((_,i)=>samples.letters[samples.labels[i]]===l).map(handOf);
  const along=(path:number[][],u:number)=>{
    const seg=path.slice(1).map((p,i)=>Math.hypot(p[0]-path[i][0],p[1]-path[i][1]));
    let d=u*seg.reduce((a,b)=>a+b,0);
    for (let i=0;i<seg.length;i++){ if(d<=seg[i]||i===seg.length-1){const r=seg[i]?Math.min(1,d/seg[i]):0;return [0,1].map(a=>path[i][a]+(path[i+1][a]-path[i][a])*r);} d-=seg[i]; }
    return path.at(-1)!;
  };
  const PATHS: Record<string, number[][]> = {
    J: [[0,0],[0,.8],[-.1,1],[-.35,1.1],[-.55,.95],[-.55,.7]],
    "Ñ": [[0,0],[.25,.16],[.5,.22],[.75,.16],[1,0]],
    Z: [[0,0],[1,0],[0,.8],[1,.8]],
    X: [[0,0],[0,.7],[0,.05]],
  };
  /** Igual que el hook: pose inicial de cada letra por clasificador o por verificación de la base. */
  function runFree(sampleLetter: string, path: number[][], t0: number, t1: number, sample = 0, fps = 30) {
    const free=new FreeMotion(), hand=byLetter(sampleLetter)[sample], moving: boolean[]=[], ready=new Set<string>();
    let failed: string | null = null;
    for (let t=0;t<=t1+1500;t+=1000/fps) {
      const [dx,dy]=along(path,Math.max(0,Math.min(1,(t-t0)/(t1-t0))));
      const h=hand.map(p=>[p[0]*110+320+dx*110,p[1]*110+230+dy*110,p[2]*110]);
      const prediction=predictAlphabet(h), startOk: Record<string, boolean> = {}, score: Record<string, number> = {};
      for (const l of FREE_MOTION_LETTERS) {
        const base=motionBaseLetter(l)!;
        startOk[l]=motionStartOk(prediction,h,l); void base;
        score[l]=prediction.shares[samples.letters.indexOf(base)] ?? 0;
      }
      const st=free.push({t,hand:h,pose:prediction.pose,out:outOfFrame(h,640,480).out},startOk,score);
      moving.push(st.moving); st.ready.forEach((l)=>ready.add(l));
      if (st.failed) failed=st.failed.issue;
      if (st.result) return {letter: st.result.prediction?.[0] ?? null, t, moving, ready, failed};
    }
    return {letter: null, t: Infinity, moving, ready, failed};
  }
  it.each([["J","J"],["Ñ","Ñ"],["Z","D"],["X","X"]])("reconoce la %s (hecha desde su pose inicial)", (letter, poseOf) => {
    const r=runFree(poseOf, PATHS[letter], 1200, 2400);
    expect(r.letter).toBe(letter);
    expect(r.moving.some(Boolean)).toBe(true);
  });
  it("un movimiento corto (0.7 s) también cuenta: ya no exige 2.2 s de grabación", () => {
    expect(runFree("Ñ", PATHS["Ñ"], 1200, 1900).letter).toBe("Ñ");
  });
  it.each([15, 30])("N con un arco pequeño no se convierte en Ñ a %s cuadros/s", (fps) => {
    const small = PATHS["Ñ"].map(([x,y])=>[x*.5,y*.5]);
    expect(runFree("Ñ", small, 1200, 2000, 0, fps).letter).toBeNull();
    expect(runFree("Ñ", PATHS["Ñ"], 1200, 2000, 0, fps).letter).toBe("Ñ");
  });
  it.each(["J","Ñ","Q","Z","X"])("cámara a 15 cuadros/s: la %s hecha en 0.45 s se reconoce", (letter) => {
    const pose={J:"J","Ñ":"Ñ",Q:"Q",Z:"D",X:"X"}[letter]!;
    expect(runFree(pose, PATHS[letter] ?? PATHS["Ñ"], 1200, 1650, 0, 15).letter).toBe(letter);
  });
  it("X lenta (1.5 s): la vuelta en el punto más lejano no la corta", () => {
    expect(runFree("X", [[0,0],[.5,.4],[.05,.05]], 1200, 2700, 0, 15).letter).toBe("X");
  });
  it("bajar la mano con la pose de I (a descansar) no es J; la J necesita su curva final", () => {
    expect(runFree("J", [[0,0],[0,1.2]], 1200, 2000).letter).toBeNull();
    expect(runFree("J", [[0,0],[.05,1.6]], 1200, 2200, 0, 15).letter).toBeNull();
    expect(runFree("J", PATHS.J, 1200, 2000, 0, 15).letter).toBe("J");
  });
  it("una Z hecha inclinada (20°) sigue siendo Z", () => {
    const r=.35, z=PATHS.Z.map(([x,y])=>[x*Math.cos(r)-y*Math.sin(r), x*Math.sin(r)+y*Math.cos(r)]);
    expect(runFree("D", z, 1200, 2000, 0, 15).letter).toBe("Z");
  });
  it("la X va y regresa por la misma línea: un cuadrado que vuelve al inicio no es X", () => {
    expect(runFree("X", [[0,0],[.6,0],[.6,.6],[0,.6],[0,0]], 1200, 2400, 0, 15).letter).toBeNull();
  });
  it("avisa qué pose inicial está lista y por qué no se aceptó un intento", () => {
    expect([...runFree("J", PATHS.J, 1200, 2400).ready]).toContain("J");
    const quick=runFree("D", PATHS.Z, 1200, 1350); // Z en 0.15 s
    expect(quick.letter).toBeNull();
    expect(quick.failed).toBe("too_fast");
  });
  it("una pose sin movimiento, o una letra estática que se desplaza, no se vuelven letras con movimiento", () => {
    expect(runFree("J", [[0,0],[0,0]], 1200, 2400).letter).toBeNull();
    expect(runFree("A", PATHS.Z, 1200, 2400).letter).toBeNull();
    expect(runFree("B", PATHS["Ñ"], 1200, 2400).letter).toBeNull();
  });
});

describe("pose inicial de las letras con movimiento (motionStartOk)", () => {
  const handOf = (s: number[]) => Array.from({length:21},(_,i)=>s.slice(i*3,i*3+3));
  const byLetter = (l: string) => samples.samples.filter((_,i)=>samples.letters[samples.labels[i]]===l).map(handOf);
  it("Q y X: vale la pose de cualquiera de las dos (se confunden entre sí; decide el movimiento)", () => {
    for (const [pose, letter] of [["Q","Q"],["X","X"],["X","Q"],["Q","X"]]) {
      const hs=byLetter(pose).slice(0,40);
      const ok=hs.filter((h)=>motionStartOk(predictAlphabet(h),h,letter)).length;
      expect(ok/hs.length).toBeGreaterThan(.9);
    }
  });
  it("una mano abierta (B) o un puño (A) no son pose inicial de ninguna", () => {
    for (const l of ["B","A"]) for (const h of byLetter(l).slice(0,20))
      for (const m of ["J","Ñ","Q","X","Z"]) expect(motionStartOk(predictAlphabet(h),h,m)).toBe(false);
  });
});

describe("Libre: cuándo se da por hecha una letra estática (StaticGate)", () => {
  const handOf = (s: number[]) => Array.from({length:21},(_,i)=>s.slice(i*3,i*3+3));
  const byLetter = (l: string) => samples.samples.filter((_,i)=>samples.letters[samples.labels[i]]===l).map(handOf);
  const at = (h: number[][], dx=0) => h.map(p=>[p[0]*100+300+dx*100,p[1]*100+220,p[2]*100]);
  it("con la mano quieta sí; moviéndose no", () => {
    const g=new StaticGate(), a=byLetter("A")[0];
    let still=false;
    for (let t=0;t<=600;t+=66) still=g.observe({t,hand:at(a),pose:null}).still;
    expect(still).toBe(true);
    for (let t=666;t<=1200;t+=66) still=g.observe({t,hand:at(a,(t-666)/300),pose:null}).still;
    expect(still).toBe(false);
  });
  it("N se reconoce sin esperar a Ñ; I y D conservan su espera adicional", () => {
    expect(MOTION_START_POSES).toEqual(new Set(["I","D"]));
    const g=new StaticGate();
    expect(g.gate(0, ["A",.9])).toBeNull();
    expect(g.gate(STATIC_EXTRA_MS, ["A",.9])?.[0]).toBe("A");
    expect(g.gate(STATIC_EXTRA_MS+10, ["I",.9])).toBeNull();
    expect(g.gate(STATIC_EXTRA_MS+10+STATIC_EXTRA_MS, ["I",.9])).toBeNull();
    expect(g.gate(STATIC_EXTRA_MS+10+BASE_EXTRA_MS, ["I",.9])?.[0]).toBe("I");
    expect(g.gate(1000, ["N",.9])).toBeNull();
    expect(g.gate(1000+STATIC_EXTRA_MS, ["N",.9])?.[0]).toBe("N");
  });
  it("perder la mano un instante no cuenta como que se fue", () => {
    const g=new StaticGate(), a=byLetter("A")[0];
    g.observe({t:0,hand:at(a),pose:null});
    expect(g.observe({t:200,hand:null,pose:null}).present).toBe(true);
    expect(g.observe({t:200+HAND_GAP_MS+100,hand:null,pose:null}).present).toBe(false);
  });
});

describe("cámara real: MediaPipe pierde la mano un cuadro a media letra", () => {
  const handOf = (s: number[]) => Array.from({length:21},(_,i)=>s.slice(i*3,i*3+3));
  const byLetter = (l: string) => samples.samples.filter((_,i)=>samples.letters[samples.labels[i]]===l).map(handOf);
  it("una J con 2 cuadros sin mano en medio sigue siendo J", () => {
    const J=[[0,0],[0,.8],[-.1,1],[-.35,1.1],[-.55,.95],[-.55,.7]];
    const seg=J.slice(1).map((p,i)=>Math.hypot(p[0]-J[i][0],p[1]-J[i][1])), tot=seg.reduce((a,b)=>a+b,0);
    const along=(u:number)=>{let d=u*tot;for(let i=0;i<seg.length;i++){if(d<=seg[i]||i===seg.length-1){const r=Math.min(1,d/seg[i]);return [0,1].map(a=>J[i][a]+(J[i+1][a]-J[i][a])*r);}d-=seg[i];}return J.at(-1)!;};
    const live=new LiveMotion("J"), hand=byLetter("J")[0]; let last=null as ReturnType<LiveMotion["push"]> | null;
    for (let t=0;t<=4000 && last?.phase!=="result";t+=1000/15) {
      const [dx,dy]=along(Math.max(0,Math.min(1,(t-1200)/800)));
      const lost=t>1500 && t<1650;
      const h=lost ? null : hand.map(p=>[p[0]*100+300+dx*100,p[1]*100+200+dy*100,p[2]*100]);
      last=live.push({t,hand:h,pose:h?predictAlphabet(h).pose:null,out:false,startOk:!lost});
    }
    expect(last?.result?.issue).toBe("ok");
  });
});
