// Optional browser smoke test: npm install --prefix node_modules/.browsercheck playwright
// Start Vite, then: node scripts/check-alphabet.mjs (CHROME_PATH may override the executable).
import { chromium } from '../node_modules/.browsercheck/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
try {
  const page = await browser.newPage({ viewport: {width:1280, height:900} });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.cameraAudit = { calls:0, active:0, max:0 };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      window.cameraAudit.calls++;
      const stream = await original(...args);
      const audit = window.cameraAudit;
      audit.active++;
      audit.max = Math.max(audit.max, audit.active);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => { if (!stopped) { stopped = true; audit.active--; } stop(); };
      }
      return stream;
    };
  });
  await page.route('**/api/vocab', (r) => r.fulfill({json:[]}));
  await page.route('**/api/health', (r) => r.fulfill({json:{ok:true,classifier:true,references:0,llm:false,model:'classifier_v2'}}));
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('tab', {name:'Práctica', exact:true}).click();
  assert.equal(await page.getByRole('tab', {name:'Alfabeto', exact:true}).count(),0);
  await page.getByRole('button', {name:'Practicar Alfabeto'}).click();
  assert.equal(await page.getByRole('img', {name:/Fotografía LSM/}).count(),1);
  assert.equal(await page.evaluate(() => window.cameraAudit.calls),0);
  await page.getByRole('button', {name:'Abrir cámara', exact:true}).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('button', {name:'Siguiente letra', exact:true}).click();
  await page.getByRole('button', {name:'Letra específica', exact:true}).click();
  await page.getByRole('button', {name:'M', exact:true}).click();
  assert.equal(await page.locator('.alfa-ref-panel__letter').textContent(),'M');
  await page.getByRole('button', {name:'Libre',exact:true}).click();
  assert.equal(await page.evaluate(() => window.cameraAudit.calls),1);
  // Wait for the actual MediaPipe models and processing loop, not a mocked detector.
  await page.waitForFunction(() => /FPS\s*\d/.test(document.querySelector('.alfa-cam-panel')?.textContent || ''), null, {timeout:60000});
  await page.getByRole('button', {name:'Volver a Practica', exact:true}).click();
  await page.waitForFunction(() => window.cameraAudit.active === 0);
  await page.getByRole('button', {name:'Practicar Alfabeto'}).click();
  await page.getByRole('button', {name:'Abrir cámara', exact:true}).click();
  await page.waitForFunction(() => window.cameraAudit.active === 1);
  await page.getByRole('button', {name:'Detener cámara', exact:true}).click();
  await page.waitForFunction(() => window.cameraAudit.active === 0);
  for (const name of ['Inicio','Traducción','Calibración','Grabar','Diagnóstico','Práctica']) {
    await page.getByRole('tab', {name, exact:true}).click();
    await page.waitForTimeout(200);
  }
  await page.waitForFunction(() => window.cameraAudit.active === 0);
  assert.equal(await page.evaluate(() => window.cameraAudit.max),1);
  assert.deepEqual(errors,[]);
  console.log('PASS: navigation, modes, letter selection, real MediaPipe initialization, one stream, stop/re-entry, no runtime exceptions.');
  console.log(await page.evaluate(() => window.cameraAudit));
  await page.close();

  // Deterministic observations test the REAL classifier and UI hold/advance logic.
  // Only MediaPipe detections are replaced; this is not an accuracy benchmark.
  const test = await browser.newPage();
  await test.route('**/src/lib/vision.ts', (r) => r.fulfill({contentType:'application/javascript',body:`
    import data from '/src/data/alphabet_samples.json?import';
    export async function createVision() { return {
      detect(video,t,gloves) {
        const l=window.testLetter, index=data.letters.indexOf(l);
        const sample=data.samples[data.labels.indexOf(index)];
        let hand=sample ? Array.from({length:21},(_,i)=>sample.slice(i*3,i*3+3).map((v,a)=>v*100+[320,240,0][a])) : null;
        if (l==='?') hand=Array.from({length:21},()=>[0,0,0]);
        if (hand && window.testMotion) {
          const p=Math.min(1,(performance.now()-window.testMotion)/2300)*3;
          const path=[[0,0],[1,0],[0,.8],[1,.8]],j=Math.min(2,Math.floor(p)),r=p-j;
          hand=hand.map(v=>[v[0]+100*(path[j][0]*(1-r)+path[j+1][0]*r),v[1]+100*(path[j][1]*(1-r)+path[j+1][1]*r),v[2]]);
        }
        return {type:'frame',w:640,h:480,t,gloves,pose:null,face:null,hands:hand?[hand]:[]};
      },
      lastHands(){ return []; }, close(){}
    }; }
  `}));
  await test.goto('http://127.0.0.1:5173/#practica');
  await test.getByRole('button', {name:'Practicar Alfabeto'}).click();
  await test.getByRole('button', {name:'Abrir cámara',exact:true}).click();
  await test.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await test.evaluate(() => { window.testLetter = 'A'; });
  await test.waitForTimeout(350);
  assert.equal(await test.locator('.alfa-ref-panel__letter').textContent(),'A');
  assert.equal(await test.getByText('✓ ¡Correcto!',{exact:true}).count(),0);
  await test.evaluate(() => { window.testLetter = null; });
  await test.waitForTimeout(150);
  await test.evaluate(() => { window.testLetter = 'A'; });
  await test.waitForTimeout(550);
  assert.equal(await test.locator('.alfa-hold-bar').getAttribute('aria-valuenow') === '100',false);
  await test.waitForFunction(() => document.querySelector('.alfa-ref-panel__letter')?.textContent === 'B');
  await test.getByRole('button', {name:'Letra específica',exact:true}).click();
  await test.getByRole('button', {name:'M',exact:true}).click();
  await test.evaluate(() => { window.testLetter = 'M'; });
  await test.getByRole('button', {name:'Repetir letra',exact:true}).waitFor();
  await test.waitForTimeout(700);
  assert.equal(await test.locator('.alfa-ref-panel__letter').textContent(),'M');
  for (const letter of ['J','Ñ','Q','X','Z']) {
    await test.getByRole('button', {name:letter,exact:true}).click();
    await test.evaluate(l => { window.testLetter=l; },letter);
    await test.getByText('Prepárate...', {exact:true}).waitFor();
    assert.equal(await test.locator('.alfa-countdown').textContent(),'3');
    await test.waitForFunction(() => document.querySelector('.alfa-countdown')?.textContent==='2');
    await test.waitForFunction(() => document.querySelector('.alfa-countdown')?.textContent==='1');
    await test.getByText('● Capturando movimiento... (2.5 segundos)', {exact:true}).waitFor();
    assert.equal(await test.getByText('✓ ¡Correcto!',{exact:true}).count(),0);
    await test.getByRole('button', {name:'Reintentar',exact:true}).waitFor();
    assert.equal(await test.getByText('✓ ¡Correcto!',{exact:true}).count(),0);
    assert.match(await test.locator('.alfa-motion').textContent(),/cuadros/);
  }
  // Same Z pose now needs its entire ordered trajectory, not just the snapshot.
  await test.getByRole('button', {name:'Reintentar',exact:true}).click();
  await test.getByText('● Capturando movimiento... (2.5 segundos)', {exact:true}).waitFor();
  await test.evaluate(() => { window.testMotion=performance.now(); });
  await test.getByText('✓ ¡Correcto!',{exact:true}).waitFor();
  await test.evaluate(() => { window.testMotion=null; window.testLetter='A'; });
  await test.getByRole('button', {name:'Libre',exact:true}).click();
  assert.equal(await test.getByText(/Letra objetivo:/).count(),0);
  assert.equal(await test.getByText(/Intenta hacer/).count(),0);
  const free=test.getByRole('region',{name:'Reconocimiento libre',exact:true});
  await test.waitForFunction(() => document.querySelector('[aria-label="Reconocimiento libre"] strong')?.textContent==='A');
  await test.evaluate(() => { window.testLetter='B'; });
  await test.waitForTimeout(100);
  assert.equal(await free.locator('strong').textContent(),'A');
  await test.waitForFunction(() => document.querySelector('[aria-label="Reconocimiento libre"] strong')?.textContent==='B');
  for(let i=0;i<6;i++){await test.evaluate(l=>{window.testLetter=l;},i%2?'B':'C');await test.waitForTimeout(70);}
  assert.equal(await free.locator('strong').textContent(),'B');
  await test.evaluate(() => { window.testLetter=null; });
  await free.getByText('No reconocido. Ajusta la mano e intenta nuevamente.',{exact:true}).waitFor();
  await test.evaluate(() => { window.testLetter='?'; });
  await test.waitForTimeout(900);
  assert.equal(await free.locator('strong').count(),0);
  await test.getByRole('button', {name:'Letra específica',exact:true}).click();
  await test.getByRole('button', {name:'J',exact:true}).click();
  await test.getByText('Prepárate...', {exact:true}).waitFor();
  await test.getByRole('button', {name:'Libre',exact:true}).click();
  await test.waitForTimeout(3200);
  assert.equal(await test.getByRole('region',{name:'Práctica de movimiento',exact:true}).count(),0);
  console.log('PASS: static hold/reset/advance, all five dynamic countdowns and full captures reject frozen poses, Z requires ordered movement, Libre A→B hysteresis, missing/unknown, timer cancellation.');
  await test.close();
} finally { await browser.close(); }
