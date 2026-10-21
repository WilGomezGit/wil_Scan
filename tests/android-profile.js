// Perfil de CPU del hilo principal mientras se importa una foto en Android (busca congelaciones).
//   CPU_THROTTLE=4 node tests/android-profile.js
const path = require('path'), fs = require('fs');
const { connect, sleep } = require('./lib/android');
const FX = path.join(__dirname, 'fixtures'), j = JSON.stringify;
(async () => {
  const c = await connect({ restart: true });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  const thr = +(process.env.CPU_THROTTLE || 1);
  if (thr > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: thr });
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 2000 }); await c.send('Profiler.start');
  await c.ev(`(()=>{window.__gaps=[];let l=performance.now();setInterval(()=>{const n=performance.now();if(n-l>800)window.__gaps.push(Math.round(l)+'→'+Math.round(n-l)+'ms');l=n},100);return true})()`);
  const b64 = fs.readFileSync(path.join(FX, 'factura-persp.png')).toString('base64');
  await c.ev(`(async()=>{const b=Uint8Array.from(atob(${j(b64)}),ch=>ch.charCodeAt(0)); let f=new File([b],'f.png',{type:'image/png'}); if(${!!process.env.BIG}){const bm=await createImageBitmap(f); const cv=document.createElement('canvas'); cv.width=4032; cv.height=3024; const x=cv.getContext('2d'); x.fillStyle='#6b5b4b'; x.fillRect(0,0,4032,3024); x.drawImage(bm,500,100,3000,2850); const bl=await new Promise(r=>cv.toBlob(r,'image/jpeg',0.92)); f=new File([bl],'foto.jpg',{type:'image/jpeg'});} window.__f=f; return f.size})()`).then((n) => console.log('archivo:', n, 'bytes'));
  const t0 = Date.now();
  await c.ev(`(()=>{WilScan.importFiles([__f]); return true})()`);
  console.log('eval de importación:', Date.now() - t0, 'ms');
  await c.until(() => c.ev(`(document.querySelector('.ed-img')||{}).naturalWidth>300`), 120000, 500);
  console.log('editor visible a los', Date.now() - t0, 'ms · bloqueos:', j(await c.ev('__gaps')));
  await sleep(1500); console.log(j(await c.ev("import('./js/core/cv.js').then(m=>[m.perf.log,m.perf.ops,m.perf.engine])")));
  const prof = (await c.send('Profiler.stop')).result.profile;
  const out = path.join(process.env.OUT || '.', 'import.cpuprofile'); fs.writeFileSync(out, JSON.stringify(prof));
  // tiempo propio por función
  const byId = new Map(prof.nodes.map((n) => [n.id, n])), self = new Map();
  const dt = prof.timeDeltas; for (let i = 0; i < prof.samples.length; i++) { const n = byId.get(prof.samples[i]); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i + 1] || 0)); }
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms  ${k}`).join('\n'));
  await c.close(); process.exit(0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
