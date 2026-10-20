// Corrección de perspectiva: recorta el documento dentro de las 4 esquinas y lo deja rectangular.
import { loadCV, free, canvasOf } from './cv.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// quad: 4 puntos normalizados (TL, TR, BR, BL) o null (toda la imagen)
export async function warpQuad(src, quad, { maxSide = 2800 } = {}) {
  const sw = src.width, sh = src.height;
  if (!quad) {
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = canvasOf(sw * k, sh * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
  }
  const cv = await loadCV();
  const p = quad.map(([x, y]) => [x * sw, y * sh]);
  let W = Math.max(dist(p[0], p[1]), dist(p[3], p[2])), H = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
  const k = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(8, Math.round(W * k)); H = Math.max(8, Math.round(H * k));
  const mat = cv.imread(src), dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, p.flat());
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W - 1, 0, W - 1, H - 1, 0, H - 1]);
  const M = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(mat, dst, M, new cv.Size(W, H), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    const out = canvasOf(W, H); cv.imshow(out, dst); return out;
  } finally { free(mat, dst, from, to, M); }
}

// Giro fino (ángulos pequeños) manteniendo el tamaño; el relleno de las esquinas toma el color medio del borde
export function rotateBy(c, deg) {
  if (!deg) return c;
  const out = canvasOf(c.width, c.height), x = out.getContext('2d'), s = c.getContext('2d', { willReadFrequently: true });
  const px = [[2, 2], [c.width - 3, 2], [2, c.height - 3], [c.width - 3, c.height - 3]].map(([a, b]) => s.getImageData(a, b, 1, 1).data);
  const avg = [0, 1, 2].map((i) => Math.round(px.reduce((t, p) => t + p[i], 0) / 4));
  x.fillStyle = `rgb(${avg[0]},${avg[1]},${avg[2]})`; x.fillRect(0, 0, out.width, out.height);
  x.translate(out.width / 2, out.height / 2); x.rotate((deg * Math.PI) / 180); x.imageSmoothingQuality = 'high'; x.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export function rotateCanvas(c, deg) {
  const r = ((deg % 360) + 360) % 360;
  if (!r) return c;
  const swap = r === 90 || r === 270;
  const out = canvasOf(swap ? c.height : c.width, swap ? c.width : c.height);
  const x = out.getContext('2d');
  x.translate(out.width / 2, out.height / 2); x.rotate((r * Math.PI) / 180); x.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}
