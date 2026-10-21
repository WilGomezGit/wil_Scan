// Worker de imagen: carga OpenCV (≈13 MB) y ejecuta las operaciones de cv-ops.js fuera del hilo principal,
// así la pantalla no se congela ni al abrir el motor ni al procesar fotos.
/* global importScripts */
let ops = null, cv = null;

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    const t0 = performance.now();
    const res = ops[op](cv, ...args);
    self.postMessage({ id, res, ms: Math.round(performance.now() - t0) }, res && res.data ? [res.data.buffer] : []);
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};

(async () => {
  try {
    const t0 = performance.now();
    importScripts(new URL('../../vendor/opencv/opencv.js', self.location.href).href);
    cv = self.cv;
    const t1 = performance.now();
    if (cv && typeof cv.then === 'function') cv = await cv;                      // la versión 5 entrega una promesa
    if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });     // versiones anteriores
    ops = await import('./cv-ops.js');
    self.postMessage({ ready: true, ms: { leer: Math.round(t1 - t0), iniciar: Math.round(performance.now() - t1) } });
    // calentamiento: la primera vez que corre cada operación el navegador la ejecuta sin optimizar (el doble de lenta);
    // se hace una pasada con una imagen pequeña mientras el usuario aún elige la foto
    setTimeout(() => {
      try {
        const img = () => { const w = 480, h = 360, d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i++) d[i] = (i * 2654435761) >>> 24; return { data: d, width: w, height: h }; };
        ops.detect(cv, img());
        ops.warp(cv, img(), [[10, 10], [470, 12], [468, 350], [12, 348]], 400, 300);
        for (const filter of ['auto', 'bn']) ops.filter(cv, img(), { filter });
      } catch { /* solo era para calentar */ }
    }, 30);
  } catch (err) { self.postMessage({ fatal: String((err && err.message) || err) }); }
})();
