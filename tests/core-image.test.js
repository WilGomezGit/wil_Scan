// Prueba de la imagen: detección de bordes, perspectiva y filtros con fotos de prueba, en un Chrome real.
//   node tests/core-image.test.js   (necesita node tools/serve.js en el puerto 5180 y node tests/make-fixtures.js hecho)
const fs = require('fs'), path = require('path');
const { launch } = require('./lib/chrome');
const BASE = process.env.BASE || 'http://localhost:5180';
const fx = (n) => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', n)).toString('base64');
const outDir = process.env.OUT_DIR || path.join(__dirname, 'out'); fs.mkdirSync(outDir, { recursive: true });
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const save = (name, dataUrl) => fs.writeFileSync(path.join(outDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

// esquinas reales del papel en cada foto (px en 1280×960), medidas del propio HTML de prueba
const TRUTH = { 'factura-persp.png': [[358, 141], [938, 74], [979, 897], [349, 887]] };

(async () => {
  const c = await launch({ url: BASE + '/_lab/blank.html' });
  try {
    await c.ev(`window.M = {}; Promise.all([import('${BASE}/js/core/detect.js'), import('${BASE}/js/core/warp.js'), import('${BASE}/js/core/filters.js'), import('${BASE}/js/core/cv.js')]).then(([d,w,f,v]) => { M.d=d; M.w=w; M.f=f; M.v=v; M.load = (u) => new Promise((res)=>{const i=new Image(); i.onload=()=>{const k=document.createElement('canvas'); k.width=i.width; k.height=i.height; k.getContext('2d').drawImage(i,0,0); res(k)}; i.src=u;}); return true })`);
    const t0 = Date.now();
    await c.ev(`M.v.loadCV().then(()=>true)`);
    console.log('  OpenCV cargado en', Date.now() - t0, 'ms');

    for (const name of ['factura-persp.png', 'factura-recta.png', 'factura-giro.png']) {
      const r = await c.ev(`(async()=>{ const cv=await M.load(${JSON.stringify(fx(name))}); const t=performance.now(); const q=await M.d.detectQuad(cv); return {q, ms: Math.round(performance.now()-t), w:cv.width, h:cv.height}; })()`);
      check(`detecta el papel en ${name}`, !!r.q, r.q ? `${r.ms} ms` : 'sin resultado');
      if (r.q && TRUTH[name]) {
        const err = r.q.map(([x, y], i) => Math.hypot(x * r.w - TRUTH[name][i][0], y * r.h - TRUTH[name][i][1]));
        check(`esquinas de ${name} a menos de 14 px de las reales`, Math.max(...err) < 14, 'error máx ' + Math.max(...err).toFixed(1) + ' px');
      }
    }

    const res = await c.ev(`(async()=>{
      const cv = await M.load(${JSON.stringify(fx('factura-persp.png'))});
      const q = await M.d.detectQuad(cv);
      const t = performance.now();
      const w = await M.w.warpQuad(cv, q);
      const tw = Math.round(performance.now()-t);
      const o = {warp:{w:w.width,h:w.height,ms:tw, url:w.toDataURL('image/jpeg',0.9)}, f:{}};
      const lum = (c, x0,y0,x1,y1)=>{const d=c.getContext('2d').getImageData(Math.round(x0*c.width),Math.round(y0*c.height),Math.round((x1-x0)*c.width),Math.round((y1-y0)*c.height)).data; let s=0,n=0; for(let i=0;i<d.length;i+=4){s+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];n++} return s/n};
      o.lumOriginalLeft = lum(w,0.02,0.7,0.12,0.9); o.lumOriginalRight = lum(w,0.85,0.7,0.98,0.9);
      for (const id of ['original','auto','sombras','color','gris','bn']) {
        const t2 = performance.now(); const f = await M.f.applyFilter(w, {filter:id}); const ms = Math.round(performance.now()-t2);
        let bin=0, n=0; const d=f.getContext('2d').getImageData(0,0,f.width,f.height).data; for(let i=0;i<d.length;i+=4*50){n++; if(d[i]<30||d[i]>225) bin++}
        o.f[id] = {ms, left: lum(f,0.02,0.7,0.12,0.9), right: lum(f,0.85,0.7,0.98,0.9), binary: bin/n, url: f.toDataURL('image/jpeg',0.85)};
      }
      const adj = await M.f.applyFilter(w, {filter:'auto', bright:20, contrast:20}); o.adjLeft = lum(adj,0.02,0.7,0.12,0.9);
      return o; })()`);
    save('warp.jpg', res.warp.url);
    check('la perspectiva queda rectangular con proporción de folio', res.warp.w > 400 && Math.abs(res.warp.w / res.warp.h - 0.78) < 0.12, `${res.warp.w}×${res.warp.h} · ${res.warp.ms} ms`);
    check('el papel recortado tiene sombra a la izquierda antes de filtrar', res.lumOriginalLeft < res.lumOriginalRight - 15, `izq ${res.lumOriginalLeft.toFixed(0)} · der ${res.lumOriginalRight.toFixed(0)}`);
    for (const [id, f] of Object.entries(res.f)) { save(`filtro-${id}.jpg`, f.url); console.log(`  ${id}: ${f.ms} ms · izq ${f.left.toFixed(0)} der ${f.right.toFixed(0)} binario ${(f.binary * 100).toFixed(0)}%`); }
    check('«Sin sombras» iguala el fondo (izq ≈ der)', Math.abs(res.f.sombras.left - res.f.sombras.right) < 12 && res.f.sombras.left > 225, `${res.f.sombras.left.toFixed(0)} / ${res.f.sombras.right.toFixed(0)}`);
    check('«Mejorado» también aclara el fondo', res.f.auto.left > 220, res.f.auto.left.toFixed(0));
    check('«Blanco y negro» es casi puro blanco/negro', res.f.bn.binary > 0.97, (res.f.bn.binary * 100).toFixed(0) + '%');
    check('«Original» conserva la sombra', res.f.original.left < res.f.original.right - 15);
    check('brillo/contraste modifican la imagen', Math.abs(res.adjLeft - res.f.auto.left) > 1 || res.f.auto.left >= 254, `${res.adjLeft.toFixed(0)} vs ${res.f.auto.left.toFixed(0)}`);
    check('cada filtro tarda menos de 2,5 s a este tamaño', Object.values(res.f).every((f) => f.ms < 2500), Object.entries(res.f).map(([k, f]) => k + ' ' + f.ms).join(' · '));
  } catch (e) { check('excepción', false, e.message); }
  if (c.logs.length) console.log('consola:', c.logs.slice(0, 5).join(' | '));
  await c.close();
  console.log(fails ? `\n${fails} FALLOS · imágenes en ${outDir}` : `\nTODO OK · imágenes en ${outDir}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
