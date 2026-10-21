// Funciones nuevas dentro de Android (BlueStacks): filtros Nota/Pizarra/Nítido, ocultar zonas, lector de QR.
//   node tests/android-features.js
const path = require('path'), fs = require('fs'), os = require('os');
const QR = require('qrcode');
const { connect, sleep } = require('./lib/android');
const { source: auditSource } = require('./layout-audit');
const FX = path.join(__dirname, 'fixtures'), j = JSON.stringify;
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'wilscan-android'); fs.mkdirSync(OUT, { recursive: true });
let c, fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };
const clickText = (sel, txt) => c.ev(`(()=>{const e=[...document.querySelectorAll(${j(sel)})].find(x=>x.textContent.trim().toLowerCase().includes(${j(txt.toLowerCase())})); if(!e) return false; e.click(); return true})()`);
const exists = (sel) => c.ev(`!!document.querySelector(${j(sel)})`);
const idle = () => c.until(() => c.ev(`!document.querySelector('.ed-stage.working') && !document.querySelector('.busy')`), 60000, 150);
// arrastre con eventos de puntero sobre el svg (como un dedo)
const swipe = (sel, a, b) => c.ev(`(()=>{const e=document.querySelector(${j(sel)}); const r=e.getBoundingClientRect(); const mk=(t,x,y)=>new PointerEvent(t,{pointerId:7,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,clientX:r.left+x*r.width,clientY:r.top+y*r.height}); e.dispatchEvent(mk('pointerdown',${a[0]},${a[1]})); for(let i=1;i<=8;i++) e.dispatchEvent(mk('pointermove',${a[0]}+(${b[0]}-${a[0]})*i/8,${a[1]}+(${b[1]}-${a[1]})*i/8)); e.dispatchEvent(mk('pointerup',${b[0]},${b[1]})); return true})()`);

(async () => {
  c = await connect({ restart: true });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  await c.ev(`new Promise((r)=>{const q=indexedDB.deleteDatabase('wilscan'); q.onsuccess=q.onerror=q.onblocked=()=>r(true)})`);
  await c.send('Page.reload'); await sleep(1500);
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);

  const b64 = fs.readFileSync(path.join(FX, 'factura-recta.png')).toString('base64');
  await c.ev(`(()=>{const b=Uint8Array.from(atob(${j(b64)}),ch=>ch.charCodeAt(0)); WilScan.importFiles([new File([b],'factura.png',{type:'image/png'})]); return true})()`);
  await c.until(() => c.ev(`(document.querySelector('.ed-img')||{}).naturalWidth>300`), 60000);
  await idle(); await sleep(1500);

  // filtros nuevos
  for (const f of ['Nítido', 'Nota a lápiz', 'Pizarra']) {
    const t0 = Date.now(); await clickText('.flt', f); await idle();
    const dark = await c.ev(`(async()=>{let i=document.querySelector('.ed-img'); for (let t=0;t<6;t++){ try { await i.decode(); break; } catch { await new Promise(r=>setTimeout(r,300)); } } const k=document.createElement('canvas'); k.width=200; k.height=Math.round(200*i.naturalHeight/i.naturalWidth); const x=k.getContext('2d'); x.drawImage(i,0,0,k.width,k.height); const d=x.getImageData(0,0,k.width,k.height).data; let s=0,n=0,dk=0; for(let p=0;p<d.length;p+=4){const g=(d[p]+d[p+1]+d[p+2])/3; s+=g; n++; if(g<110) dk++;} return {mean:Math.round(s/n), dark:+(dk/n*100).toFixed(1)}})()`);
    // «Pizarra» está pensado para pizarras (tiza clara sobre oscuro): sobre papel blanco solo se comprueba que corre y es rápido
    check(`filtro «${f}» en Android`, f === 'Pizarra' ? Date.now() - t0 < 4000 : dark.mean > 190 && dark.dark > 0.5, `${Date.now() - t0} ms · ${j(dark)}`);
  }
  await c.shot(path.join(OUT, 'f1-filtros-nuevos.png'));
  const bar = await c.ev(`(()=>{const b=document.querySelector('.ed-flt'); return b.scrollWidth>b.clientWidth})()`);
  check('la barra de filtros se desplaza (9 filtros)', bar);
  const tools = await c.ev(`(()=>{const t=[...document.querySelectorAll('.ed-tool')]; const bad=t.filter(e=>{const s=e.querySelector('span'); return s.scrollWidth>s.clientWidth}).map(e=>e.textContent); return {n:t.length, bad}})()`);
  check('7 herramientas en la barra, con los textos completos', tools.n === 7 && !tools.bad.length, j(tools));

  // ocultar
  await clickText('.flt', 'Mejorado'); await idle();
  await clickText('.ed-tool', 'Ocultar'); await c.until(() => c.ev(`!!(document.querySelector('.crop-img')||{}).style.width`), 10000);
  await sleep(400);
  await clickText('.red-types .btn', 'Tapar en negro');
  // fracciones del svg que caen sobre la imagen (la imagen no ocupa todo el escenario)
  const g = await c.ev(`(()=>{const s=document.querySelector('.crop-svg').getBoundingClientRect(), i=document.querySelector('.crop-img').getBoundingClientRect(); return {x:(i.left-s.left)/s.width, y:(i.top-s.top)/s.height, w:i.width/s.width, h:i.height/s.height}})()`);
  await swipe('.crop-svg', [g.x + g.w * 0.12, g.y + g.h * 0.30], [g.x + g.w * 0.62, g.y + g.h * 0.36]);
  await sleep(200);
  check('se dibuja el recuadro con el dedo', (await c.ev(`document.querySelectorAll('.red-rect').length`)) === 1);
  await c.shot(path.join(OUT, 'f2-ocultar.png'));
  const issues = (await c.ev(auditSource({ ignore: ['.fab', '.tabbar'] }))).filter((i) => !/\.scan-video|\.ed-img|\.crop-img/.test(i.el));
  check('diseño: pantalla Ocultar', !issues.length, issues.slice(0, 4).map((i) => `${i.type}: ${i.el} → ${i.msg}`).join(' | '));
  await clickText('.crop-foot .btn', 'Aplicar'); await idle(); await sleep(600);
  const black = await c.ev(`(async()=>{let i=document.querySelector('.ed-img'); for (let t=0;t<6;t++){ try { await i.decode(); break; } catch { await new Promise(r=>setTimeout(r,300)); } } const k=document.createElement('canvas'); k.width=i.naturalWidth; k.height=i.naturalHeight; const x=k.getContext('2d'); x.drawImage(i,0,0); const d=x.getImageData(Math.round(.37*k.width),Math.round(.33*k.height),1,1).data; return [d[0],d[1],d[2]]})()`);
  check('la zona queda tapada en negro en la imagen final', black.every((v) => v < 12), black.join(','));
  await c.shot(path.join(OUT, 'f3-ocultado.png'));

  // QR
  const qr = await QR.toDataURL('https://wilscan.app/android', { width: 500, margin: 3 });
  const v = await c.ev(`(async()=>{const m=await import('./js/core/qr.js'); const i=new Image(); i.src=${j(qr)}; for (let t=0;t<6;t++){ try { await i.decode(); break; } catch { await new Promise(r=>setTimeout(r,300)); } } const k=document.createElement('canvas'); k.width=i.width; k.height=i.height; k.getContext('2d').drawImage(i,0,0); const t=performance.now(); const r=await m.readQr(k); return {r, ms: Math.round(performance.now()-t)}})()`);
  check('lee un QR en Android', v.r === 'https://wilscan.app/android', j(v));

  console.log(c.logs.length ? 'Errores de consola: ' + c.logs.filter((l) => !/safe area/.test(l)).join(' | ') : '');
  await c.close();
  console.log(fails ? `\n${fails} FALLOS · capturas en ${OUT}` : `\nTODO OK · capturas en ${OUT}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
