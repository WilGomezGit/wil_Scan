// Prueba del motor de PDF: crear PDF buscable desde páginas escaneadas y todas las herramientas, verificadas leyendo los PDF resultantes.
const fs = require('fs'), path = require('path');
const { launch } = require('./lib/chrome');
const BASE = process.env.BASE || 'http://localhost:5180';
const fx = (n) => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', n)).toString('base64');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

(async () => {
  const c = await launch({ url: BASE + '/_lab/blank.html' });
  try {
    await c.ev(`window.M = {}; Promise.all([import('${BASE}/js/core/detect.js'), import('${BASE}/js/core/warp.js'), import('${BASE}/js/core/filters.js'), import('${BASE}/js/core/ocr.js'), import('${BASE}/js/core/pdf-export.js'), import('${BASE}/js/core/pdf-tools.js'), import('${BASE}/js/core/pages.js')]).then(([d,w,f,o,e,t,p]) => { Object.assign(M,{d,w,f,o,e,t,p}); M.load = (u) => new Promise((res)=>{const i=new Image(); i.onload=()=>{const k=document.createElement('canvas'); k.width=i.width; k.height=i.height; k.getContext('2d').drawImage(i,0,0); res(k)}; i.src=u;}); M.txt = async (bytes)=> M.t.pdfToText(bytes); M.n = async (bytes)=> (await M.t.pageCount(bytes)); return true })`);

    // 1) PDF buscable de 2 páginas (con OCR en la primera)
    const r1 = await c.ev(`(async()=>{
      const img = await M.load(${JSON.stringify(fx('factura-persp.png'))}); const q = await M.d.detectQuad(img);
      const w = await M.w.warpQuad(img, q); const f = await M.f.applyFilter(w, {filter:'auto'});
      const o = await M.o.recognize(f);
      const b1 = await M.p.toBlob(f); const img2 = await M.load(${JSON.stringify(fx('factura-recta.png'))}); const b2 = await M.p.toBlob(img2);
      const pages = [{blob:b1, w:f.width, h:f.height, words:o.words},{blob:b2, w:img2.width, h:img2.height}];
      const out = {};
      for (const size of ['a4','letter','fit']) { const bytes = await M.e.buildPdf(pages,{size, margin:18, title:'Factura'}); out[size] = {len: bytes.length, n: await M.n(bytes)}; }
      const bytes = await M.e.buildPdf(pages,{size:'a4', margin:18, title:'Factura'});
      window.PDF = bytes;
      out.text = await M.txt(bytes);
      const doc = await M.t.openForRender(bytes); const pg = await doc.getPage(1); const vp = pg.getViewport({scale:1}); out.a4dims = [Math.round(vp.width), Math.round(vp.height)];
      out.sample = Array.from(bytes.slice(0,5));
      return out; })()`);
    check('crea PDF de 2 páginas en A4, carta y ajustado', ['a4', 'letter', 'fit'].every((s) => r1[s].n === 2), `${r1.a4.len} bytes`);
    check('el PDF empieza con %PDF', String.fromCharCode(...r1.sample) === '%PDF-');
    check('la primera página mide A4 (595×842 pt)', r1.a4dims[0] === 595 && r1.a4dims[1] === 842, r1.a4dims.join('×'));
    check('el PDF es BUSCABLE: el texto del OCR se puede extraer', /factura 2026-0042/.test(norm(r1.text)) && /total a pagar/.test(norm(r1.text)), r1.text.split('\n')[0]);

    // 2) herramientas
    const r2 = await c.ev(`(async()=>{
      const T = M.t, base = window.PDF, out = {};
      const three = await T.mergePdfs([base, base]); out.merge = await M.n(three);                       // 4 páginas
      out.extract = await M.n(await T.extractPages(three, '1,3-4'));                                   // 3
      out.delete = await M.n(await T.deletePages(three, '2-3'));                                       // 2
      const sp = await T.splitPdf(three, {mode:'ranges', rangeText:'1-2; 3-4'}); out.split = [sp.length, await M.n(sp[0].bytes), sp[0].name];
      const se = await T.splitPdf(three, {mode:'each'}); out.splitEach = se.length;
      const rot = await T.rotatePdf(base, 90, '1'); const rdoc = await T.openForRender(rot); out.rot = [(await rdoc.getPage(1)).rotate, (await rdoc.getPage(2)).rotate];
      const ord = await T.reorderPdf(base, [1,0]); const odoc = await T.openForRender(ord); const opg = await odoc.getPage(1); out.reorderFirstHasNoText = (await opg.getTextContent()).items.length === 0;
      const wm = await T.watermarkPdf(base, {text:'CONFIDENCIAL', opacity:0.3, angle:45}); out.wmText = /confidencial/.test((await T.pdfToText(wm)).toLowerCase());
      const num = await T.numberPdf(base, {position:'bottom-center', start:1, prefix:'Pág. '}); out.numText = (await T.pdfToText(num)).includes('Pág. 2');
      // firma: PNG transparente de prueba
      const sc = document.createElement('canvas'); sc.width=300; sc.height=100; const sx=sc.getContext('2d'); sx.strokeStyle='#0a246a'; sx.lineWidth=6; sx.beginPath(); sx.moveTo(10,70); sx.bezierCurveTo(60,0,110,120,160,40); sx.stroke();
      const signed = await T.signPdf(base, {pageIndex:0, png: sc.toDataURL('image/png'), x:0.5, y:0.8, w:0.3}); out.signedBigger = signed.length > base.length;
      const imgs = await T.pdfToImages(base, {scale:1.5, rangeText:'1'}); out.imgs = [imgs.length, imgs[0].w, imgs[0].h, imgs[0].blob.size];
      const comp = await T.compressPdf(base, {quality:0.35, scale:0.9}); out.compress = [base.length, comp.length, await M.n(comp)];
      try { await T.extractPages(base, '9'); out.badRange = 'sin error'; } catch (e) { out.badRange = e.message; }
      try { await T.deletePages(base, '1-2'); out.delAll = 'sin error'; } catch (e) { out.delAll = e.message; }
      try { await T.loadDoc(new Uint8Array([1,2,3,4])); out.garbage = 'sin error'; } catch (e) { out.garbage = e.message; }
      out.ranges = [T.parseRanges('1-3, 5, 8-', 9).join(','), T.parseRanges('', 3).join(',')];
      return out; })()`);
    check('unir 2 PDF suma las páginas', r2.merge === 4);
    check('extraer "1,3-4" deja 3 páginas', r2.extract === 3);
    check('borrar "2-3" deja 2 páginas', r2.delete === 2);
    check('dividir por rangos "1-2; 3-4" da 2 archivos de 2 páginas', r2.split[0] === 2 && r2.split[1] === 2, r2.split[2]);
    check('dividir una por página da 4 archivos', r2.splitEach === 4);
    check('girar 90° solo la página 1', r2.rot[0] === 90 && r2.rot[1] === 0, r2.rot.join(','));
    check('reordenar [2,1] pone primero la página sin texto', r2.reorderFirstHasNoText);
    check('marca de agua visible en el texto del PDF', r2.wmText);
    check('numerar páginas añade "Pág. 2"', r2.numText);
    check('firmar incrusta la imagen (el PDF crece)', r2.signedBigger);
    check('PDF a imágenes: 1 JPG con tamaño correcto', r2.imgs[0] === 1 && r2.imgs[1] > 700 && r2.imgs[3] > 5000, r2.imgs.join(' · '));
    check('comprimir conserva las páginas y reduce el peso', r2.compress[2] === 2 && r2.compress[1] < r2.compress[0], `${r2.compress[0]} → ${r2.compress[1]} bytes`);
    check('rango fuera de límite da un error claro', /no existe/.test(r2.badRange), r2.badRange);
    check('no deja borrar todas las páginas', /todas las páginas/.test(r2.delAll), r2.delAll);
    check('un archivo que no es PDF da un error claro', /No se pudo leer el PDF/.test(r2.garbage), r2.garbage);
    check('parseRanges entiende "1-3, 5, 8-" y vacío', r2.ranges[0] === '0,1,2,4,7,8' && r2.ranges[1] === '0,1,2', r2.ranges.join(' | '));
  } catch (e) { check('excepción', false, e.message); }
  if (c.logs.length) console.log('consola:', c.logs.filter((l) => !/favicon/.test(l)).slice(0, 5).join(' | '));
  await c.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
