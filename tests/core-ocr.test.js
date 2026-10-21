// Prueba del OCR: reconoce una factura de prueba (ya recortada y filtrada) y comprueba frases clave.
const fs = require('fs'), path = require('path');
const { launch } = require('./lib/chrome');
const BASE = process.env.BASE || 'http://localhost:5180';
const fx = (n) => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', n)).toString('base64');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

(async () => {
  const c = await launch({ url: BASE + '/_lab/blank.html' });
  try {
    await c.ev(`window.M = {}; Promise.all([import('${BASE}/js/core/detect.js'), import('${BASE}/js/core/warp.js'), import('${BASE}/js/core/filters.js'), import('${BASE}/js/core/ocr.js'), import('${BASE}/js/core/pages.js')]).then(([d,w,f,o,p]) => { M.d=d; M.w=w; M.f=f; M.o=o; M.p=p; M.load = (u) => new Promise((res)=>{const i=new Image(); i.onload=()=>{const k=document.createElement('canvas'); k.width=i.width; k.height=i.height; k.getContext('2d').drawImage(i,0,0); res(k)}; i.src=u;}); return true })`);
    for (const [filter, name] of [['auto', 'perspectiva + Mejorado'], ['bn', 'perspectiva + Blanco y negro']]) {
      const t0 = Date.now();
      const r = await c.ev(`(async()=>{ const img = await M.load(${JSON.stringify(fx('factura-persp.png'))}); const q = await M.d.detectQuad(img); const w = await M.w.warpQuad(img, q); const f = await M.f.applyFilter(${JSON.stringify(filter)}==='bn' ? M.p.enlarge(w) : w, {filter:${JSON.stringify(filter)}}); const prog=[]; const t=performance.now(); const o = await M.o.recognize(f, {lang:'spa+eng', onProgress:(p)=>prog.push(Math.round(p*100))}); return {text:o.text, conf:Math.round(o.confidence), words:o.words.length, sample:o.words.slice(0,3), ms:Math.round(performance.now()-t), prog: prog.length}; })()`);
      const t = norm(r.text);
      console.log(`  ${name}: ${r.ms} ms · confianza ${r.conf} · ${r.words} palabras · avisos de progreso ${r.prog}`);
      if (filter === 'auto' || process.env.SHOW_ALL) console.log('  --- texto ---\n' + r.text.split('\n').map((l) => '  | ' + l).join('\n'));
      check(`(${name}) lee el número de factura`, /factura 2026-0042/.test(t), r.text.split('\n')[0]);
      check(`(${name}) lee el nombre con tilde`, /wilmar gomez/.test(t));
      check(`(${name}) lee el importe total`, /1\.250,00 eur/.test(t));
      check(`(${name}) lee una palabra de la tabla`, /licencia wilscan/.test(t) && /soporte tecnico/.test(t));
      check(`(${name}) da cajas de palabras para el PDF buscable`, r.words > 25 && r.sample[0] && r.sample[0].x1 > r.sample[0].x0);
      check(`(${name}) informa del progreso`, r.prog > 0);
    }
    const t1 = Date.now();
    const r2 = await c.ev(`(async()=>{ const img = await M.load(${JSON.stringify(fx('factura-recta.png'))}); const o = await M.o.recognize(img, {lang:'eng'}); return o.text.length })()`);
    check('cambia de idioma sin romperse (inglés)', r2 > 30, r2 + ' caracteres en ' + (Date.now() - t1) + ' ms');
  } catch (e) { check('excepción', false, e.message); }
  if (c.logs.length) console.log('consola:', c.logs.slice(0, 5).join(' | '));
  await c.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
