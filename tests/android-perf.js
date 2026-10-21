// Prueba de uso y rendimiento DENTRO de Android (BlueStacks/emulador): importar, girar, filtrar, recortar, OCR, exportar.
//   node tests/android-perf.js       (APK de depuración instalado; ver tests/lib/android.js)
const path = require('path'), fs = require('fs'), os = require('os');
const { connect, sleep } = require('./lib/android');
const FX = path.join(__dirname, 'fixtures');
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'wilscan-android'); fs.mkdirSync(OUT, { recursive: true });
const j = JSON.stringify;
let c, fails = 0;
const rows = [];
const check = (n, ok, d = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const click = (sel) => c.ev(`(()=>{const e=document.querySelector(${j(sel)}); if(!e) return false; e.click(); return true})()`);
const clickText = (sel, txt) => c.ev(`(()=>{const e=[...document.querySelectorAll(${j(sel)})].find(x=>x.textContent.trim().toLowerCase().includes(${j(txt.toLowerCase())})); if(!e) return false; e.click(); return true})()`);
// entrega un archivo a la app como si se hubiera elegido en el selector (el selector nativo no se puede automatizar)
const importFile = (name, type) => c.ev(`(()=>{const b=Uint8Array.from(atob(${j(fs.readFileSync(path.join(FX, name)).toString('base64'))}),ch=>ch.charCodeAt(0)); WilScan.importFiles([new File([b],${j(name)},{type:${j(type)}})]); return true})()`);
const working = () => c.ev(`!!document.querySelector('.ed-stage.working') || !!document.querySelector('.busy')`);
const wf = (fn, ms = 60000, step = 50) => c.until(fn, ms, step);
// cronometra: t1 = cuando la pantalla responde (condición «visto»), t2 = cuando termina todo el trabajo
async function timed(label, action, seen, ms = 90000) {
  const t0 = Date.now();
  await action();
  const s = seen ? await wf(seen, ms) : true;
  const t1 = Date.now() - t0;
  await sleep(80);
  await wf(async () => !(await working()), ms);
  const t2 = Date.now() - t0;
  rows.push({ label, visto: seen ? t1 : null, terminado: t2 });
  console.log(`  ⏱ ${label}: se ve en ${seen ? t1 + ' ms' : '—'} · termina en ${t2} ms`);
  return { ok: !!s, t1, t2 };
}

(async () => {
  c = await connect({ restart: true });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  // datos limpios
  await c.ev(`new Promise((r)=>{const q=indexedDB.deleteDatabase('wilscan'); q.onsuccess=q.onerror=q.onblocked=()=>r(true)})`);
  await c.send('Page.reload'); await sleep(1500);
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  const info = await c.ev(`({ua: navigator.userAgent.match(/Chrome\\/[\\d.]+/)[0], w: innerWidth, h: innerHeight, dpr: devicePixelRatio, cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory || null})`);
  console.log('Android WebView:', j(info));
  const thr = +(process.env.CPU_THROTTLE || 1);
  if (thr > 1) { const r = await c.send('Emulation.setCPUThrottlingRate', { rate: thr }); console.log('CPU ralentizada x' + thr, r.error ? 'NO SOPORTADO: ' + r.error.message : 'ok'); }

  if (process.env.WARM) { const t=Date.now(); await c.ev("import('./js/core/cv.js').then(m=>m.loadCV())"); console.log('motor listo en', Date.now()-t, 'ms (espera previa)'); }
  if (process.env.DIAG) await c.ev("(()=>{window.__gaps=[];let l=performance.now();setInterval(()=>{const n=performance.now();if(n-l>800)window.__gaps.push(Math.round(l)+'→'+Math.round(n-l)+'ms');l=n},100);window.__t0=performance.now();return true})()");
  // 1) importar una foto
  const r1 = await timed('Importar foto (crear documento)', () => importFile('factura-persp.png', 'image/png'), () => c.ev(`(document.querySelector('.ed-img')||{}).naturalWidth>300`));
  check('importar una foto abre el editor con la página recortada', r1.ok);
  // la página se abre como borrador (resolución de pantalla) y la imagen completa llega detrás
  { const t = Date.now(); const full = await c.until(() => c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const q=r.result.transaction('pages').objectStore('pages').getAll(); q.onsuccess=()=>res(q.result.length>0 && q.result.every((p)=>!p.draft))}; r.onerror=()=>res(false)})`), 60000, 300);
    console.log(`  ⏱ Imagen completa de la página lista ${Date.now() - t} ms después de abrirse`); check('la imagen completa sustituye al borrador', !!full);
    const w = await c.until(() => c.ev(`(document.querySelector('.ed-img')||{}).naturalWidth>=1300 && document.querySelector('.ed-img').naturalWidth`), 8000); check('el editor muestra la imagen completa', !!w, String(w)); }
  await c.shot(path.join(OUT, 'a1-editor.png'));
  if (process.env.DIAG) console.log('t0', await c.ev('Math.round(__t0)'), 'bloqueos del hilo principal:', j(await c.ev('__gaps')));
  if (process.env.DIAG) console.log(j(await c.ev("import('./js/core/cv.js').then(m=>({log:m.perf.log,ops:m.perf.ops,e:m.perf.engine}))")));
  const eng = await c.ev(`import('./js/core/cv.js').then(m=>m.perf.engine)`);
  check('el motor de imagen corre en segundo plano (Worker)', /Worker/.test(eng), eng);

  // 2) girar
  const key = () => c.ev(`document.querySelector('.ed-img').src + '|' + !document.querySelector('.ed-live').hidden`);
  let k0 = await key();
  const r2 = await timed('Girar 90°', () => clickText('.ed-tool', 'Girar'), async () => (await key()) !== k0);
  check('girar responde', r2.ok);
  await c.until(() => c.ev(`(()=>{const i=document.querySelector('.ed-img'); return i.naturalWidth > i.naturalHeight})()`), 5000);   // la imagen definitiva se descodifica antes de mostrarse
  const dims = await c.ev(`({w: document.querySelector('.ed-img').naturalWidth, h: document.querySelector('.ed-img').naturalHeight})`);
  check('la página queda apaisada tras girar', dims.w > dims.h, `${dims.w}×${dims.h}`);
  await timed('Girar 90° (2.ª vez)', () => clickText('.ed-tool', 'Girar'), null);
  await timed('Girar 90° (3.ª vez)', () => clickText('.ed-tool', 'Girar'), null);
  await timed('Girar 90° (4.ª vez, vuelve al original)', () => clickText('.ed-tool', 'Girar'), null);

  // 3) filtros desde el carrusel
  for (const f of ['Blanco y negro', 'Grises', 'Mejorado']) {
    k0 = await key();
    const r = await timed(`Filtro «${f}»`, () => clickText('.flt', f), async () => (await key()) !== k0);
    check(`filtro «${f}» responde`, r.ok);
  }
  await c.shot(path.join(OUT, 'a2-filtros.png'));

  // 4) recortar
  const r4 = await timed('Abrir el recorte', () => clickText('.ed-tool', 'Recortar'), () => c.ev(`document.querySelectorAll('.crop-h').length===4`));
  check('se abre el recorte', r4.ok);
  await sleep(400); await c.shot(path.join(OUT, 'a3-recorte.png'));
  const r5 = await timed('Aplicar el recorte', () => clickText('.crop-foot .btn', 'Aplicar'), () => c.ev(`!document.querySelector('.crop')`));
  check('aplicar el recorte cierra la pantalla', r5.ok);

  // 5) texto (OCR)
  const r6 = await timed('Reconocer texto (OCR)', () => clickText('.ed-tool', 'Texto'), () => c.ev(`/FACTURA 2026-0042/i.test((document.querySelector('.sheet textarea')||{}).value||'')`), 120000);
  check('el OCR funciona dentro de Android', r6.ok, (await c.ev(`(document.querySelector('.sheet textarea')||{}).value||''`)).slice(0, 40));
  await c.shot(path.join(OUT, 'a4-texto.png'));
  await c.ev(`document.querySelector('.backdrop .sheet-head .icon-btn') && document.querySelector('.backdrop .sheet-head .icon-btn').click(); true`); await sleep(400);

  // 6) exportar PDF (buscable) — se intercepta la hoja de compartir para medir sin abrir Android
  await c.ev(`window.__sent=null; const S=window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.Share; if(S){ S.share = async (o)=>{ window.__sent=o; return {}; }; } true`);
  await click('.ed-top .btn.primary'); await wf(() => c.ev(`!!document.querySelector('.sheet .seg')`), 5000);
  const r7 = await timed('Exportar PDF buscable y compartir', () => clickText('.sheet-foot .btn', 'Compartir'), () => c.ev(`!!window.__sent`), 120000);
  const sent = await c.ev(`window.__sent`);
  check('exportar entrega un PDF a la hoja de compartir de Android', r7.ok && sent && sent.files && /\.pdf$/.test(sent.files[0]), j(sent));

  // 7) diagnóstico interno
  const log = await c.ev(`import('./js/core/cv.js').then(m=>m.perf.log.slice(0,8))`);
  console.log('Diagnóstico de la app:\n  ' + log.join('\n  '));
  if (c.logs.length) console.log('Errores de consola:', c.logs.slice(0, 5).join(' | '));
  fs.writeFileSync(path.join(OUT, 'tiempos.json'), j({ info, rows, log }, null, 1));
  await c.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
