// Operaciones de imagen con OpenCV sobre píxeles RGBA crudos: detectar el papel, corregir la perspectiva y aplicar filtros.
// Se ejecutan dentro de un Worker (cv-worker.js) para no congelar la pantalla; si el Worker no está disponible, en el hilo principal.
// Cada operación recibe `cv` y una imagen { data: Uint8ClampedArray RGBA, width, height } y devuelve datos simples.

const free = (...mats) => { for (const m of mats) { try { if (m && !m.isDeleted()) m.delete(); } catch { /* ya liberada */ } } };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const toMat = (cv, img) => { const m = new cv.Mat(img.height, img.width, cv.CV_8UC4); m.data.set(img.data); return m; };
// Mat (1, 3 o 4 canales) → imagen RGBA que se puede transferir
function toImage(cv, m) {
  let rgba = m;
  if (m.channels() === 3) { rgba = new cv.Mat(); cv.cvtColor(m, rgba, cv.COLOR_RGB2RGBA); }
  else if (m.channels() === 1) { rgba = new cv.Mat(); cv.cvtColor(m, rgba, cv.COLOR_GRAY2RGBA); }
  const out = { data: new Uint8ClampedArray(rgba.data), width: m.cols, height: m.rows };
  if (rgba !== m) free(rgba);
  return out;
}

// ---------------------------------------------------------------- detectar el papel
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

// img ya viene reducida (≈ 400-520 px). Devuelve las 4 esquinas en píxeles de esa imagen, o null.
export function detect(cv, img) {
  const w = img.width, h = img.height;
  const src = toMat(cv, img), gray = new cv.Mat(), blur = new cv.Mat();
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
    return found[0].q;
  } finally { free(src, gray, blur, edges, th, kernel); }
}

// ---------------------------------------------------------------- perspectiva
// p: 4 esquinas (TL, TR, BR, BL) en píxeles de img; el resultado mide W×H
export function warp(cv, img, p, W, H) {
  const mat = toMat(cv, img), dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, p.flat());
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W - 1, 0, W - 1, H - 1, 0, H - 1]);
  const M = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(mat, dst, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    return toImage(cv, dst);
  } finally { free(mat, dst, from, to, M); }
}

// ---------------------------------------------------------------- filtros
const odd = (n) => { n = Math.max(3, Math.round(n)); return n % 2 ? n : n + 1; };

// Divide cada píxel por el fondo estimado (papel sin texto): elimina sombras y degradados de luz. Devuelve RGB.
// Vale para color (3 canales) y para grises (1 canal: tres veces menos trabajo).
// El fondo es una superficie lisa: se estima a ~320 px (antes 600), con el mismo resultado visual y mucho menos cálculo.
function flatten(cv, rgb) {
  const w = rgb.cols, h = rgb.rows, k = Math.max(1, Math.max(w, h) / 320);
  const small = new cv.Mat(), dil = new cv.Mat(), med = new cv.Mat(), bg = new cv.Mat(), out = new cv.Mat();
  const ker = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  try {
    cv.resize(rgb, small, new cv.Size(Math.max(8, Math.round(w / k)), Math.max(8, Math.round(h / k))), 0, 0, cv.INTER_AREA);
    cv.dilate(small, dil, ker);                         // el máximo local borra el texto oscuro
    cv.medianBlur(dil, med, 11);
    cv.GaussianBlur(med, med, new cv.Size(0, 0), 3);
    cv.resize(med, bg, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
    cv.divide(rgb, bg, out, 255, -1);
    return out;
  } finally { free(small, dil, med, bg, ker); }
}

// Máscara de enfoque. El desenfoque se calcula a media resolución (mismo resultado visual, mucho más rápido que un gaussiano grande a tamaño completo).
function sharpen(cv, m, amount = 0.6) {
  const half = new cv.Mat(), blur = new cv.Mat(), dst = new cv.Mat();
  try {
    cv.resize(m, half, new cv.Size(Math.max(1, m.cols >> 1), Math.max(1, m.rows >> 1)), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(half, half, new cv.Size(0, 0), 1);
    cv.resize(half, blur, new cv.Size(m.cols, m.rows), 0, 0, cv.INTER_LINEAR);
    cv.addWeighted(m, 1 + amount, blur, -amount, 0, dst);
    return dst;
  } finally { free(half, blur); }
}

// Oscurece los tonos medios (g > 1): los trazos finos de lápiz o tiza quedan firmes sin ensuciar el fondo blanco
function darken(m, g) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, g));
  const d = m.data;
  for (let i = 0; i < d.length; i++) d[i] = lut[d[i]];
}

function saturate(img, k) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g + (d[i] - g) * k; d[i + 1] = g + (d[i + 1] - g) * k; d[i + 2] = g + (d[i + 2] - g) * k;   // Uint8ClampedArray recorta a 0..255
  }
}

// opts: { filter, bright (-50..50), contrast (-50..50) }
export function filter(cv, img, { filter = 'auto', bright = 0, contrast = 0 } = {}) {
  const mat = toMat(cv, img), rgb = new cv.Mat();
  let cur = null;
  try {
    cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
    if (filter === 'original') cur = rgb.clone();
    else {
      const colour = filter === 'sombras' || filter === 'auto' || filter === 'color' || filter === 'nitido';
      const flat = colour ? flatten(cv, rgb) : null;
      if (filter === 'sombras') cur = flat;
      else if (colour) { cur = sharpen(cv, flat, filter === 'nitido' ? 1.6 : 0.7); free(flat); }
      else {
        // grises y blanco y negro: se pasa a un canal ANTES de quitar sombras (un tercio del trabajo)
        const g0 = new cv.Mat(); cv.cvtColor(rgb, g0, cv.COLOR_RGB2GRAY);
        if (filter === 'pizarra') cv.bitwise_not(g0, g0);      // tiza clara sobre fondo oscuro → trazo oscuro sobre fondo claro
        const gray = flatten(cv, g0); free(g0);
        if (filter === 'gris') { cur = gray; }
        else if (filter === 'nota' || filter === 'pizarra') { darken(gray, filter === 'nota' ? 2.4 : 2); cur = gray; }
        else {   // bn
          const bw = new cv.Mat();
          cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
          cv.adaptiveThreshold(gray, bw, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, odd(Math.min(gray.cols, gray.rows) / 22), 24);
          cur = bw; free(gray);
        }
      }
    }
    if (bright || contrast) { const adj = new cv.Mat(); cur.convertTo(adj, -1, 1 + contrast / 50, bright * 1.6); free(cur); cur = adj; }
    const out = toImage(cv, cur);
    if (filter === 'color') saturate(out, 1.4);
    return out;
  } finally { free(mat, rgb, cur); }
}
