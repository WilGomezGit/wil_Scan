// Pruebas de uso real de WilScan en un Chrome de verdad con cámara simulada: escanear, editar, OCR, exportar y herramientas.
global.__navLog = true;
//   node tests/app.e2e.js [--only=a,b]      (necesita node tools/serve.js en 5180 y node tests/make-fixtures.js hecho)
const fs = require('fs'), os = require('os'), path = require('path');
const { launch, sleep } = require('./lib/chrome');
const { source: auditSource } = require('./layout-audit');
const BASE = process.env.BASE || 'http://localhost:5180';
const FX = path.join(__dirname, 'fixtures');
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'wilscan-e2e-out'); fs.mkdirSync(OUT, { recursive: true });
const DL = path.join(os.tmpdir(), 'wilscan-e2e-dl-' + Date.now()); fs.mkdirSync(DL, { recursive: true });
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
let fails = 0, group = '';
const check = (n, ok, d = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) { fails++; failed.push(group + ' › ' + n + (d ? ' [' + d + ']' : '')); } };
const failed = [];
const j = JSON.stringify;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

let c;
const click = (sel) => c.ev(`(()=>{const e=document.querySelector(${j(sel)}); if(!e) return false; e.click(); return true})()`);
const clickText = (sel, txt) => c.ev(`(()=>{const e=[...document.querySelectorAll(${j(sel)})].find(x=>x.textContent.trim().toLowerCase().includes(${j(txt.toLowerCase())})); if(!e) return false; e.click(); return true})()`);
const exists = (sel) => c.ev(`!!document.querySelector(${j(sel)})`);
const text = (sel) => c.ev(`(document.querySelector(${j(sel)})||{}).textContent`);
const count = (sel) => c.ev(`document.querySelectorAll(${j(sel)}).length`);
const wf = (fn, ms = 15000, step = 200) => c.until(fn, ms, step);
const shot = (name) => c.shot(path.join(OUT, name + '.png'));
const dbPages = () => c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const g=r.result.transaction('pages').objectStore('pages').getAll(); g.onsuccess=()=>res(g.result.map(p=>({id:p.id,docId:p.docId,filter:p.filter,rot:p.rot,skew:p.skew,quad:p.quad,text:p.text,w:p.w,h:p.h,words:p.words?p.words.length:0})))}})`);
const dbDocs = () => c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const g=r.result.transaction('docs').objectStore('docs').getAll(); g.onsuccess=()=>res(g.result.map(d=>({id:d.id,title:d.title,pageCount:d.pageCount,pageIds:d.pageIds})))}})`);
const downloads = () => fs.readdirSync(DL).filter((n) => !/\.crdownload$/.test(n)).map((n) => ({ n, t: fs.statSync(path.join(DL, n)).mtimeMs, p: path.join(DL, n) })).sort((a, b) => a.t - b.t);
async function newDownloads(before, n = 1, ms = 90000) {
  const t0 = Date.now(), known = new Set(before.map((x) => x.n));
  while (Date.now() - t0 < ms) { const now = downloads().filter((x) => !known.has(x.n)); if (now.length >= n && !fs.readdirSync(DL).some((f) => /\.crdownload$/.test(f))) { await sleep(300); return downloads().filter((x) => !known.has(x.n)); } await sleep(300); }
  return downloads().filter((x) => !known.has(x.n));
}
const pdfInfo = (file) => c.ev(`(async()=>{ const T=await import(${j(BASE + '/js/core/pdf-tools.js')}); const b=Uint8Array.from(atob(${j(fs.readFileSync(file).toString('base64'))}),ch=>ch.charCodeAt(0)); const n=await T.pageCount(b); let t=''; try{t=await T.pdfToText(b)}catch(e){} const doc=await T.openForRender(b); const rots=[]; for(let i=1;i<=doc.numPages;i++) rots.push((await doc.getPage(i)).rotate); return {n, t, rots}; })()`);
const setSelect = (sel, v) => c.ev(`(()=>{const e=document.querySelector(${j(sel)}); e.value=${j(v)}; e.dispatchEvent(new Event('change',{bubbles:true})); return e.value})()`);
const setInput = (sel, v) => c.ev(`(()=>{const e=document.querySelector(${j(sel)}); e.value=${j(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return e.value})()`);
const rectOf = (sel) => c.ev(`(()=>{const e=document.querySelector(${j(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2}})()`);
async function drag(from, to, steps = 10) { await c.mouse('mouseMoved', from[0], from[1], { buttons: 0 }); await c.mouse('mousePressed', from[0], from[1]); for (let i = 1; i <= steps; i++) { await c.mouse('mouseMoved', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps); await sleep(15); } await c.mouse('mouseReleased', to[0], to[1], { buttons: 0 }); }
const closeSheets = async () => { for (let i = 0; i < 4; i++) { if (!(await exists('.backdrop'))) break; await click('.backdrop .sheet-head .icon-btn'); await sleep(250); } };
const audit = async (label, opts = {}) => { const top = await c.ev(`(()=>{document.querySelectorAll('[data-audit-top]').forEach(e=>e.removeAttribute('data-audit-top')); const b=[...document.querySelectorAll('.backdrop')].pop(); if(b){b.setAttribute('data-audit-top',''); return true} return false})()`); const issues = await c.ev(auditSource({ ignore: ['.fab', '.tabbar'], ...(top ? { scope: '[data-audit-top]' } : {}), ...opts })); const real = issues.filter((i) => !/\.scan-video|\.ed-img|\.sign-page|\.crop-img/.test(i.el)); check(`diseño: ${label}`, real.length === 0, real.slice(0, 6).map((i) => `${i.type}: ${i.el} → ${i.msg}`).join(' | ')); return real; };

const G = {};

G.arranque = async () => {
  check('la app arranca sin errores de consola', c.logs.filter((l) => !/favicon|^NAV /.test(l)).length === 0, c.logs.join(' | ').slice(0, 300));
  check('muestra el estado vacío con «Escanear» e «Importar»', (await text('.empty h2')) === 'Aún no hay documentos' && (await count('.empty .btn')) === 2);
  await c.ev(`WilScan.show('tools'); true`);
  check('Herramientas: 15 herramientas en 3 grupos', (await count('.tool')) === 15 && (await count('#v-tools .section-title')) === 3, String(await count('.tool')));
  await c.ev(`WilScan.show('settings'); true`);
  check('Ajustes: muestra versión y la marca WG', /versión 1\.0\.0/.test(await text('.about')) && /WG — Wilmar Gómez/.test(await text('.about')));
  await c.ev(`WilScan.show('docs'); true`);
};

G.escaneo = async () => {
  await click('.fab');
  check('el escáner se abre', !!(await wf(() => exists('.scan'), 4000)));
  const ready = await wf(() => c.ev(`(document.querySelector('.scan-video')||{}).videoWidth>0`), 15000);
  check('la cámara (simulada) entrega imagen', !!ready, await c.ev(`(document.querySelector('.scan-video')||{}).videoWidth + 'x' + (document.querySelector('.scan-video')||{}).videoHeight`));
  const det = await wf(() => c.ev(`/Mantén|Listo/.test(document.querySelector('.scan-hint').textContent)`), 25000, 300);
  check('detecta el documento en vivo y lo indica', !!det, await text('.scan-hint'));
  const painted = await c.ev(`(()=>{const o=document.querySelector('.scan-overlay'), p=o.querySelector('polygon'); return o.classList.contains('none') ? 0 : (p.getAttribute('points')||'').split(' ').filter(Boolean).length})()`);
  check('dibuja el contorno del documento sobre la cámara', painted === 4, painted + ' esquinas');
  await shot('01-escaner');
  await audit('escáner (móvil)');
  await click('.scan-shutter');
  // tras cada foto se muestra «Revisa el recorte» (Ajustes › Revisar el recorte): se confirma como haría una persona
  const review = await wf(() => c.ev(`!!document.querySelector('.crop') && document.querySelectorAll('.crop-h').length===4`), 15000);
  check('tras la foto se muestra el recorte para confirmarlo', !!review);
  await shot('01b-revisar-recorte');
  await clickText('.crop-foot .btn', 'Confirmar');
  check('1.ª foto: aparece el contador 1', !!(await wf(() => c.ev(`(document.querySelector('.scan-count')||{}).textContent==='1'`), 15000)));
  await wf(() => c.ev(`!document.querySelector('.scan-shutter').disabled`), 10000);
  await click('.scan-shutter');
  await wf(() => exists('.crop'), 15000); await clickText('.crop-foot .btn', 'Confirmar');
  check('2.ª foto: el contador pasa a 2 (lote)', !!(await wf(() => c.ev(`(document.querySelector('.scan-count')||{}).textContent==='2'`), 15000)));
  await clickText('.scan-mode', 'Identificación');
  check('el modo Identificación pide el anverso', /ANVERSO/.test(await text('.scan-hint')), await text('.scan-hint'));
  await clickText('.scan-mode', 'Documento');
  await click('.scan-done');
  check('«Terminar» crea el documento y abre el editor', !!(await wf(() => exists('.ed'), 25000)));
  const docs = await dbDocs();
  check('el documento tiene 2 páginas guardadas', docs.length === 1 && docs[0].pageCount === 2 && /^Escaneo /.test(docs[0].title), j(docs.map((d) => [d.title, d.pageCount])));
};

G.editor = async () => {
  await wf(() => c.ev(`(document.querySelector('.ed-img')||{}).naturalWidth>300`), 10000);
  const dim = await c.ev(`({w: document.querySelector('.ed-img').naturalWidth, h: document.querySelector('.ed-img').naturalHeight})`);
  check('la foto salió recortada y enderezada (proporción de folio)', Math.abs(dim.w / dim.h - 0.77) < 0.1, `${dim.w}×${dim.h}`);
  check('muestra «1 / 2» y 2 miniaturas', (await text('.ed-counter')) === '1 / 2' && (await count('.ed-thumb:not(.add)')) === 2);
  await shot('02-editor'); await audit('editor (móvil)');
  // siguiente página
  await click('.ed-nav.r'); await sleep(300);
  check('pasar de página funciona', (await text('.ed-counter')) === '2 / 2');
  await click('.ed-nav.l'); await sleep(200);

  // filtros: blanco y negro en todas las páginas
  await clickText('.ed-tool', 'Filtros');
  check('se abre la hoja de filtros con 6 filtros', !!(await wf(() => c.ev(`document.querySelectorAll('.flt').length===6`), 8000)));
  await clickText('.flt', 'Blanco y negro');
  const livePrev = await wf(() => c.ev(`!document.querySelector('.ed-live').hidden`), 8000);
  check('la vista previa en vivo se muestra al elegir filtro', !!livePrev);
  await shot('03-filtros'); await audit('hoja de filtros (móvil)');
  await c.ev(`(()=>{const k=document.querySelector('.sheet .check input'); if(k && !k.checked) k.click(); return true})()`);
  await click('.sheet-foot .btn.primary');
  await wf(() => c.ev(`!document.querySelector('.busy')`), 30000);
  const pg = await dbPages();
  check('«Aplicar a todas»: las 2 páginas quedan en blanco y negro', pg.length === 2 && pg.every((p) => p.filter === 'bn'), j(pg.map((p) => p.filter)));
  const bin = await c.ev(`(async()=>{const i=document.querySelector('.ed-img'); await i.decode(); const k=document.createElement('canvas'); k.width=i.naturalWidth; k.height=i.naturalHeight; k.getContext('2d').drawImage(i,0,0); const d=k.getContext('2d').getImageData(0,0,k.width,k.height).data; let n=0,b=0; for(let x=0;x<d.length;x+=4*30){n++; if(d[x]<40||d[x]>215) b++} return b/n})()`);
  check('la imagen mostrada es realmente blanco y negro', bin > 0.95, (bin * 100).toFixed(0) + ' %');

  // girar
  await clickText('.ed-tool', 'Girar');
  // el giro se ve al instante y se guarda en segundo plano: se espera a que termine y a que se muestre la imagen definitiva
  await wf(async () => (await c.ev(`!document.querySelector('.busy') && !document.querySelector('.ed-stage.working') && (()=>{const i=document.querySelector('.ed-img'); return i.naturalWidth > i.naturalHeight})()`)), 20000);
  const rot = (await dbPages()).find((p) => p.rot === 90);
  const dim2 = await c.ev(`({w: document.querySelector('.ed-img').naturalWidth, h: document.querySelector('.ed-img').naturalHeight})`);
  check('«Girar» gira la página 90° (ahora es apaisada)', !!rot && dim2.w > dim2.h, `${dim2.w}×${dim2.h}`);
  // 3 toques seguidos (sin esperar, como una persona impaciente): los giros se encadenan y al final queda la orientación original
  for (let i = 0; i < 3; i++) { await clickText('.ed-tool', 'Girar'); await sleep(120); }
  await wf(() => c.ev(`!document.querySelector('.ed-stage.working') && (()=>{const i=document.querySelector('.ed-img'); return i.naturalHeight > i.naturalWidth})()`), 30000);
  check('4 giros vuelven a la orientación original', (await dbPages()).every((p) => p.rot === 0 || p.rot === 90) && (await c.ev(`document.querySelector('.ed-img').naturalHeight>document.querySelector('.ed-img').naturalWidth`)));

  // recortar: arrastrar una esquina
  const firstId = async () => (await dbDocs())[0].pageIds[0];
  const quadOf = async () => (await dbPages()).find(async () => true) && (await dbPages()).find((p) => p.id === (docIds[0])).quad;
  let docIds = (await dbDocs())[0].pageIds;
  const before = (await dbPages()).find((p) => p.id === docIds[0]).quad;
  await clickText('.ed-tool', 'Recortar');
  check('se abre el recorte con 4 esquinas', !!(await wf(() => c.ev(`document.querySelectorAll('.crop-h').length===4`), 10000)));
  await sleep(600); await shot('04-recorte'); await audit('recorte (móvil)');
  const h0 = await c.ev(`(()=>{const r=document.querySelectorAll('.crop-h')[0].getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]})()`);
  await drag(h0, [h0[0] + 10, h0[1] + 8]);
  const h1 = await c.ev(`(()=>{const r=document.querySelectorAll('.crop-h')[0].getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]})()`);
  check('la esquina se arrastra con el puntero', Math.hypot(h1[0] - h0[0] - 10, h1[1] - h0[1] - 8) < 4, `movió ${Math.round(h1[0] - h0[0])},${Math.round(h1[1] - h0[1])}`);
  await clickText('.crop-foot .btn', 'Aplicar');
  await wf(() => c.ev(`!document.querySelector('.busy') && !document.querySelector('.crop') && !document.querySelector('.ed-stage.working')`), 30000);
  const after = (await dbPages()).find((p) => p.id === docIds[0]).quad;
  check('el recorte se aplica y se guarda', !!after && (!before || JSON.stringify(after) !== JSON.stringify(before)));

  // texto (OCR)
  await clickText('.ed-tool', 'Texto');
  const ocr = await wf(() => c.ev(`/FACTURA 2026-0042/i.test((document.querySelector('.sheet textarea')||{}).value||'')`), 60000, 500);
  check('«Texto» reconoce el contenido de la página (OCR)', !!ocr, (await c.ev(`(document.querySelector('.sheet textarea')||{}).value||''`)).split('\n')[0]);
  const t = norm(await c.ev(`document.querySelector('.sheet textarea').value`));
  check('el texto incluye datos de la tabla y el total', /1\.250,00 eur/.test(t) && /licencia wilscan/.test(t));
  await shot('05-texto'); await audit('hoja de texto (móvil)');
  await clickText('.sheet-foot .btn', 'Copiar');
  check('«Copiar» avisa de que copió el texto', !!(await wf(() => c.ev(`/Texto copiado/.test((document.querySelector('#toast')||{}).textContent||'')`), 4000)));
  await closeSheets();

  // ordenar
  await clickText('.ed-tool', 'Ordenar');
  check('«Ordenar» muestra las 2 páginas', !!(await wf(() => c.ev(`document.querySelectorAll('.ord').length===2`), 6000)));
  await audit('hoja de ordenar (móvil)');
  const firstBefore = (await dbDocs())[0].pageIds[0];
  await c.ev(`document.querySelectorAll('.ord')[1].querySelectorAll('button')[0].click(); true`);
  await clickText('.sheet-foot .btn', 'Guardar orden'); await sleep(600);
  const firstAfter = (await dbDocs())[0].pageIds[0];
  check('el nuevo orden se guarda (la página 2 pasa a ser la 1)', firstAfter !== firstBefore);
};

G.exportar = async () => {
  await click('.ed-top .btn.primary');
  check('«Exportar» abre la hoja con PDF / Imágenes / Texto', !!(await wf(() => c.ev(`[...document.querySelectorAll('.sheet .seg button')].map(b=>b.textContent).join()==='PDF,Imágenes,Texto'`), 6000)));
  await shot('06-exportar'); await audit('hoja de exportar (móvil)');
  // PDF buscable
  let before = downloads();
  await c.ev(`(()=>{const i=document.querySelector('.sheet .field input'); i.value='Factura de prueba'; i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
  await clickText('.sheet-foot .btn', 'Guardar');
  const pdf = await newDownloads(before, 1, 120000);
  check('«Guardar» descarga un PDF con el nombre elegido', pdf.length === 1 && pdf[0].n === 'Factura de prueba.pdf', pdf.map((x) => x.n).join());
  if (pdf[0]) {
    const info = await pdfInfo(pdf[0].p);
    check('el PDF tiene las 2 páginas', info.n === 2, String(info.n));
    check('el PDF es buscable: contiene el texto reconocido', /factura 2026-0042/.test(norm(info.t)) && /total a pagar/.test(norm(info.t)), norm(info.t).slice(0, 60));
    fs.copyFileSync(pdf[0].p, path.join(DL, '_base.pdf.keep')); fs.copyFileSync(pdf[0].p, path.join(DL, 'exportado.pdf'));
  }
  // imágenes
  await click('.ed-top .btn.primary'); await wf(() => exists('.sheet .seg'), 4000);
  await clickText('.sheet .seg button', 'Imágenes');
  before = downloads();
  await clickText('.sheet-foot .btn', 'Guardar');
  const jpgs = await newDownloads(before, 2, 30000);
  check('«Imágenes» descarga un JPG por página', jpgs.length === 2 && jpgs.every((x) => /\.jpg$/.test(x.n)), jpgs.map((x) => x.n).join());
  // texto
  await click('.ed-top .btn.primary'); await wf(() => exists('.sheet .seg'), 4000);
  await clickText('.sheet .seg button', 'Texto');
  before = downloads();
  await clickText('.sheet-foot .btn', 'Guardar');
  const txt = await newDownloads(before, 1, 90000);
  check('«Texto» descarga un .txt con el contenido', txt.length === 1 && /1\.250,00 EUR/.test(fs.readFileSync(txt[0].p, 'utf8')), txt.map((x) => x.n).join());
  await closeSheets();
};

G.compartir = async () => {
  // la hoja de compartir del sistema se simula: se comprueba qué archivo recibe (WhatsApp, correo, Telegram… son apps que cuelgan de esa hoja)
  await c.ev(`window.__shared = []; window.__opened = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared.push({ title: d.title, files: d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }); }; window.open = (u) => { window.__opened.push(u); return null; }; true`);
  await click('.ed-top .btn.primary'); await wf(() => exists('.sheet .seg'), 4000);
  check('la hoja de exportar anuncia WhatsApp, correo, Telegram y Discord', /WhatsApp, correo, Telegram, Discord/.test(await text('.sheet')) && /Compartir…/.test(await text('.sheet-foot')));
  await c.ev(`(()=>{ [...document.querySelectorAll('.sheet .check input')].forEach((i)=>{ if (i.checked && /buscable/.test(i.parentElement.textContent)) i.click(); }); return true })()`);
  await clickText('.sheet-foot .btn', 'Compartir');
  const got = await wf(() => c.ev(`window.__shared.length>0`), 60000);
  const sh = got ? await c.ev(`window.__shared[0]`) : null;
  check('«Compartir…» entrega el PDF a la hoja de compartir del sistema', !!sh && sh.files.length === 1 && sh.files[0].type === 'application/pdf' && /.pdf$/.test(sh.files[0].name) && sh.files[0].size > 1000, j(sh));
  await sleep(500); check('con la hoja del sistema no se muestran accesos alternativos', !(await c.ev(`/Enviar el archivo/.test(document.body.textContent)`)));
  // sin hoja de compartir (navegador de escritorio sin esa función): se guarda y se ofrecen accesos directos
  await c.ev(`navigator.canShare = undefined; navigator.share = undefined; true`);
  const before = downloads();
  await click('.ed-top .btn.primary'); await wf(() => exists('.sheet .seg'), 4000);
  await c.ev(`(()=>{ [...document.querySelectorAll('.sheet .check input')].forEach((i)=>{ if (i.checked && /buscable/.test(i.parentElement.textContent)) i.click(); }); return true })()`);
  await clickText('.sheet-foot .btn', 'Compartir');
  const help = await wf(() => c.ev(`/Enviar el archivo/.test((document.querySelector('.sheet-head h2')||{}).textContent||'')`), 60000);
  check('sin hoja de compartir: guarda el archivo y muestra «Enviar el archivo»', !!help && (await newDownloads(before, 1, 20000)).length === 1);
  await shot('06b-enviar'); await audit('hoja «Enviar el archivo» (móvil)');
  const names = await c.ev(`[...document.querySelectorAll('.send-app b')].map(b=>b.textContent)`);
  check('ofrece WhatsApp, Telegram, Discord, Gmail y correo', ['WhatsApp', 'Telegram', 'Discord', 'Gmail'].every((x) => names.includes(x)) && names.length === 5, names.join());
  await clickText('.send-app', 'WhatsApp'); await clickText('.send-app', 'Gmail');
  const opened = await c.ev(`window.__opened`);
  check('los accesos abren WhatsApp Web y Gmail con asunto', opened.some((u) => /web.whatsapp.com/.test(u)) && opened.some((u) => /mail.google.com.*su=/.test(u)), j(opened));
  await closeSheets();
  await c.ev(`delete navigator.canShare; delete navigator.share; true`);
};

G.paginas = async () => {
  // eliminar una página
  await clickText('.ed-tool', 'Eliminar');
  await wf(() => exists('.sheet'), 4000);
  await clickText('.sheet-foot .btn', 'Eliminar');
  await sleep(700);
  check('«Eliminar» quita la página (queda 1 / 1)', (await text('.ed-counter')) === '1 / 1' && (await dbPages()).length === 1);
  // añadir páginas importando imágenes
  await click('.ed-thumb.add');
  await wf(() => exists('.menu'), 4000);
  check('«+» ofrece cámara o importar', /Escanear con la cámara/.test(await text('.menu')) && /Importar imágenes/.test(await text('.menu')));
  await clickText('.menu button', 'Importar imágenes'); await sleep(300);
  await c.setFiles('.ed input[type=file]', [path.join(FX, 'factura-recta.png'), path.join(FX, 'factura-giro.png')]);
  await wf(() => c.ev(`document.querySelectorAll('.ed-thumb:not(.add)').length===3`), 40000, 400);
  check('importar 2 imágenes añade 2 páginas (3 en total)', (await count('.ed-thumb:not(.add)')) === 3 && (await dbPages()).length === 3);
  // renombrar
  await click('.ed-title'); await wf(() => exists('.sheet input'), 4000);
  await c.ev(`(()=>{const i=document.querySelector('.sheet input'); i.value='Factura marzo'; return true})()`);
  await clickText('.sheet-foot .btn', 'Guardar'); await sleep(500);
  check('cambiar el nombre actualiza el título', (await text('.ed-title')) === 'Factura marzo' && (await dbDocs())[0].title === 'Factura marzo');
  // volver a la biblioteca
  await click('.ed-top .icon-btn'); await sleep(700);
  check('al volver, la biblioteca muestra el documento con 3 páginas', (await count('.doc')) === 1 && (await text('.doc-n')) === '3' && (await text('.doc-title')) === 'Factura marzo');
  await shot('07-biblioteca'); await audit('biblioteca con documento (móvil)');
};

G.biblioteca = async () => {
  await c.setFiles('input[type=file][aria-label="Importar archivos"]', [path.join(FX, 'factura-recta.png')]);
  await wf(() => exists('.ed'), 30000);
  check('importar 1 imagen crea un documento nuevo y lo abre', !!(await exists('.ed')) && (await dbDocs()).length === 2);
  await click('.ed-top .icon-btn'); await sleep(700);
  check('la biblioteca lista 2 documentos', (await count('.doc')) === 2);
  await c.ev(`(()=>{const i=document.querySelector('#search'); i.value='marzo'; i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`); await sleep(300);
  check('la búsqueda filtra por nombre', (await count('.doc')) === 1 && (await text('.doc-title')) === 'Factura marzo');
  await c.ev(`(()=>{const i=document.querySelector('#search'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`); await sleep(200);
  // menú de documento
  await click('.doc-more'); await wf(() => exists('.menu'), 4000);
  const menuTxt = await text('.menu'); check('menú del documento completo', /Abrir/.test(menuTxt) && /Exportar o compartir/.test(menuTxt) && /Cambiar nombre/.test(menuTxt) && /Eliminar/.test(menuTxt), menuTxt);
  await closeSheets();
  // seleccionar y unir
  await click('#btnSelect'); await sleep(200);
  await c.ev(`document.querySelectorAll('.doc-open').forEach(b=>b.click()); true`); await sleep(300);
  check('seleccionar 2 documentos activa «Unir»', (await text('.selcount')) === '2 seleccionados' && !(await c.ev(`[...document.querySelectorAll('.selbar .btn')].find(b=>/Unir/.test(b.textContent)).disabled`)));
  await shot('08-seleccion'); await audit('selección múltiple (móvil)');
  await clickText('.selbar .btn', 'Unir'); await wf(() => exists('.sheet input'), 4000);
  await c.ev(`(()=>{document.querySelector('.sheet input').value='Todo junto'; return true})()`);
  await clickText('.sheet-foot .btn', 'Guardar'); await sleep(1500);
  const docs = await dbDocs();
  check('«Unir» crea un documento con las 4 páginas (3 + 1)', docs.length === 3 && docs.some((d) => d.title === 'Todo junto' && d.pageCount === 4), j(docs.map((d) => [d.title, d.pageCount])));
  // eliminar seleccionados
  await click('#btnSelect'); await sleep(150);
  await c.ev(`[...document.querySelectorAll('.doc')].filter(d=>/Todo junto/.test(d.textContent)).forEach(d=>d.querySelector('.doc-open').click()); true`); await sleep(200);
  await clickText('.selbar .btn', 'Eliminar'); await wf(() => exists('.sheet'), 4000);
  await clickText('.sheet-foot .btn', 'Eliminar'); await sleep(800);
  check('eliminar el documento unido deja 2', (await dbDocs()).length === 2);
};

G.herramientas = async () => {
  let base = path.join(DL, 'exportado.pdf');
  if (!fs.existsSync(base)) base = path.join(FX, 'base.pdf');
  const pdf1 = path.join(DL, 'base-1.pdf'), pdf2 = path.join(DL, 'base-2.pdf');
  fs.copyFileSync(base, pdf1); fs.copyFileSync(base, pdf2);
  await c.ev(`WilScan.show('tools'); true`); await sleep(300);
  const open = async (title) => { await closeSheets(); await clickText('.tool-tx b', title); await wf(() => exists('.sheet'), 4000); };
  const run = async (btnText, n = 1, ms = 90000) => { const before = downloads(); await clickText('.sheet-foot .btn', btnText); const ok = await wf(() => c.ev(`document.querySelector('.sheet-head h2') && document.querySelector('.sheet-head h2').textContent==='Resultado'`), ms, 300); if (!ok) return { ok: false, err: await text('#toast') }; await clickText('.sheet-foot .btn', 'Guardar'); const f = await newDownloads(before, n, 60000); await closeSheets(); return { ok: true, files: f }; };

  // unir
  await open('Unir PDF'); await c.setFiles('.sheet input[type=file]', [pdf1, pdf2]); await wf(() => c.ev(`document.querySelectorAll('.sheet .files li').length===2`), 4000);
  await shot('09-herramienta-unir'); await audit('herramienta «Unir PDF» (móvil)');
  let r = await run('Unir PDF');
  check('Unir PDF: crea un PDF de 4 páginas', r.ok && r.files.length === 1 && (await pdfInfo(r.files[0].p)).n === 4, r.ok ? r.files.map((x) => x.n).join() : r.err);
  const merged = r.ok && r.files[0] ? r.files[0].p : pdf1;
  // dividir por rangos
  await open('Dividir PDF'); await c.setFiles('.sheet input[type=file]', [merged]); await wf(() => c.ev(`/4 páginas/.test(document.querySelector('.sheet').textContent)`), 6000);
  check('Dividir: muestra cuántas páginas tiene el PDF', /Este PDF tiene 4 páginas/.test(await text('.sheet')));
  await c.ev(`(()=>{const i=[...document.querySelectorAll('.sheet input[type=text]')][0]; i.value='1-2; 3-4'; i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
  r = await run('Dividir', 2);
  check('Dividir por rangos: 2 archivos de 2 páginas', r.ok && r.files.length === 2 && (await pdfInfo(r.files[0].p)).n === 2, r.ok ? r.files.map((x) => x.n).join() : r.err);
  // extraer
  await open('Extraer páginas'); await c.setFiles('.sheet input[type=file]', [merged]); await sleep(500);
  await c.ev(`(()=>{const i=document.querySelector('.sheet input[type=text]'); i.value='2,4'; return true})()`);
  r = await run('Extraer');
  check('Extraer "2,4": PDF de 2 páginas', r.ok && (await pdfInfo(r.files[0].p)).n === 2, r.ok ? '' : r.err);
  // eliminar
  await open('Eliminar páginas'); await c.setFiles('.sheet input[type=file]', [merged]); await sleep(500);
  await c.ev(`(()=>{const i=document.querySelector('.sheet input[type=text]'); i.value='1'; return true})()`);
  r = await run('Eliminar páginas');
  check('Eliminar "1": quedan 3 páginas', r.ok && (await pdfInfo(r.files[0].p)).n === 3, r.ok ? '' : r.err);
  // girar
  await open('Girar páginas'); await c.setFiles('.sheet input[type=file]', [merged]); await sleep(500);
  await c.ev(`(()=>{const i=document.querySelector('.sheet input[type=text]'); i.value='1'; return true})()`);
  r = await run('Girar');
  const ri = r.ok ? await pdfInfo(r.files[0].p) : null;
  check('Girar página 1 a 90°', r.ok && ri.rots[0] === 90 && ri.rots[1] === 0, ri ? ri.rots.join() : r.err);
  // marca de agua
  await open('Marca de agua'); await c.setFiles('.sheet input[type=file]', [merged]); await sleep(400);
  await setInput('.sheet input[type=text]', 'BORRADOR');
  r = await run('Añadir marca de agua');
  check('Marca de agua: el PDF contiene «BORRADOR»', r.ok && /borrador/i.test((await pdfInfo(r.files[0].p)).t), r.ok ? '' : r.err);
  // numerar
  await open('Numerar páginas'); await c.setFiles('.sheet input[type=file]', [merged]); await sleep(400);
  r = await run('Numerar');
  check('Numerar: añade el número de página', r.ok && /\b4\b/.test((await pdfInfo(r.files[0].p)).t), r.ok ? '' : r.err);
  // comprimir
  await open('Comprimir PDF'); await c.setFiles('.sheet input[type=file]', [path.join(FX, 'base-img.pdf')]); await sleep(400);
  await setSelect('.sheet select', '0.35');
  r = await run('Comprimir', 1, 120000);
  const orig = fs.statSync(path.join(FX, 'base-img.pdf')).size;
  check('Comprimir: el PDF resultante pesa menos y conserva sus páginas', r.ok && r.files[0] && fs.statSync(r.files[0].p).size < orig && (await pdfInfo(r.files[0].p)).n === 2, r.ok ? `${orig} → ${fs.statSync(r.files[0].p).size}` : r.err);
  // PDF a imágenes
  await open('PDF a imágenes'); await c.setFiles('.sheet input[type=file]', [merged]); await sleep(400);
  await c.ev(`(()=>{const i=document.querySelector('.sheet input[type=text]'); i.value='1-2'; return true})()`);
  r = await run('Convertir', 2);
  check('PDF a imágenes: 2 JPG (páginas 1-2)', r.ok && r.files.length === 2 && r.files.every((f) => /\.jpg$/.test(f.n)), r.ok ? r.files.map((f) => f.n).join() : r.err);
  // PDF a texto (con texto real) y imagen a texto
  await open('PDF a texto'); await c.setFiles('.sheet input[type=file]', [base]); await sleep(400);
  r = await run('Extraer texto');
  check('PDF a texto: devuelve el texto del PDF buscable', r.ok && /FACTURA 2026-0042/i.test(fs.readFileSync(r.files[0].p, 'utf8')), r.ok ? '' : r.err);
  await open('Imagen a texto'); await c.setFiles('.sheet input[type=file]', [path.join(FX, 'factura-recta.png')]); await sleep(400);
  r = await run('Reconocer texto', 1, 120000);
  check('Imagen a texto: reconoce el contenido de la foto', r.ok && /1\.250,00 EUR/.test(fs.readFileSync(r.files[0].p, 'utf8')), r.ok ? '' : r.err);
  // imágenes a PDF
  await open('Imágenes a PDF'); await c.setFiles('.sheet input[type=file]', [path.join(FX, 'factura-recta.png'), path.join(FX, 'factura-giro.png'), path.join(FX, 'factura-persp.png')]); await wf(() => c.ev(`document.querySelectorAll('.sheet .files li').length===3`), 4000);
  r = await run('Crear PDF');
  check('Imágenes a PDF: PDF de 3 páginas', r.ok && (await pdfInfo(r.files[0].p)).n === 3, r.ok ? '' : r.err);
  // importar PDF
  await open('Importar PDF'); await c.setFiles('.sheet input[type=file]', [merged]); await sleep(400);
  await clickText('.sheet-foot .btn', 'Importar');
  check('Importar PDF: crea un documento editable y lo abre', !!(await wf(() => exists('.ed'), 60000)) && (await dbDocs()).some((d) => d.pageCount === 4 && /base-1|Unido/i.test(d.title) || d.pageCount === 4), j((await dbDocs()).map((d) => [d.title, d.pageCount])));
  await click('.ed-top .icon-btn'); await sleep(500);
  await c.ev(`WilScan.show('tools'); true`); await sleep(300);

  // ordenar páginas de un PDF
  await open('Ordenar páginas'); await c.setFiles('.sheet input[type=file]', [merged]); await wf(() => c.ev(`document.querySelectorAll('.sheet .ord').length===4`), 30000);
  await c.ev(`document.querySelectorAll('.sheet .ord')[3].querySelectorAll('button')[0].click(); true`);
  await clickText('.sheet-foot .btn', 'Guardar orden'); await wf(() => c.ev(`document.querySelector('.sheet-head h2').textContent==='Resultado'`), 20000);
  before = downloads(); await clickText('.sheet-foot .btn', 'Guardar'); r = await newDownloads(before, 1, 30000); await closeSheets();
  check('Ordenar páginas: guarda el PDF reordenado', r.length === 1 && (await pdfInfo(r[0].p)).n === 4, r.map((x) => x.n).join());
};
let before = [];

G.firma = async () => {
  const pdf = fs.existsSync(path.join(DL, 'exportado.pdf')) ? path.join(DL, 'exportado.pdf') : path.join(FX, 'base.pdf');
  await c.ev(`WilScan.show('tools'); true`); await sleep(300);
  await clickText('.tool-tx b', 'Firmar PDF'); await wf(() => exists('.sheet'), 4000);
  await c.setFiles('.sheet input[type=file]', [pdf]);
  await wf(() => exists('.sign-page'), 20000);
  check('Firmar: muestra la página del PDF para colocar la firma', !!(await exists('.sign-page')));
  await clickText('.sheet .btn', 'Dibujar mi firma'); await wf(() => exists('.sig-pad'), 4000);
  const pr = await rectOf('.sig-pad');
  await drag([pr.x + pr.w * 0.12, pr.y + pr.h * 0.6], [pr.x + pr.w * 0.4, pr.y + pr.h * 0.3], 12);
  await drag([pr.x + pr.w * 0.4, pr.y + pr.h * 0.3], [pr.x + pr.w * 0.8, pr.y + pr.h * 0.7], 12);
  await shot('10-firma-pad'); await audit('pad de firma (móvil)');
  await clickText('.sheet-foot .btn', 'Usar esta firma');
  check('la firma aparece sobre la página', !!(await wf(() => exists('.sign-sig'), 8000)));
  await sleep(600); await c.ev(`document.querySelector('.sign-sig').scrollIntoView({block:'center'}); true`); await sleep(300);
  const s0 = await rectOf('.sign-sig');
  await drag([s0.cx, s0.cy], [s0.cx - 60, s0.cy - 70], 10);
  const s1 = await rectOf('.sign-sig');
  check('la firma se arrastra a otro sitio', Math.hypot(s1.x - s0.x + 60, s1.y - s0.y + 70) < 6, `${Math.round(s1.x - s0.x)},${Math.round(s1.y - s0.y)}`);
  await shot('11-firma-colocada'); await audit('firmar PDF (móvil)');
  const before2 = downloads();
  await clickText('.sheet-foot .btn', 'Firmar y guardar');
  await wf(() => c.ev(`document.querySelector('.sheet-head h2') && document.querySelector('.sheet-head h2').textContent==='Resultado'`), 30000);
  await clickText('.sheet-foot .btn', 'Guardar');
  const f = await newDownloads(before2, 1, 30000);
  check('Firmar y guardar: genera «… (firmado).pdf» más pesado que el original', f.length === 1 && /firmado/.test(f[0].n) && fs.statSync(f[0].p).size > fs.statSync(pdf).size, f.map((x) => x.n).join());
  await closeSheets();
};

G.torcida = async () => {
  await c.ev(`WilScan.show('docs'); true`); await sleep(300);
  await c.setFiles('input[type=file][aria-label="Importar archivos"]', [path.join(FX, 'texto-torcido.png')]);
  check('importar una foto torcida abre el editor', !!(await wf(() => exists('.ed'), 40000)));
  await wf(() => c.ev(`(document.querySelector('.ed-img')||{}).naturalWidth>300`), 10000);
  const pg = (await dbPages()).filter((p) => p.skew !== undefined);
  const docs = await dbDocs(); const mine = docs.find((d) => d.pageCount === 1 && /texto-torcido/.test(d.title));
  const page = mine ? (await dbPages()).find((p) => p.id === mine.pageIds[0]) : null;
  check('la app detectó y corrigió la inclinación (≈6°) al importar', !!page && Math.abs(page.skew - 6) < 0.8, page ? String(page.skew) : 'sin página');
  await shot('15-foto-torcida');
  await clickText('.ed-tool', 'Texto');
  const ok = await wf(() => c.ev(`/CONTRATO DE ARRENDAMIENTO/i.test((document.querySelector('.sheet textarea')||{}).value||'')`), 60000, 500);
  check('el texto de la foto enderezada se reconoce bien', !!ok, (await c.ev(`(document.querySelector('.sheet textarea')||{}).value||''`)).split(String.fromCharCode(10))[0]);
  await closeSheets(); await click('.ed-top .icon-btn'); await sleep(400);
};

G.ajustes = async () => {
  await c.ev(`WilScan.show('settings'); true`); await sleep(300);
  await shot('12-ajustes'); await audit('ajustes (móvil)');
  await setSelect('#v-settings select[aria-label="Tamaño de página"]', 'letter');
  await c.ev(`(()=>{const k=[...document.querySelectorAll('#v-settings .check')].find(x=>/Disparo automático/.test(x.textContent)).querySelector('input'); k.click(); return true})()`); await sleep(300);
  await c.send('Page.reload'); await wf(() => c.ev(`document.documentElement.dataset.ready==='1'`), 15000); await sleep(400);
  await c.ev(`WilScan.show('settings'); true`); await sleep(300);
  const st = await c.ev(`new Promise((res)=>{const r=indexedDB.open('wilscan'); r.onsuccess=()=>{const g=r.result.transaction('kv').objectStore('kv').get('settings'); g.onsuccess=()=>res(g.result)}})`);
  check('los ajustes se guardan y sobreviven al recargar', st && st.pdfSize === 'letter' && st.autoCapture === true, j(st));
  check('muestra el almacenamiento usado', /usados de/.test(await text('#v-settings .card.pad .hint')) || /usados de/.test(await text('#v-settings')));
  const sw = await c.ev(`navigator.serviceWorker ? navigator.serviceWorker.getRegistration().then(r=>!!r) : false`);
  check('el modo sin conexión (service worker) está registrado', !!sw);
};

G.diseno = async () => {
  await c.ev(`WilScan.show('docs'); true`); await sleep(400);
  for (const [w, h] of [[360, 640], [390, 844], [768, 1024], [1100, 800], [1440, 900]]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    for (const v of ['docs', 'tools', 'settings']) { await c.ev(`WilScan.show(${j(v)}); true`); await sleep(350); await audit(`${v} a ${w}×${h}`); }
    if (w === 390 || w === 1100) { await c.ev(`WilScan.show('docs'); true`); await sleep(300); await shot(`13-docs-${w}`); }
  }
  // el editor en escritorio
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  const docs = await dbDocs();
  if (docs[0]) { await c.ev(`WilScan.openDoc(${j(docs[0].id)}); true`); await wf(() => exists('.ed'), 8000); await sleep(800); await shot('14-editor-escritorio'); await audit('editor a 1100×800'); await click('.ed-top .icon-btn'); await sleep(400); }
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
};

(async () => {
  c = await launch({ url: BASE + '/', mobile: true, fakeVideo: path.join(FX, 'camara.y4m'), downloadDir: DL });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 15000);
  await sleep(500);
  for (const name of ['arranque', 'escaneo', 'editor', 'exportar', 'compartir', 'paginas', 'biblioteca', 'herramientas', 'firma', 'torcida', 'ajustes', 'diseno']) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    group = name; console.log(`\n▶ ${name}`);
    const nlogs = c.logs.length;
    try { await G[name](); } catch (e) { check('excepción en el grupo', false, e.message); }
    const newErr = c.logs.slice(nlogs).filter((l) => !/favicon|Failed to load resource.*404|Estimating resolution|^NAV /.test(l));
    check('sin errores de consola en el grupo', newErr.length === 0, newErr.join(' | ').slice(0, 400));
  }
  await c.close();
  try { fs.rmSync(DL, { recursive: true, force: true }); } catch { /* en uso */ }
  console.log(fails ? `\n${fails} FALLOS · capturas en ${OUT}\n  ` + failed.join('\n  ') : `\nTODO OK · capturas en ${OUT}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
