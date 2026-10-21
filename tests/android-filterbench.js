// Mide el filtro «auto» varias veces seguidas dentro de la app Android (¿se acelera tras la primera vez?)
const { connect } = require('./lib/android');
(async () => {
  const c = await connect({ restart: true });
  await c.until(() => c.ev(`document.documentElement.dataset.ready==='1'`), 30000);
  const r = await c.ev(`(async()=>{
    const m = await import('./js/core/cv.js'); await m.loadCV();
    const out = [];
    for (const [w,h] of (${process.env.SIZES || '[[1800,1350],[1800,1350],[1800,1350],[600,450],[1800,1350]]'})) {
      const cvs = m.canvasOf(w,h), x = cvs.getContext('2d'); x.fillStyle='#ddd'; x.fillRect(0,0,w,h); x.fillStyle='#222'; for(let i=0;i<200;i++) x.fillRect((i*37)%w,(i*91)%h,40,8);
      const t = performance.now(); await m.cvRun('filter', [m.imageOf(cvs), { filter: 'auto' }]); out.push(w+'x'+h+': '+Math.round(performance.now()-t)+' ms');
    }
    return out;
  })()`);
  console.log(r.join('\n')); await c.close(); process.exit(0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
