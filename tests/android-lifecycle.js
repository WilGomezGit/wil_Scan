// Ciclo de vida en Android: app al fondo y de vuelta, botón Atrás, y cierre forzado en medio de una importación.
//   node tests/android-lifecycle.js
const path = require('path'), fs = require('fs');
const { connect, sleep, adb } = require('./lib/android');
const FX = path.join(__dirname, 'fixtures'), j = JSON.stringify, PKG = 'com.wg.wilscan', N = 6;
let c, fails = 0, step = 'inicio', finished = false;
process.on('exit', () => { if (!finished) console.log('  (el script terminó sin acabar; último paso: ' + step + ')'); });
const check = (n, ok, d = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const pid = () => { try { return adb('shell', 'pidof', PKG).trim(); } catch { return ''; } };
const pagesState = () => c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const q=r.result.transaction('pages').objectStore('pages').getAll(); q.onsuccess=()=>res({n:q.result.length, draft:q.result.filter(p=>p.draft).length, noOut:q.result.filter(p=>!p.out||!p.thumb||!p.orig).length})}; r.onerror=()=>res(null)})`);
// toque real (cuenta como gesto del usuario: Android ignora el historial creado sin gestos)
const tap = async (sel) => { const r = await c.ev(`(()=>{const e=document.querySelector(${j('${SEL}')}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2}})()`.replace('${SEL}', sel.replace(/'/g, "\'"))); if (!r) return false; for (const t of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type: t, x: r.x, y: r.y, button: 'left', clickCount: 1 }); return true; };
const importBatch = async () => {
  const b64 = fs.readFileSync(path.join(FX, 'factura-persp.png')).toString('base64');
  await c.ev(`(async()=>{ const b=Uint8Array.from(atob(${j(b64)}),ch=>ch.charCodeAt(0)); const bm=await createImageBitmap(new Blob([b],{type:'image/png'})); const fs=[]; for(let n=0;n<${N};n++){ const cv=document.createElement('canvas'); cv.width=4032; cv.height=3024; const x=cv.getContext('2d'); x.fillStyle='#6b5b4b'; x.fillRect(0,0,4032,3024); x.drawImage(bm,500,100,3000,2850); const bl=await new Promise(r=>cv.toBlob(r,'image/jpeg',0.9)); fs.push(new File([bl],'f'+n+'.jpg',{type:'image/jpeg'})); } window.__imp=null; WilScan.importFiles(fs).then(()=>{window.__imp=1}); return fs.length })()`);
};
const reset = async () => {
  c = await connect({ restart: true });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  await c.ev(`new Promise((r)=>{const q=indexedDB.deleteDatabase('wilscan'); q.onsuccess=q.onerror=q.onblocked=()=>r(true)})`);
  await c.send('Page.reload'); await sleep(1500);
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
};

(async () => {
  // 1) al fondo durante la importación y de vuelta
  await reset();
  const p0 = pid();
  await importBatch(); await sleep(2500);
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(8000);
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`); await sleep(2500);
  check('la app sigue viva tras estar en segundo plano', pid() === p0 && !!pid(), `${p0} → ${pid()}`);
  let alive = true; try { await c.ev('1+1'); } catch { alive = false; }
  if (!alive) { await c.close(); c = await connect({ restart: false }); }
  const done = await c.until(async () => { const s = await pagesState(); return s && s.n === N && s.draft === 0; }, 180000, 700);
  const st = await pagesState();
  check(`las ${N} páginas terminan tras volver`, !!done, JSON.stringify(st));
  check('ninguna página quedó incompleta', st && st.noOut === 0, JSON.stringify(st));
  const f = await c.ev(`new Promise((res)=>{const t=performance.now(); requestAnimationFrame(()=>res(Math.round(performance.now()-t)))})`);
  check('la pantalla responde al volver', f < 500, f + ' ms');

  step = 'atrás en editor';
  // 2) botón Atrás: editor → biblioteca (la app no se cierra)
  const docId = await c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const q=r.result.transaction('docs').objectStore('docs').getAll(); q.onsuccess=()=>res(q.result[0]&&q.result[0].id)}})`);
  await c.ev(`WilScan.show('docs'); true`); await sleep(500);
  await tap('.doc-open');
  await c.until(() => c.ev(`!!document.querySelector('.ed')`), 15000);
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1200);
  { let still = 'sin conexión'; try { still = await c.ev(`!!document.querySelector('.ed')`); } catch { /* la app se cerró */ }
    check('Atrás en el editor vuelve a la biblioteca sin cerrar la app', still === false && !!pid(), `editor abierto: ${still} · pid ${pid()} · historia ${await c.ev('history.length').catch(() => '?')}`); }
  await tap('.fab'); await sleep(1800);
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1200);
  check('Atrás en el escáner vuelve a la biblioteca', !(await c.ev(`!!document.querySelector('.scan')`)) && !!pid());

  // Herramientas → hoja → Atrás cierra la hoja; Atrás otra vez vuelve a Documentos; Atrás en Documentos sale de la app
  await tap('.tabbar [data-tab=tools]'); await sleep(700);
  await tap('.tool'); await c.until(() => c.ev(`!!document.querySelector('.sheet')`), 5000);
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(900);
  check('Atrás cierra la hoja de una herramienta y deja Herramientas', !(await c.ev(`!!document.querySelector('.backdrop')`)) && (await c.ev(`document.querySelector('#v-tools').classList.contains('on')`)));
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(900);
  check('Atrás en Herramientas vuelve a Documentos', !!(await c.ev(`document.querySelector('#v-docs').classList.contains('on')`)) && !!pid());
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1500);
  const top = adb('shell', 'dumpsys', 'activity', 'activities').split(String.fromCharCode(10)).filter((l) => /mResumedActivity/.test(l))[0] || '';
  check('Atrás en Documentos sale de la app', top.indexOf(PKG) < 0, top.trim().slice(0, 80));
  step = 'cierre forzado';
  // 3) cierre forzado en medio de la importación (como si Android matara la app por falta de memoria)
  await reset();
  await importBatch(); await sleep(4000);
  adb('shell', 'am', 'force-stop', PKG); await sleep(1500);
  await c.close(); c = await connect({ restart: false });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  const after = await pagesState();
  console.log('  estado tras el cierre forzado:', JSON.stringify(after));
  check('tras el cierre forzado no hay páginas dañadas (todas tienen imagen, miniatura y original)', !after || after.noOut === 0, JSON.stringify(after));
  const docs = await c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const q=r.result.transaction('docs').objectStore('docs').getAll(); q.onsuccess=()=>res(q.result.map(d=>({id:d.id,n:d.pageCount})))}})`);
  if (docs.length) {
    await c.ev('WilScan.openDoc(' + j(docs[0].id) + '); true');
    const fin = await c.until(async () => { const s = await pagesState(); return s && s.draft === 0; }, 120000, 700);
    check('al reabrir el documento, las páginas a medias se terminan solas', !!fin, JSON.stringify(await pagesState()));
  } else console.log('  (la importación no llegó a guardar ningún documento antes del cierre: nada que recuperar)');
  const errs = c.logs.filter((l) => !/safe area/.test(l));
  check('sin errores en consola', !errs.length, errs.slice(0, 3).join(' | '));
  finished = true;
  await c.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
