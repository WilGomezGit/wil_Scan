// Funciones nuevas: filtros Nítido / Nota a lápiz / Pizarra, papel automático del PDF, zonas ocultas y lector de QR.
//   (necesita node tools/serve.js en 5180)
const fs = require('fs'), path = require('path');
const QR = require('qrcode');
const { launch } = require('./lib/chrome');
const BASE = process.env.BASE || 'http://localhost:5180';
const fx = (n) => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', n)).toString('base64');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const j = JSON.stringify;

(async () => {
  const c = await launch({ url: BASE + '/_lab/blank.html' });
  try {
    const qrUrl = await QR.toDataURL('https://wilscan.app/hola?x=1&y=ñ', { width: 420, margin: 2 });
    const qrBig = await QR.toDataURL('WIFI:T:WPA;S:CasaWG;P:clave-123;;', { width: 900, margin: 4 });
    await c.ev(`window.M = {}; Promise.all([import('${BASE}/js/core/detect.js'), import('${BASE}/js/core/warp.js'), import('${BASE}/js/core/filters.js'), import('${BASE}/js/core/pages.js'), import('${BASE}/js/core/pdf-export.js'), import('${BASE}/js/core/qr.js')]).then(([d,w,f,p,x,q]) => { Object.assign(M, {d,w,f,p,x,q});
      M.load = (u) => new Promise((res)=>{const i=new Image(); i.onload=()=>{const k=document.createElement('canvas'); k.width=i.width; k.height=i.height; k.getContext('2d').drawImage(i,0,0); res(k)}; i.src=u;});
      M.stats = (cv) => { const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; let sum=0, dark=0, n=0; for(let i=0;i<d.length;i+=16){ const g=(d[i]+d[i+1]+d[i+2])/3; sum+=g; if(g<110) dark++; n++; } return { mean: Math.round(sum/n), dark: +(dark/n*100).toFixed(2) }; };
      return true })`);

    // ---- filtros ----
    const base = await c.ev(`(async()=>{ const img = await M.load(${j(fx('factura-persp.png'))}); const q = await M.d.detectQuad(img); const w = await M.w.warpQuad(img, q, {maxSide: 1200}); window.W = w; return { w: w.width, h: w.height, a: M.stats(await M.f.applyFilter(w, {filter:'auto'})) } })()`);
    for (const f of ['nitido', 'nota']) {
      const r = await c.ev(`(async()=>{ const o = await M.f.applyFilter(W, {filter:${j(f)}}); return { w:o.width, h:o.height, s:M.stats(o) } })()`);
      check(`filtro «${f}»: conserva el tamaño`, r.w === base.w && r.h === base.h, `${r.w}×${r.h}`);
      check(`filtro «${f}»: fondo blanco y texto oscuro`, r.s.mean > 200 && r.s.dark > 0.8, JSON.stringify(r.s));
    }
    // «Pizarra»: tiza clara sobre fondo oscuro → debe quedar texto oscuro sobre fondo claro
    const pz = await c.ev(`(async()=>{ const inv = document.createElement('canvas'); inv.width=W.width; inv.height=W.height; const x = inv.getContext('2d'); x.drawImage(W,0,0); x.globalCompositeOperation='difference'; x.fillStyle='#fff'; x.fillRect(0,0,inv.width,inv.height); x.globalCompositeOperation='source-over';
      const before = M.stats(inv); const o = await M.f.applyFilter(inv, {filter:'pizarra'}); return { before, after: M.stats(o) } })()`);
    check('filtro «pizarra»: la imagen oscura pasa a texto oscuro sobre fondo claro', pz.before.mean < 90 && pz.after.mean > 190 && pz.after.dark > 0.8, JSON.stringify(pz));
    const sharp = await c.ev(`(async()=>{ const lap = (cv) => { const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data, w=cv.width; let s=0,n=0; for(let y=1;y<cv.height-1;y+=2) for(let x=1;x<w-1;x+=2){ const i=(y*w+x)*4; const v = 4*d[i]-d[i-4]-d[i+4]-d[i-w*4]-d[i+w*4]; s+=v*v; n++; } return Math.round(Math.sqrt(s/n)); };
      return { auto: lap(await M.f.applyFilter(W, {filter:'auto'})), nitido: lap(await M.f.applyFilter(W, {filter:'nitido'})) } })()`);
    check('filtro «nítido»: los bordes son más marcados que en «mejorado»', sharp.nitido > sharp.auto * 1.1, JSON.stringify(sharp));

    // ---- papel automático ----
    const paper = await c.ev(`[[1000,1414],[1414,1000],[1000,1294],[1000,2000],[600,380]].map(([w,h]) => M.x.pickPaper(w,h))`);
    check('papel automático: A4, A4 apaisado, Carta, largo → ajustado, tarjeta → ajustado', j(paper) === j(['a4', 'a4', 'letter', 'fit', 'fit']), j(paper));
    const sizes = await c.ev(`(async()=>{ const mk = async (w,h) => { const k=document.createElement('canvas'); k.width=w; k.height=h; const x=k.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,w,h); const b = await new Promise(r=>k.toBlob(r,'image/jpeg',0.8)); return { blob:b, w, h }; };
      const bytes = await M.x.buildPdf([await mk(1000,1414), await mk(1000,1294), await mk(1000,2000)], { size:'auto', margin: 0 });
      const lib = await M.x.loadPdfLib(); const doc = await lib.PDFDocument.load(bytes); return doc.getPages().map(p => p.getSize()).map(s => [Math.round(s.width), Math.round(s.height)]) })()`);
    check('el PDF automático usa A4, Carta y ajustado según cada página', sizes[0][0] === 595 && sizes[0][1] === 842 && sizes[1][0] === 612 && sizes[1][1] === 792 && sizes[2][1] === 842 && sizes[2][0] < 430, j(sizes));

    // ---- zonas ocultas ----
    const m = await c.ev(`(()=>{ const k=document.createElement('canvas'); k.width=400; k.height=300; const x=k.getContext('2d'); for(let i=0;i<400;i+=4) for(let jj=0;jj<300;jj+=4){ x.fillStyle='rgb('+((i*7)%256)+','+((jj*5)%256)+','+(((i+jj)*3)%256)+')'; x.fillRect(i,jj,4,4); }
      const before = k.getContext('2d').getImageData(0,0,400,300).data.slice();
      M.p.applyMarks(k, [{x:0.1,y:0.1,w:0.3,h:0.2,t:'blk'},{x:0.5,y:0.1,w:0.3,h:0.2,t:'wht'},{x:0.1,y:0.5,w:0.4,h:0.3,t:'pix'}]);
      const d = k.getContext('2d').getImageData(0,0,400,300).data, at=(a,i,xx,yy)=>[a[(yy*400+xx)*4],a[(yy*400+xx)*4+1],a[(yy*400+xx)*4+2]];
      const uniq = (x0,y0,w,h) => { const s=new Set(); for(let yy=y0;yy<y0+h;yy++) for(let xx=x0;xx<x0+w;xx++) s.add(at(d,0,xx,yy).join(',')); return s.size; };
      const before2 = (x0,y0,w,h) => { const s=new Set(); for(let yy=y0;yy<y0+h;yy++) for(let xx=x0;xx<x0+w;xx++) s.add(at(before,0,xx,yy).join(',')); return s.size; };
      return { blk: at(d,0,100,60), wht: at(d,0,260,60), outside: at(d,0,380,290).join()===at(before,0,380,290).join(), pixColours: uniq(40,150,160,90), origColours: before2(40,150,160,90) } })()`);
    check('tapar en negro y borrar en blanco pintan la zona', j(m.blk) === '[0,0,0]' && j(m.wht) === '[255,255,255]', j([m.blk, m.wht]));
    check('pixelar deja bloques (muchos menos colores) y no toca el resto', m.pixColours < m.origColours / 6 && m.outside, `${m.pixColours} de ${m.origColours} colores`);

    // ---- lector de QR ----
    const q1 = await c.ev(`(async()=>{ const c=await M.load(${j(qrUrl)}); return M.q.readQr(c) })()`);
    check('lee un QR con enlace y caracteres especiales', q1 === 'https://wilscan.app/hola?x=1&y=ñ', String(q1));
    const q2 = await c.ev(`(async()=>{ const c=await M.load(${j(qrBig)}); const big=document.createElement('canvas'); big.width=2400; big.height=1800; const x=big.getContext('2d'); x.fillStyle='#ddd'; x.fillRect(0,0,2400,1800); x.translate(1400,900); x.rotate(0.08); x.drawImage(c,-450,-450); return M.q.readQr(big) })()`);
    check('lee un QR de WiFi dentro de una foto grande y algo girada', q2 === 'WIFI:T:WPA;S:CasaWG;P:clave-123;;', String(q2));
    const q3 = await c.ev(`(async()=>{ const c=document.createElement('canvas'); c.width=500; c.height=500; const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,500,500); return M.q.readQr(c) })()`);
    check('una imagen sin código devuelve null', q3 === null, String(q3));
    check('sin errores de consola', c.logs.filter((l) => !/favicon/.test(l)).length === 0, c.logs.join(' | ').slice(0, 300));
  } catch (e) { check('excepción', false, e.message); }
  await c.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})();
