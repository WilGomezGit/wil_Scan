// Detección automática de los bordes de un documento: devuelve las 4 esquinas (TL, TR, BR, BL) normalizadas 0..1, o null.
// Se hace con quad.js (JavaScript puro, unos KB) en un Worker propio: no espera a que cargue OpenCV (13 MB) ni a que terminen las páginas.
import { detect as detectLocal } from './quad.js';
import { perf, logError } from './cv.js';

export { orderQuad } from './quad.js';

let wp = null;
// Worker de bordes (idempotente). Si no arranca, todo se hace en el hilo principal (con la imagen reducida son pocos milisegundos).
export function detectWorker() {
  if (!wp) {
    wp = new Promise((resolve) => {
      if (typeof Worker === 'undefined') return resolve(null);
      let w;
      try { w = new Worker(new URL('./detect-worker.js', import.meta.url)); } catch { return resolve(null); }
      const pending = new Map(); let seq = 0;
      const h = {
        dead: false, offscreen: false,
        stop(why) { if (h.dead) return; h.dead = true; w.terminate(); for (const p of pending.values()) p.reject(new Error(why)); pending.clear(); wp = null; },
        run(op, args, transfer = [], ms = 4000) {
          return new Promise((res, rej) => {
            if (h.dead) return rej(new Error('motor cerrado'));
            const id = ++seq, t = setTimeout(() => h.stop('el detector no respondió'), ms);     // un Worker cerrado por Android no avisa: se descarta y se abre otro
            pending.set(id, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
            w.postMessage({ id, op, args }, transfer);
          });
        },
      };
      const boot = setTimeout(() => { w.terminate(); resolve(null); }, 5000);
      w.onmessage = ({ data: m }) => {
        if (m.ready) { clearTimeout(boot); h.offscreen = m.offscreen; resolve(h); return; }
        const p = pending.get(m.id); if (!p) return;
        pending.delete(m.id);
        if (m.ms != null) { perf.ops = perf.ops || []; perf.ops.unshift(`bordes: ${m.ms} ms`); perf.ops.length = Math.min(perf.ops.length, 20); }
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.res);
      };
      w.onerror = (e) => { clearTimeout(boot); logError('detector: ' + (e.message || 'error')); if (!h.dead) h.stop('error del detector'); resolve(null); };
    });
  }
  return wp;
}

function pixelsOf(source, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(source, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
}

export async function detectQuad(source, { maxSide = 520 } = {}) {
  const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
  if (!sw || !sh) return null;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const norm = (q) => q && q.map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
  const wk = await detectWorker();
  if (wk && !wk.dead) {
    try {
      // camino rápido: el navegador entrega el fotograma ya reducido (ImageBitmap) y es el Worker quien lee los píxeles
      if (wk.offscreen && typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' });
        return norm(await wk.run('detectBmp', { bmp, w, h }, [bmp]));
      }
      const img = pixelsOf(source, w, h);
      return norm(await wk.run('detect', img, [img.data.buffer]));
    } catch { /* se hace aquí */ }
  }
  return norm(detectLocal(pixelsOf(source, w, h)));
}
