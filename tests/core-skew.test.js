// Prueba de enderezado automático y ampliación: fotos torcidas sin bordes visibles y fotos pequeñas.
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
    await c.ev(`window.M = {}; Promise.all([import('${BASE}/js/core/deskew.js'), import('${BASE}/js/core/pages.js'), import('${BASE}/js/core/ocr.js'), import('${BASE}/js/core/detect.js')]).then(([d,p,o,t]) => { Object.assign(M,{d,p,o,t}); M.load = (u) => new Promise((res)=>{const i=new Image(); i.onload=()=>{const k=document.createElement('canvas'); k.width=i.width; k.height=i.height; k.getContext('2d').drawImage(i,0,0); res(k)}; i.src=u;}); return true })`);
    const r = await c.ev(`(async()=>{
      const out = {};
      const torcida = await M.load(${JSON.stringify(fx('texto-torcido.png'))});
      const recta = await M.load(${JSON.stringify(fx('factura-recta.png'))});
      out.skewTorcida = M.d.estimateSkew(torcida);
      out.skewRecta = M.d.estimateSkew(recta);
      out.quadTorcida = await M.t.detectQuad(torcida);
      // página nueva sin bordes detectados: se endereza sola
      const page = await M.p.newPage('doc', torcida, { quad: null, filter: 'auto' });
      out.pageSkew = page.skew;
      const img = await M.p.blobToCanvas(page.out);
      out.skewAfter = M.d.estimateSkew(img);
      const ocr = await M.o.recognize(img, {lang:'spa'});
      out.text = ocr.text;
      // foto pequeña: se amplía
      const small = document.createElement('canvas'); small.width = 520; small.height = 390; const sx = small.getContext('2d'); sx.imageSmoothingQuality='high'; sx.drawImage(recta, 0, 0, 520, 390);
      const pg2 = await M.p.newPage('doc', small, { quad: null, filter: 'auto' });
      out.smallW = pg2.w; out.smallH = pg2.h;
      const o2 = await M.o.recognize(await M.p.blobToCanvas(pg2.out), {lang:'spa'});
      out.smallText = o2.text;
      // la misma foto torcida SIN enderezar, para comparar el OCR
      const raw = await M.o.recognize(torcida, {lang:'spa'});
      out.rawLen = raw.text.length; out.fixedLen = ocr.text.length;
      return out; })()`);
    console.log('  skew torcida', r.skewTorcida, '· recta', r.skewRecta, '· tras enderezar', r.skewAfter, '· quad', r.quadTorcida ? 'detectado' : 'ninguno');
    check('detecta ≈6° de inclinación en la foto torcida', Math.abs(r.skewTorcida - 6) < 0.8, String(r.skewTorcida));
    check('una foto recta no se toca (0°)', r.skewRecta === 0, String(r.skewRecta));
    check('la página nueva guarda la inclinación corregida', Math.abs(r.pageSkew - 6) < 0.8, String(r.pageSkew));
    check('tras enderezar, el texto queda horizontal (<0,6°)', Math.abs(r.skewAfter) < 0.6, String(r.skewAfter));
    const t = norm(r.text);
    check('el OCR lee el título de la foto enderezada', /contrato de arrendamiento 118/.test(t), r.text.split('\n')[0]);
    check('el OCR lee el importe y la ciudad', /1\.250\.000 pesos/.test(t) && /bogota/.test(t));
    check('foto pequeña (520 px): se amplía (×2,5 como máximo)', Math.max(r.smallW, r.smallH) >= 1250, `${r.smallW}×${r.smallH}`);
    check('y su texto se lee bien tras ampliar', /factura 2026-0042/.test(norm(r.smallText)), r.smallText.split('\n')[0]);
  } catch (e) { check('excepción', false, e.message); }
  if (c.logs.length) console.log('consola:', c.logs.filter((l) => !/favicon|Estimating/.test(l)).slice(0, 4).join(' | '));
  await c.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
