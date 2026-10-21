// Prueba de estrés en Android: lote grande de fotos de 12 MP, toques rápidos, exportar; vigila memoria, cierres y consola.
//   N=8 node tests/android-stress.js
const path = require('path'), fs = require('fs');
const { connect, sleep, adb } = require('./lib/android');
const FX = path.join(__dirname, 'fixtures'), j = JSON.stringify;
const N = +(process.env.N || 8), PKG = 'com.wg.wilscan';
let c, fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const clickText = (sel, txt) => c.ev(`(()=>{const e=[...document.querySelectorAll(${j(sel)})].find(x=>x.textContent.trim().toLowerCase().includes(${j(txt.toLowerCase())})); if(!e) return false; e.click(); return true})()`);
const idle = (ms = 180000) => c.until(() => c.ev(`!document.querySelector('.ed-stage.working') && !document.querySelector('.busy')`), ms, 150);
const mem = () => { try { const o = adb('shell', 'dumpsys', 'meminfo', PKG); const m = /TOTAL PSS:\s+(\d+)/.exec(o) || /TOTAL\s+(\d+)/.exec(o); return m ? Math.round(+m[1] / 1024) : -1; } catch { return -1; } };
const pid = () => adb('shell', 'pidof', PKG).trim();

(async () => {
  c = await connect({ restart: true });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  await c.ev(`new Promise((r)=>{const q=indexedDB.deleteDatabase('wilscan'); q.onsuccess=q.onerror=q.onblocked=()=>r(true)})`);
  if (process.env.LANES) await c.ev(`localStorage.setItem('wilscan-lanes', ${j(process.env.LANES)}); true`); else await c.ev(`localStorage.removeItem('wilscan-lanes'); true`);
  await c.send('Page.reload'); await sleep(1500);
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  adb('logcat', '-c');
  const pid0 = pid(), mem0 = mem();
  console.log(`Memoria inicial: ${mem0} MB · núcleos ${await c.ev('navigator.hardwareConcurrency')} · RAM ${await c.ev('navigator.deviceMemory')} GB`);

  // N fotos de 12 MP (4032×3024) con la factura en perspectiva
  const b64 = fs.readFileSync(path.join(FX, 'factura-persp.png')).toString('base64');
  await c.ev(`(async()=>{ const b=Uint8Array.from(atob(${j(b64)}),ch=>ch.charCodeAt(0)); const bm=await createImageBitmap(new Blob([b],{type:'image/png'})); window.__fs=[]; for(let n=0;n<${N};n++){ const cv=document.createElement('canvas'); cv.width=4032; cv.height=3024; const x=cv.getContext('2d'); x.fillStyle='#6b5b4b'; x.fillRect(0,0,4032,3024); x.drawImage(bm,500,100,3000,2850); x.fillStyle='#000'; x.font='bold 120px sans-serif'; x.fillText('Pagina '+(n+1),2800,2950); const bl=await new Promise(r=>cv.toBlob(r,'image/jpeg',0.9)); window.__fs.push(new File([bl],'foto'+(n+1)+'.jpg',{type:'image/jpeg'})); } return __fs.length})()`);
  let t0 = Date.now();
  await c.ev(`WilScan.importFiles(__fs).then(()=>{window.__imp=Date.now()}); true`);
  await c.until(() => c.ev(`!!window.__imp`), 600000, 300);
  const tOpen = Date.now() - t0;
  const docId = await c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const q=r.result.transaction('docs').objectStore('docs').getAll(); q.onsuccess=()=>res(q.result[0]&&q.result[0].id)}})`);
  await c.ev('WilScan.openDoc(' + j(docId) + '); true');
  const opened = await c.until(() => c.ev(`(document.querySelector('.ed-img')||{}).naturalWidth>300`), 60000, 300);
  check(`importar ${N} fotos de 12 MP abre el editor`, !!opened, `${(tOpen / 1000).toFixed(1)} s · memoria ${mem()} MB`);
  const allFull = await c.until(() => c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const q=r.result.transaction('pages').objectStore('pages').getAll(); q.onsuccess=()=>res(q.result.length===${N} && q.result.every((p)=>!p.draft))}; r.onerror=()=>res(false)})`), 600000, 500);
  const tFull = Date.now() - t0;
  check('todas las páginas completas terminan en segundo plano', !!allFull, `${(tFull / 1000).toFixed(1)} s en total · memoria ${mem()} MB`);
  check('la app sigue viva', pid() === pid0 && !!pid());

  // toques rápidos: pasar páginas, girar y cambiar filtro sin esperar
  const errs0 = c.logs.length;
  t0 = Date.now();
  for (let i = 0; i < 12; i++) {
    await clickText('.ed-tool', 'Girar'); await sleep(90);
    await clickText('.ed-nav.r', ''); await sleep(90);
    await clickText('.flt', ['Grises', 'Blanco', 'Mejorado', 'Color', 'Nota', 'Nítido'][i % 6]); await sleep(90);
  }
  const done = await idle();
  check('toques rápidos: la app termina de procesar todo', !!done, `${((Date.now() - t0) / 1000).toFixed(1)} s · memoria ${mem()} MB`);
  check('toques rápidos: sin errores en consola', c.logs.length === errs0, c.logs.slice(errs0).join(' | ').slice(0, 300));
  const frozen = await c.ev(`new Promise((res)=>{const t=performance.now(); requestAnimationFrame(()=>res(Math.round(performance.now()-t)))})`);
  check('la pantalla responde (un fotograma < 300 ms)', frozen < 300, frozen + ' ms');

  // «Aplicar a todas»: el caso que más se beneficiaría de varios núcleos
  t0 = Date.now();
  const hasAll = await c.ev(`(()=>{const i=document.querySelector('.ed-flt label.all input'); if(!i) return false; i.click(); return true})()`);
  await clickText('.ed-flt .flt', 'Blanco');
  await sleep(500); await idle(600000);
  console.log(`  ⏱ Filtro «Blanco y negro» a las ${N} páginas${hasAll ? '' : ' (opción «Todas» no encontrada: solo una)'}: ${((Date.now() - t0) / 1000).toFixed(1)} s · memoria ${mem()} MB`);

  // exportar PDF de todas las páginas
  await idle();
  t0 = Date.now();
  await c.ev(`window.__sent=null; const S=window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.Share; if(S){ S.share = async (o)=>{ window.__sent=o; return {}; }; } true`);
  await c.ev(`(()=>{const e=document.querySelector('.ed-top .btn.primary'); e.click(); return true})()`);
  await c.until(() => c.ev(`!!document.querySelector('.sheet .seg')`), 8000);
  await c.ev(`(()=>{const s=[...document.querySelectorAll('.sheet .check input')].find(i=>/buscable/i.test(i.parentElement.textContent)); if(s&&s.checked) s.click(); return true})()`);   // sin OCR: mide el PDF
  await clickText('.sheet-foot .btn', 'Compartir');
  const ok = await c.until(() => c.ev(`!!window.__sent`), 240000, 300);
  check(`exportar un PDF de ${N} páginas`, !!ok, `${((Date.now() - t0) / 1000).toFixed(1)} s · memoria ${mem()} MB`);

  // registro del sistema: cierres, ANR, falta de memoria
  const log = adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'chromium:E', 'ActivityManager:W', 'lowmemorykiller:I', 'DEBUG:F');
  const bad = log.split('\n').filter((l) => /FATAL|ANR|Out of memory|OutOfMemory|crash|killed|Render process gone/i.test(l));
  check('sin cierres ni falta de memoria en el registro del sistema', !bad.length, bad.slice(0, 3).join(' | '));
  check('la app sigue viva al final', pid() === pid0, `pid ${pid0} → ${pid()}`);
  console.log(`Memoria final: ${mem()} MB · núcleos de imagen usados: ${await c.ev("import('./js/core/cv.js').then(m=>m.perf.lanes||1)")}`);
  await c.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
