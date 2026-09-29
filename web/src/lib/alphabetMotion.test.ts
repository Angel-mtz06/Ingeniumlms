import { describe, expect, it } from "vitest";
import { analyzeMotion, analyzeMotionFor, CAPTURE_MS, LiveMotion, motionBaseLetter, PREPARE_MS, significantMotion, startPoseOk, trajectoryProgress, type MotionFrame } from "./alphabetMotion";
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
    ["hand lost", {t1:2700, lost:[1900,2100] as [number,number]}, "hand_lost"],
  ] as [string, {t1:number; path?: number[][]; pause?: [number,number]; lost?: [number,number]}, string][])("%s", (_n, o, issue) => {
    expect(run("J",1200,o.t1,o).result?.issue).toBe(issue);
  });
  it("reaching 100 % counts: moving the hand afterwards does not turn it into a wrong direction", () => {
    const after=[...J,[-.55,.7],[-.2,1.6],[.2,2.2]]; // J completa y luego la mano baja y se va de lado
    const r=run("J",1200,3200,{path:after});
    expect(r.result?.issue).toBe("ok");
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
