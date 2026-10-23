// Detección automática de los bordes de un documento: devuelve las 4 esquinas (TL, TR, BR, BL) normalizadas 0..1, o null.
import { cvRun, canvasOf, imageOf, canRender } from './cv.js';

export { orderQuad } from './cv-ops.js';

export async function detectQuad(source, { maxSide = 520 } = {}) {
  const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  let q;
  // Camino rápido: el navegador entrega el fotograma ya reducido (ImageBitmap) y es el Worker quien lee los píxeles.
  // Leer píxeles de un video en el hilo principal es lo más caro de la detección en vivo.
  if (await canRender()) {
    try {
      const bmp = await createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' });
      q = await cvRun('detectBmp', [{ bmp, w, h, px: w * h }], { transfer: [bmp], retry: false });
      return q && q.map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
    } catch { /* se hace en el hilo principal */ }
  }
  const tmp = canvasOf(w, h);
  tmp.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h);
  q = await cvRun('detect', [imageOf(tmp)]);
  return q && q.map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
}
