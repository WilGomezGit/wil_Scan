// Enderezar por la inclinación del texto (para fotos torcidas en las que no se ven los bordes del papel).
// Busca el ángulo en el que las líneas de texto quedan más "apretadas" en filas (perfil de proyección).
import { mk as canvasOf } from './canvas-ops.js';   // funciona en la página y en el Worker

// Devuelve la inclinación del texto en grados (positivo = girado a la derecha), o 0 si no hay una inclinación clara.
export function estimateSkew(source, { range = 15 } = {}) {
  const k = Math.min(1, 700 / Math.max(source.width, source.height));
  const w = Math.max(8, Math.round(source.width * k)), h = Math.max(8, Math.round(source.height * k));
  const c = canvasOf(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(source, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h), hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; gray[p] = g; hist[g]++; }
  // umbral de Otsu: lo oscuro es texto
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sB = 0, best = 0, thr = 127; const total = w * h;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; } }
  // todos los píxeles de texto (no una rejilla: una rejilla regular crea un pico falso a 0°); si son muchos, se toma uno de cada k de la lista
  const all = [];
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (gray[yy * w + xx] < thr * 0.9) all.push(xx, yy);
  const step = Math.max(1, Math.floor(all.length / 2 / 30000)), pts = [];
  for (let i = 0; i < all.length / 2; i += step) pts.push(all[2 * i], all[2 * i + 1]);
  if (pts.length < 600) return 0;                                    // casi sin texto: no se puede medir
  const n = pts.length / 2, off = w + h, bins = new Float32Array(2 * off + 4);
  const score = (deg) => {
    const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
    bins.fill(0);
    for (let i = 0; i < n; i++) bins[Math.round(pts[2 * i + 1] * co - pts[2 * i] * si) + off]++;
    let s = 0; for (let i = 0; i < bins.length; i++) s += bins[i] * bins[i];
    return s;
  };
  let bestA = 0, bestS = -1;
  for (let a = -range; a <= range + 1e-9; a += 0.5) { const s = score(a); if (s > bestS) { bestS = s; bestA = a; } }
  const centre = bestA;
  for (let a = centre - 0.5; a <= centre + 0.5 + 1e-9; a += 0.1) { const s = score(a); if (s > bestS) { bestS = s; bestA = a; } }
  const s0 = score(0);
  if (bestS < s0 * 1.04 || Math.abs(bestA) < 0.4) return 0;          // sin ganancia clara: se deja como está
  if (Math.abs(bestA) >= range - 0.5) return 0;                       // en el borde del rango: poco fiable
  return Math.round(bestA * 10) / 10;
}
