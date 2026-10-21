// Detección automática de los bordes de un documento: devuelve las 4 esquinas (TL, TR, BR, BL) normalizadas 0..1, o null.
import { cvRun, canvasOf, imageOf } from './cv.js';

export { orderQuad } from './cv-ops.js';

export async function detectQuad(source, { maxSide = 520 } = {}) {
  const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  const tmp = canvasOf(w, h);
  tmp.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h);
  const q = await cvRun('detect', [imageOf(tmp)]);
  return q && q.map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
}
