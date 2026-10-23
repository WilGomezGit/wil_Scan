// Worker de imagen: carga OpenCV (≈13 MB) y ejecuta las operaciones de cv-ops.js (bordes, perspectiva, filtros) y render-ops.js
// (páginas completas: decodificar, recortar, filtrar y codificar) fuera del hilo principal, así la pantalla no se congela.
/* global importScripts */
let ops = null, cv = null;

// Las tareas se hacen de una en una, en el orden en que llegan (varias a la vez se pisarían la memoria y la caché)
let chain = Promise.resolve();
self.onmessage = (e) => { chain = chain.then(() => run(e.data)); };

async function run({ id, op, args }) {
  self.postMessage({ started: id });                                  // el control de tiempo máximo empieza cuando la tarea EMPIEZA, no cuando espera su turno
  try {
    const t0 = performance.now();
    const res = await ops[op](cv, ...args);
    self.postMessage({ id, res, ms: Math.round(performance.now() - t0) }, res && res.data ? [res.data.buffer] : []);
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
}

(async () => {
  try {
    const t0 = performance.now();
    importScripts(new URL('../../vendor/opencv/opencv.js', self.location.href).href);
    cv = self.cv;
    const t1 = performance.now();
    if (cv && typeof cv.then === 'function') cv = await cv;                      // la versión 5 entrega una promesa
    if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });     // versiones anteriores
    const render = await import('./render-ops.js');
    ops = Object.assign({}, await import('./cv-ops.js'), render);
    const canRender = await render.selfTest();
    self.postMessage({ ready: true, caps: { render: canRender }, ms: { leer: Math.round(t1 - t0), iniciar: Math.round(performance.now() - t1) } });
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
