// Corrección de perspectiva: recorta el documento dentro de las 4 esquinas y lo deja rectangular.
import { cvRun, canvasOf, canvasFrom, imageOf } from './cv.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// quad: 4 puntos normalizados (TL, TR, BR, BL) o null (toda la imagen)
// Solo se envía al motor la zona del papel y ya a la resolución de salida (no la foto entera): es lo que más tiempo ahorra.
export async function warpQuad(src, quad, { maxSide = 2200 } = {}) {
  const sw = src.width, sh = src.height;
  if (!quad) {
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = canvasOf(sw * k, sh * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
  }
  const p = quad.map(([x, y]) => [x * sw, y * sh]);
  let W = Math.max(dist(p[0], p[1]), dist(p[3], p[2])), H = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
  const k = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(8, Math.round(W * k)); H = Math.max(8, Math.round(H * k));
  const x0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[0]))) - 2), y0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[1]))) - 2);
  const x1 = Math.min(sw, Math.ceil(Math.max(...p.map((q) => q[0]))) + 2), y1 = Math.min(sh, Math.ceil(Math.max(...p.map((q) => q[1]))) + 2);
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const crop = canvasOf(bw * k, bh * k), x = crop.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(src, x0, y0, bw, bh, 0, 0, crop.width, crop.height);
  const local = p.map(([px, py]) => [(px - x0) * crop.width / bw, (py - y0) * crop.height / bh]);
  return canvasFrom(await cvRun('warp', [imageOf(crop), local, W, H]));
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
