// Vite must be running. Diagnostic on the existing SEP photographs, never training data.
import { chromium } from '../node_modules/.browsercheck/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const page=await browser.newPage();
  await page.route('**/alphabet-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body>LSM reference diagnostic</body></html>'}));
  await page.goto('http://127.0.0.1:5173/alphabet-probe');
  const results=await page.evaluate(async()=>{
    const {createVision}=await import('/src/lib/vision.ts');
    const {predictAlphabet,alphabetFeatures,MOTION_LETTERS}=await import('/src/lib/alphabet.ts');
    const old=(await import('/src/data/alphabet_classifier.json?import')).default;
    const before=(h)=>{
      const f=alphabetFeatures(h);
      const d=old.centroids.map(c=>c.reduce((s,v,i)=>s+((f[i]-v)/old.std[i])**2,0)/71);
      const b=Math.min(...d), p=1/d.reduce((s,v)=>s+Math.exp(-(v-b)/.03),0);
      return b>.9 || p<.65 ? null : [old.letters[d.indexOf(b)],p];
    };
    const vision=await createVision('/mediapipe','CPU');
    const img=new Image();img.src='/alphabet/lsm-sep.jpg';await img.decode();
    const ratio=img.naturalWidth/1280;
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    const ctx=canvas.getContext('2d');let x=44,y=315,mirror=false;
    const paint=()=>{ctx.save();ctx.fillStyle='white';ctx.fillRect(0,0,640,480);if(mirror){ctx.translate(640,0);ctx.scale(-1,1);}ctx.drawImage(img,x*ratio,y*ratio,186*ratio,210*ratio,160,50,300,340);ctx.restore();};
    paint();const stream=canvas.captureStream(30), timer=setInterval(paint,30);
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;document.body.append(video);
    const out=[];
    try {
      await video.play();
      const letters=[...'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'];
      for (let i=0;i<letters.length;i++) {
        const row=Math.floor(i/6),col=i%6;
        x=row===4?[342,546,748][col]:[44,246,447,647,848,1050][col];y=[315,608,892,1181,1472][row];
        for (const reflected of [false,true]) {
          mirror=reflected;
          let frame;
          for(let n=0;n<3;n++){await new Promise(r=>setTimeout(r,90));frame=vision.detect(video,performance.now(),{L:null,R:null});}
          const hand=frame.hands[0];const start=performance.now();const prediction=hand?predictAlphabet(hand):null;
          out.push({letter:letters[i],dynamic:MOTION_LETTERS.has(letters[i]),mirrored:mirror,hands:frame.hands.length,before:hand?before(hand):null,after:prediction,inference_ms:performance.now()-start});
        }
      }
    } finally {clearInterval(timer);stream.getTracks().forEach(t=>t.stop());vision.close();}
    return out;
  });
  await writeFile(new URL('../../docs/alphabet-photo-probe.json',import.meta.url),JSON.stringify({note:'One SEP photo per letter, real MediaPipe CPU, not a signer-independent benchmark or a temporal test.',results},null,2));
  console.log(JSON.stringify(results.filter(r=>'BCMN'.includes(r.letter)),null,2));
  console.log('All letters saved to docs/alphabet-photo-probe.json');
} finally {await browser.close();}
