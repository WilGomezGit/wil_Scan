// Detección automática de los bordes de un documento: devuelve las 4 esquinas (TL, TR, BR, BL) normalizadas 0..1, o null.
import { loadCV, free, canvasOf } from './cv.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Ordena 4 puntos como arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda
export function orderQuad(pts) {
  const bySum = [...pts].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const tl = bySum[0], br = bySum[3];
  const rest = [bySum[1], bySum[2]].sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
  return [tl, rest[0], br, rest[1]];                // rest[0] tiene menor y-x → arriba-derecha
}

function convex(p) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (z === 0) continue;
    if (sign === 0) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

// ¿Es un cuadrilátero plausible de documento? (no demasiado pequeño, ni lados deformados)
function plausible(q, w, h) {
  const area = Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + (p[0] * n[1] - n[0] * p[1]); }, 0)) / 2;
  const ratio = area / (w * h);
  if (ratio < 0.12 || ratio > 0.985) return null;
  const sides = [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0])];
  if (Math.min(...sides) < Math.min(w, h) * 0.12) return null;
  if (Math.max(sides[0], sides[2]) / Math.min(sides[0], sides[2]) > 2.2 || Math.max(sides[1], sides[3]) / Math.min(sides[1], sides[3]) > 2.2) return null;
  return ratio;
}

// Desplaza cada lado d píxeles hacia dentro (compensa que el borde dilatado engorda el contorno)
function inset(q, d) {
  if (!d) return q;
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const lines = q.map((a, i) => {
    const b = q[(i + 1) % 4]; let nx = b[1] - a[1], ny = a[0] - b[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if ((cx - a[0]) * nx + (cy - a[1]) * ny < 0) { nx = -nx; ny = -ny; }           // normal hacia el centro
    return { px: a[0] + nx * d, py: a[1] + ny * d, dx: b[0] - a[0], dy: b[1] - a[1] };
  });
  const hit = (l1, l2) => { const den = l1.dx * l2.dy - l1.dy * l2.dx; if (Math.abs(den) < 1e-9) return [l1.px, l1.py]; const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den; return [l1.px + l1.dx * t, l1.py + l1.dy * t]; };
  return [hit(lines[3], lines[0]), hit(lines[0], lines[1]), hit(lines[1], lines[2]), hit(lines[2], lines[3])];
}

function candidates(cv, mask, w, h, shrink = 0) {
  const out = [];
  const contours = new cv.MatVector(), hier = new cv.Mat();
  try {
    cv.findContours(mask, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const list = [];
    for (let i = 0; i < contours.size(); i++) { const c = contours.get(i); list.push({ i, area: cv.contourArea(c) }); c.delete(); }
    list.sort((a, b) => b.area - a.area);
    for (const { i, area } of list.slice(0, 6)) {
      if (area < w * h * 0.1) break;
      const c = contours.get(i), hull = new cv.Mat();
      cv.convexHull(c, hull, false, true);
      const peri = cv.arcLength(hull, true);
      for (const eps of [0.02, 0.03, 0.045, 0.06]) {
        const ap = new cv.Mat();
        cv.approxPolyDP(hull, ap, eps * peri, true);
        if (ap.rows === 4) {
          const pts = []; for (let k = 0; k < 4; k++) pts.push([ap.data32S[k * 2], ap.data32S[k * 2 + 1]]);
          ap.delete();
          const q = inset(orderQuad(pts), shrink);
          if (convex(q)) { const r = plausible(q, w, h); if (r) out.push({ q, ratio: r }); }
          break;
        }
        ap.delete();
      }
      c.delete(); hull.delete();
    }
  } finally { free(contours, hier); }
  return out;
}

export async function detectQuad(source, { maxSide = 520 } = {}) {
  const cv = await loadCV();
  const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  const tmp = canvasOf(w, h);
  tmp.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h);
  const src = cv.imread(tmp), gray = new cv.Mat(), blur = new cv.Mat();
  const edges = new cv.Mat(), th = new cv.Mat(), kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    let found = [];
    // 1) bordes de Canny, cerrados para unir huecos
    cv.Canny(blur, edges, 40, 120);
    cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2);
    found = found.concat(candidates(cv, edges, w, h, 4));
    // 2) umbral de Otsu: el papel suele ser lo más claro de la escena
    cv.threshold(blur, th, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    cv.morphologyEx(th, th, cv.MORPH_CLOSE, kernel);
    cv.morphologyEx(th, th, cv.MORPH_OPEN, kernel);
    found = found.concat(candidates(cv, th, w, h));
    if (!found.length) return null;
    found.sort((a, b) => b.ratio - a.ratio);
    return found[0].q.map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
  } finally { free(src, gray, blur, edges, th, kernel); }
}
