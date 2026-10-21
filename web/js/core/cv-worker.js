// Worker de imagen: carga OpenCV (≈13 MB) y ejecuta las operaciones de cv-ops.js fuera del hilo principal,
// así la pantalla no se congela ni al abrir el motor ni al procesar fotos.
/* global importScripts */
let ops = null, cv = null;

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    const res = ops[op](cv, ...args);
    self.postMessage({ id, res }, res && res.data ? [res.data.buffer] : []);
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};

(async () => {
  try {
    importScripts(new URL('../../vendor/opencv/opencv.js', self.location.href).href);
    cv = self.cv;
    if (cv && typeof cv.then === 'function') cv = await cv;                      // la versión 5 entrega una promesa
    if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });     // versiones anteriores
    ops = await import('./cv-ops.js');
    self.postMessage({ ready: true });
  } catch (err) { self.postMessage({ fatal: String((err && err.message) || err) }); }
})();
