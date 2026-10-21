// Recorre las pantallas de WilScan dentro de Android, guarda capturas y pasa el auditor de diseño (solapes, desbordes, contraste).
//   node tests/android-screens.js
const path = require('path'), fs = require('fs'), os = require('os');
const { connect, sleep } = require('./lib/android');
const { source: auditSource } = require('./layout-audit');
const FX = path.join(__dirname, 'fixtures');
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'wilscan-android'); fs.mkdirSync(OUT, { recursive: true });
const j = JSON.stringify;
let c, fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const click = (sel) => c.ev(`(()=>{const e=document.querySelector(${j(sel)}); if(!e) return false; e.click(); return true})()`);
const clickText = (sel, txt) => c.ev(`(()=>{const e=[...document.querySelectorAll(${j(sel)})].find(x=>x.textContent.trim().toLowerCase().includes(${j(txt.toLowerCase())})); if(!e) return false; e.click(); return true})()`);
const exists = (sel) => c.ev(`!!document.querySelector(${j(sel)})`);
const importFile = (name, type) => c.ev(`(()=>{const b=Uint8Array.from(atob(${j(fs.readFileSync(path.join(FX, name)).toString('base64'))}),ch=>ch.charCodeAt(0)); WilScan.importFiles([new File([b],${j(name)},{type:${j(type)}})]); return true})()`);
const closeSheets = async () => { for (let i = 0; i < 4; i++) { if (!(await exists('.backdrop'))) break; await click('.backdrop .sheet-head .icon-btn'); await sleep(300); } };
async function screen(name) {
  await sleep(500);
  await c.shot(path.join(OUT, name + '.png'));
  const top = await c.ev(`(()=>{document.querySelectorAll('[data-audit-top]').forEach(e=>e.removeAttribute('data-audit-top')); const b=[...document.querySelectorAll('.backdrop')].pop(); if(b){b.setAttribute('data-audit-top',''); return true} return false})()`);
  const issues = (await c.ev(auditSource({ ignore: ['.fab', '.tabbar'], ...(top ? { scope: '[data-audit-top]' } : {}) }))).filter((i) => !/\.scan-video|\.ed-img|\.crop-img/.test(i.el));
  check(`diseño: ${name}`, !issues.length, issues.slice(0, 6).map((i) => `${i.type}: ${i.el} → ${i.msg}`).join(' | '));
}

(async () => {
  c = await connect({ restart: true });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  await c.ev(`new Promise((r)=>{const q=indexedDB.deleteDatabase('wilscan'); q.onsuccess=q.onerror=q.onblocked=()=>r(true)})`);
  await c.send('Page.reload'); await sleep(1500);
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  console.log('Pantalla:', j(await c.ev(`({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})`)));
  await screen('b01-inicio');
  await c.ev(`WilScan.show('tools'); true`); await screen('b02-herramientas');
  await c.ev(`WilScan.show('settings'); true`); await screen('b03-ajustes');
  await c.ev(`WilScan.show('docs'); true`);
  await importFile('factura-persp.png', 'image/png');
  await c.until(() => c.ev(`(document.querySelector('.ed-img')||{}).naturalWidth>300`), 60000);
  await c.until(() => c.ev(`!document.querySelector('.ed-stage.working')`), 30000);
  await sleep(2500);
  await screen('b04-editor');
  const prev = await c.ev(`[...document.querySelectorAll('.flt-prev')].map(k=>{const c2=document.createElement('canvas'); c2.width=k.naturalWidth||1; c2.height=k.naturalHeight||1; const x=c2.getContext('2d'); x.drawImage(k,0,0); const d=x.getImageData(0,0,c2.width,c2.height).data; let dark=0; for(let i=0;i<d.length;i+=16) if(d[i]<120) dark++; return k.naturalWidth+'x'+k.naturalHeight+':'+dark})`);
  check('las miniaturas de los filtros muestran la página', prev.every((p) => +p.split(':')[1] > 5), prev.join(' '));
  await clickText('.ed-tool', 'Recortar'); await c.until(() => c.ev(`document.querySelectorAll('.crop-h').length===4`), 10000); await screen('b05-recorte');
  await clickText('.crop-foot .btn', 'Cancelar'); await sleep(500);
  await clickText('.ed-tool', 'Texto'); await c.until(() => c.ev(`((document.querySelector('.sheet textarea')||{}).value||'').length>20`), 90000); await screen('b06-texto');
  await closeSheets();
  await click('.ed-top .btn.primary'); await c.until(() => exists('.sheet .seg'), 5000); await screen('b07-exportar');
  await closeSheets();
  await clickText('.ed-tool', 'Ordenar'); await sleep(600); await closeSheets();
  await click('.ed-top .icon-btn'); await sleep(800); await screen('b08-biblioteca');
  await click('.fab'); await c.until(() => exists('.scan'), 5000); await sleep(2500); await screen('b09-escaner');
  await click('.scan-top .icon-btn'); await sleep(600);
  if (c.logs.length) console.log('Errores de consola:', c.logs.filter((l) => !/safe area/.test(l)).slice(0, 6).join(' | '));
  await c.close();
  console.log(fails ? `\n${fails} FALLOS · capturas en ${OUT}` : `\nTODO OK · capturas en ${OUT}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
