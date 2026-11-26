// Detección de los bordes del papel y corrección de perspectiva en JavaScript puro (sin OpenCV).
// Pesa unos KB en vez de 13 MB: funciona desde el primer fotograma de la cámara y tarda pocos milisegundos con la imagen reducida (~420-520 px).
// Mismo método que antes con OpenCV: bordes de Canny cerrados + umbral de Otsu; se rellenan los huecos de cada mancha, se toma su envolvente
// convexa y el cuadrilátero de mayor área dentro de ella; se acepta si la mancha es de verdad de cuatro lados y tiene forma de papel.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Ordena 4 puntos como arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda
export function orderQuad(pts) {
  const bySum = [...pts].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const tl = bySum[0], br = bySum[3];
  const rest = [bySum[1], bySum[2]].sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
  return [tl, rest[0], br, rest[1]];
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
const polyArea = (q) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]; return s + (p[0] * n[1] - n[0] * p[1]); }, 0)) / 2;

// ¿Es un cuadrilátero plausible de documento? (no demasiado pequeño, ni lados deformados)
function plausible(q, w, h) {
  const ratio = polyArea(q) / (w * h);
  if (ratio < 0.12 || ratio > 0.985) return null;
  const sides = [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0])];
  if (Math.min(...sides) < Math.min(w, h) * 0.12) return null;
  if (Math.max(sides[0], sides[2]) / Math.min(sides[0], sides[2]) > 2.2 || Math.max(sides[1], sides[3]) / Math.min(sides[1], sides[3]) > 2.2) return null;
  return ratio;
}

// Desplaza cada lado d píxeles hacia dentro (compensa que el borde dilatado engorda la mancha)
function inset(q, d) {
  if (!d) return q;
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const lines = q.map((a, i) => {
    const b = q[(i + 1) % 4]; let nx = b[1] - a[1], ny = a[0] - b[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if ((cx - a[0]) * nx + (cy - a[1]) * ny < 0) { nx = -nx; ny = -ny; }
    return { px: a[0] + nx * d, py: a[1] + ny * d, dx: b[0] - a[0], dy: b[1] - a[1] };
  });
  const hit = (l1, l2) => { const den = l1.dx * l2.dy - l1.dy * l2.dx; if (Math.abs(den) < 1e-9) return [l1.px, l1.py]; const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den; return [l1.px + l1.dx * t, l1.py + l1.dy * t]; };
  return [hit(lines[3], lines[0]), hit(lines[0], lines[1]), hit(lines[1], lines[2]), hit(lines[2], lines[3])];
}

// ---------------------------------------------------------------- imagen
function grayOf(data, n) {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  return g;
}
// desenfoque gaussiano 5×5 (1 4 6 4 1), separable, con bordes replicados
function blur5(src, w, h) {
  const tmp = new Uint16Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const a = src[r + Math.max(0, x - 2)], b = src[r + Math.max(0, x - 1)], c = src[r + x], d = src[r + Math.min(w - 1, x + 1)], e = src[r + Math.min(w - 1, x + 2)];
      tmp[r + x] = a + 4 * b + 6 * c + 4 * d + e;
    }
  }
  for (let y = 0; y < h; y++) {
    const ra = Math.max(0, y - 2) * w, rb = Math.max(0, y - 1) * w, rc = y * w, rd = Math.min(h - 1, y + 1) * w, re = Math.min(h - 1, y + 2) * w;
    for (let x = 0; x < w; x++) out[rc + x] = (tmp[ra + x] + 4 * tmp[rb + x] + 6 * tmp[rc + x] + 4 * tmp[rd + x] + tmp[re + x] + 128) >> 8;
  }
  return out;
}
// Canny con Sobel 3×3 y magnitud L1 (como OpenCV por defecto)
function canny(g, w, h, lo, hi) {
  const n = w * h, mag = new Int32Array(n), dir = new Uint8Array(n), out = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const ax = gx < 0 ? -gx : gx, ay = gy < 0 ? -gy : gy;
      mag[i] = ax + ay;
      // 0: horizontal (gradiente en x) · 1: 45° · 2: vertical · 3: 135°   (tan 22,5° ≈ 0,4142)
      if (ay * 1000 < ax * 414) dir[i] = 0;
      else if (ay * 414 > ax * 1000) dir[i] = 2;
      else dir[i] = (gx ^ gy) < 0 ? 3 : 1;
    }
  }
  const stack = new Int32Array(n); let sp = 0;
  const strong = new Uint8Array(n), nb = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, m = mag[i];
      if (m <= lo) continue;
      let a, b;
      switch (dir[i]) {
        case 0: a = mag[i - 1]; b = mag[i + 1]; break;
        case 2: a = mag[i - w]; b = mag[i + w]; break;
        case 1: a = mag[i - w - 1]; b = mag[i + w + 1]; break;
        default: a = mag[i - w + 1]; b = mag[i + w - 1];
      }
      if (m > a && m >= b) { strong[i] = m > hi ? 2 : 1; if (m > hi) { out[i] = 255; stack[sp++] = i; } }
    }
  }
  while (sp) {                                       // histéresis: los bordes débiles pegados a uno fuerte también cuentan
    const i = stack[--sp];
    for (let k = 0; k < 8; k++) { const j = i + nb[k]; if (strong[j] === 1 && !out[j]) { out[j] = 255; stack[sp++] = j; } }
  }
  return out;
}
// dilatar (isMax) o erosionar una máscara 0/255 con un cuadrado de lado 2r+1, separable y con sumas deslizantes (coste fijo por píxel).
// Fuera de la imagen no cuenta (como OpenCV: el borde ni engorda ni come la máscara).
function morph(src, w, h, r, isMax) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), win = new Int32Array(Math.max(w, h));
  // ancho de la ventana recortada en cada posición (para erosionar: todos los de dentro deben estar puestos)
  const spans = (len) => { for (let k = 0; k < len; k++) win[k] = Math.min(len - 1, k + r) - Math.max(0, k - r) + 1; };
  spans(w);
  for (let y = 0, row = 0; y < h; y++, row += w) {
    let ones = 0;
    for (let k = 0; k < r && k < w; k++) if (src[row + k]) ones++;
    for (let x = 0; x < w; x++) {
      if (x + r < w && src[row + x + r]) ones++;
      if (x - r - 1 >= 0 && src[row + x - r - 1]) ones--;
      tmp[row + x] = (isMax ? ones > 0 : ones === win[x]) ? 255 : 0;
    }
  }
  spans(h);
  const cnt = new Int32Array(w);
  for (let k = 0; k < r && k < h; k++) for (let x = 0, row = k * w; x < w; x++) if (tmp[row + x]) cnt[x]++;
  for (let y = 0; y < h; y++) {
    const addR = y + r < h ? (y + r) * w : -1, delR = y - r - 1 >= 0 ? (y - r - 1) * w : -1, row = y * w, need = win[y];
    for (let x = 0; x < w; x++) {
      if (addR >= 0 && tmp[addR + x]) cnt[x]++;
      if (delR >= 0 && tmp[delR + x]) cnt[x]--;
      out[row + x] = (isMax ? cnt[x] > 0 : cnt[x] === need) ? 255 : 0;
    }
  }
  return out;
}
function otsu(g) {
  const hist = new Float64Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const n = g.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sb = 0, wb = 0, best = 0, th = 127;
  for (let t = 0; t < 256; t++) {
    wb += hist[t]; if (!wb) continue; const wf = n - wb; if (!wf) break;
    sb += t * hist[t]; const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf);
    if (v > best) { best = v; th = t; }
  }
  return th;
}

// ---------------------------------------------------------------- manchas
// Rellena los huecos de la máscara (lo que no se puede alcanzar desde el borde de la imagen) y devuelve las manchas grandes resultantes
// con su envolvente convexa. Equivale al contorno exterior de findContours (cuyo área incluye los huecos).
function blobs(mask, w, h, minArea) {
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n);
  // 1) fondo: píxeles vacíos alcanzables desde el borde (vecindad 4)
  let sp = 0;
  const seed = (i) => { if (!mask[i] && lab[i] === 0) { lab[i] = -1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp], x = i % w;
    let j;
    if (x > 0 && !mask[j = i - 1] && lab[j] === 0) { lab[j] = -1; stack[sp++] = j; }
    if (x < w - 1 && !mask[j = i + 1] && lab[j] === 0) { lab[j] = -1; stack[sp++] = j; }
    if (i >= w && !mask[j = i - w] && lab[j] === 0) { lab[j] = -1; stack[sp++] = j; }
    if (i < n - w && !mask[j = i + w] && lab[j] === 0) { lab[j] = -1; stack[sp++] = j; }
  }
  // 2) el resto (máscara + huecos) en manchas de vecindad 8, guardando el píxel más a la izquierda y a la derecha de cada fila
  const out = [], minX = new Int32Array(h).fill(w), maxX = new Int32Array(h).fill(-1), nb = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (lab[s] !== 0) continue;
    id++; lab[s] = id; sp = 0; stack[sp++] = s;
    let area = 0, y0 = h, y1 = -1;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i - x) / w;
      area++;
      if (x < minX[y]) minX[y] = x; if (x > maxX[y]) maxX[y] = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        for (let k = 0; k < 8; k++) { const j = i + nb[k]; if (lab[j] === 0) { lab[j] = id; stack[sp++] = j; } }
      } else {
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx; if (lab[j] === 0) { lab[j] = id; stack[sp++] = j; }
          }
        }
      }
    }
    const pts = [];
    for (let y = y0; y <= y1; y++) {
      if (area >= minArea && maxX[y] >= 0) { pts.push([minX[y], y]); if (maxX[y] !== minX[y]) pts.push([maxX[y], y]); }
      minX[y] = w; maxX[y] = -1;
    }
    if (area >= minArea) out.push({ area, hull: hullOf(pts) });
  }
  return out.sort((a, b) => b.area - a.area).slice(0, 6);
}
// envolvente convexa (cadena monótona), en sentido antihorario
function hullOf(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
// simplifica un polígono cerrado (Douglas-Peucker), conservando las esquinas
function simplify(poly, eps) {
  const n = poly.length; if (n <= 8) return poly;
  let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = dist(poly[0], poly[i]); if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
  const seg = (a, b) => {                               // índices a < b (b puede ser n para cerrar con el 0)
    let best = -1, bi = -1; const P = poly[a], Q = poly[b % n], dx = Q[0] - P[0], dy = Q[1] - P[1], L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const R = poly[i], d = Math.abs(dx * (R[1] - P[1]) - dy * (R[0] - P[0])) / L; if (d > best) { best = d; bi = i; } }
    if (best > eps) { keep[bi] = 1; seg(a, bi); seg(bi, b); }
  };
  seg(0, far); seg(far, n);
  return poly.filter((_, i) => keep[i]);
}
// el cuadrilátero de mayor área con vértices en el polígono convexo
function biggestQuad(poly) {
  const n = poly.length; if (n < 4) return null;
  const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  let best = 0, q = null;
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue;
      let bj = -1, aj = 0; for (let j = i + 1; j < k; j++) { const t = tri(poly[i], poly[j], poly[k]); if (t > aj) { aj = t; bj = j; } }
      let bl = -1, al = 0; for (let l = k + 1; l < n + i; l++) { const t = tri(poly[k], poly[l % n], poly[i]); if (t > al) { al = t; bl = l % n; } }
      if (bj >= 0 && bl >= 0 && aj + al > best) { best = aj + al; q = [poly[i], poly[bj], poly[k], poly[bl]]; }
    }
  }
  return q;
}

function candidates(mask, w, h, shrink) {
  const out = [];
  for (const b of blobs(mask, w, h, w * h * 0.1)) {
    const peri = b.hull.reduce((s, p, i) => s + dist(p, b.hull[(i + 1) % b.hull.length]), 0);
    const poly = simplify(b.hull, Math.max(1, peri * 0.006));
    const raw = biggestQuad(poly);
    if (!raw) continue;
    const ha = polyArea(b.hull);
    if (polyArea(raw) < ha * 0.9) continue;            // la mancha no es de cuatro lados (una mano encima, un objeto redondo…)
    const q = inset(orderQuad(raw), shrink);
    if (convex(q)) { const r = plausible(q, w, h); if (r) out.push({ q, ratio: r }); }
  }
  return out;
}

// Fuerza del borde (Sobel, magnitud L1) de la imagen desenfocada
function sobel(g, w, h) {
  const mag = new Uint16Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      mag[i] = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
    }
  }
  return mag;
}
// Fuerza del borde a lo largo de los 4 lados de un cuadro: para cada punto del lado, el borde más fuerte a ±3 px (la detección no es exacta al píxel).
function sideSamples(q, mag, w, h) {
  const out = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, side = [];
    for (let k = 1; k < 40; k++) {
      const t = k / 40, px = a[0] + dx * t, py = a[1] + dy * t; let m = 0;
      for (let o = -3; o <= 3; o++) {
        const x = Math.round(px + nx * o), y = Math.round(py + ny * o);
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && mag[y * w + x] > m) m = mag[y * w + x];
      }
      side.push(m);
    }
    out.push(side);
  }
  return out;
}
// ¿Qué parte de los lados cae sobre un borde nítido? (0..1, cada lado cuenta lo mismo). El papel tiene un borde fuerte y continuo;
// una funda de plástico, una sombra o la mesa entera, no.
const support = (sides, T) => sides.reduce((s, side) => s + side.filter((m) => m > T).length / side.length, 0) / 4;

// img: { data: RGBA, width, height } ya reducida (≈ 400-520 px). Devuelve las 4 esquinas en píxeles de esa imagen, o null.
// opts.debug: devuelve también todos los candidatos con su puntuación (para las pruebas).
export function detect(img, opts = {}) {
  const w = img.width, h = img.height;
  if (w < 16 || h < 16) return null;
  const g = blur5(grayOf(img.data, w * h), w, h);
  // 1) bordes de Canny, engordados para unir huecos (como dilatar dos veces con un cuadrado de 5×5)
  let found = candidates(morph(canny(g, w, h, 40, 120), w, h, 4, true), w, h, 4);
  // 2) umbral de Otsu: el papel suele ser lo más claro de la escena (cerrar y abrir con 5×5 para limpiar)
  const th = otsu(g), bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = g[i] > th ? 255 : 0;
  const closed = morph(morph(bin, w, h, 2, true), w, h, 2, false);
  found = found.concat(candidates(morph(morph(closed, w, h, 2, false), w, h, 2, true), w, h, 0));
  if (!found.length) return opts.debug ? { q: null, all: [] } : null;
  // Antes ganaba siempre el cuadro más grande: con el papel dentro de una funda, sobre una hoja más grande o junto a una mesa clara
  // se quedaba con lo de fuera. Ahora manda lo nítido que es el borde bajo los 4 lados; el tamaño solo desempata.
  const mag = sobel(g, w, h);
  for (const f of found) f.sides = sideSamples(f.q, mag, w, h);
  // qué es «nítido» depende de la foto (papel blanco sobre una mesa clara tiene bordes suaves): la mitad de lo que mide el borde típico de los candidatos
  const all = found.flatMap((f) => f.sides.flat()).sort((x, y) => x - y);
  const T = Math.min(160, Math.max(24, all[Math.floor(all.length * 0.75)] * 0.5));
  for (const f of found) { f.edge = support(f.sides, T); f.score = f.edge * Math.sqrt(f.ratio); }
  found.sort((a, b) => b.score - a.score);
  const best = found[0].edge >= 0.35 ? found[0].q : null;      // ningún lado claro: mejor no proponer nada que proponer un cuadro falso
  return opts.debug ? { q: best, all: found.map((f) => ({ ratio: +f.ratio.toFixed(3), edge: +f.edge.toFixed(2), q: f.q.map((p) => p.map(Math.round)) })) } : best;
}

// ---------------------------------------------------------------- perspectiva
// Homografía que lleva el rectángulo de salida (W×H) a las 4 esquinas p (TL, TR, BR, BL) de la imagen de entrada
function homography(p, W, H) {
  const src = [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = p[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let c = 0; c < 8; c++) {                       // Gauss con pivote
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
  }
  return B.map((b, i) => b / A[i][i]);
}
// img: { data, width, height } (la zona del papel ya a la resolución de salida); devuelve W×H con interpolación bilineal y bordes replicados
export function warp(img, p, W, H) {
  const [a, b, c, d, e, f, g, hh] = homography(p, W, H);
  const sw = img.width, sh = img.height, s = img.data, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const z = g * x + hh * y + 1;
      let u = (a * x + b * y + c) / z, v = (d * x + e * y + f) / z;
      u = u < 0 ? 0 : u > sw - 1 ? sw - 1 : u; v = v < 0 ? 0 : v > sh - 1 ? sh - 1 : v;
      const x0 = u | 0, y0 = v | 0, x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4, o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = s[i00 + k] + (s[i10 + k] - s[i00 + k]) * fx, bot = s[i01 + k] + (s[i11 + k] - s[i01 + k]) * fx;
        out[o + k] = top + (bot - top) * fy + 0.5;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}
