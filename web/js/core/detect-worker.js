// Worker liviano de bordes y perspectiva (quad.js, JavaScript puro): arranca en milisegundos y no carga OpenCV.
// Tiene su propio hilo para que la detección en vivo de la cámara no espere detrás del procesado de las páginas.
let ops = null;
const ready = import('./quad.js').then((m) => { ops = m; });

function pixels(bmp, w, h) {
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, w, h); if (bmp.close) bmp.close();
  return x.getImageData(0, 0, w, h);
}

self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    await ready;
    const t0 = performance.now();
    let res, transfer = [];
    if (op === 'detectBmp') res = ops.detect(pixels(args.bmp, args.w, args.h));
    else if (op === 'detect') res = ops.detect(args);
    else if (op === 'warp') { res = ops.warp(args.img, args.p, args.W, args.H); transfer = [res.data.buffer]; }
    else throw new Error('operación desconocida: ' + op);
    self.postMessage({ id, res, ms: Math.round(performance.now() - t0) }, transfer);
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};
self.postMessage({ ready: true, offscreen: typeof OffscreenCanvas !== 'undefined' });
