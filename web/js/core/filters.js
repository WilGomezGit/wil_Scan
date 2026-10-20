// Filtros de documento con OpenCV: quitar sombras, mejorar, grises, blanco y negro y color vivo, más brillo y contraste.
import { loadCV, free, canvasOf } from './cv.js';

export const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'auto', label: 'Mejorado' },
  { id: 'sombras', label: 'Sin sombras' },
  { id: 'color', label: 'Color vivo' },
  { id: 'gris', label: 'Grises' },
  { id: 'bn', label: 'Blanco y negro' },
];

const odd = (n) => { n = Math.max(3, Math.round(n)); return n % 2 ? n : n + 1; };

// Divide cada píxel por el fondo estimado (papel sin texto): elimina sombras y degradados de luz. Devuelve RGB.
function flatten(cv, rgb) {
  const w = rgb.cols, h = rgb.rows, k = Math.max(1, Math.round(Math.max(w, h) / 600));
  const small = new cv.Mat(), dil = new cv.Mat(), med = new cv.Mat(), bg = new cv.Mat(), out = new cv.Mat();
  const ker = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  try {
    cv.resize(rgb, small, new cv.Size(Math.round(w / k), Math.round(h / k)), 0, 0, cv.INTER_AREA);
    cv.dilate(small, dil, ker);                         // el máximo local borra el texto oscuro
    cv.medianBlur(dil, med, 21);
    cv.GaussianBlur(med, med, new cv.Size(0, 0), 6);
    cv.resize(med, bg, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
    cv.divide(rgb, bg, out, 255, -1);
    return out;
  } finally { free(small, dil, med, bg, ker); }
}

function sharpen(cv, m, amount = 0.6) {
  const blur = new cv.Mat(), dst = new cv.Mat();
  try { cv.GaussianBlur(m, blur, new cv.Size(0, 0), 2); cv.addWeighted(m, 1 + amount, blur, -amount, 0, dst); return dst; } finally { free(blur); }
}

function saturate(canvas, k) {
  const x = canvas.getContext('2d', { willReadFrequently: true });
  const img = x.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = Math.max(0, Math.min(255, g + (d[i] - g) * k)); d[i + 1] = Math.max(0, Math.min(255, g + (d[i + 1] - g) * k)); d[i + 2] = Math.max(0, Math.min(255, g + (d[i + 2] - g) * k));
  }
  x.putImageData(img, 0, 0);
}

// opts: { filter, bright (-50..50), contrast (-50..50) }  →  lienzo nuevo
export async function applyFilter(src, { filter = 'auto', bright = 0, contrast = 0 } = {}) {
  const cv = await loadCV();
  const out = canvasOf(src.width, src.height);
  const mat = cv.imread(src), rgb = new cv.Mat();
  let cur = null;
  try {
    cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
    if (filter === 'original') cur = rgb.clone();
    else {
      const flat = flatten(cv, rgb);
      if (filter === 'sombras') cur = flat;
      else if (filter === 'auto' || filter === 'color') { cur = sharpen(cv, flat, 0.7); free(flat); }
      else {
        const gray = new cv.Mat();
        cv.cvtColor(flat, gray, cv.COLOR_RGB2GRAY); free(flat);
        if (filter === 'gris') { cur = new cv.Mat(); cv.cvtColor(gray, cur, cv.COLOR_GRAY2RGB); free(gray); }
        else {   // bn
          const bw = new cv.Mat();
          cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
          cv.adaptiveThreshold(gray, bw, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, odd(Math.min(gray.cols, gray.rows) / 22), 24);
          cur = new cv.Mat(); cv.cvtColor(bw, cur, cv.COLOR_GRAY2RGB); free(gray, bw);
        }
      }
    }
    if (bright || contrast) { const adj = new cv.Mat(); cur.convertTo(adj, -1, 1 + contrast / 50, bright * 1.6); free(cur); cur = adj; }
    cv.imshow(out, cur);
  } finally { free(mat, rgb, cur); }
  if (filter === 'color') saturate(out, 1.4);
  return out;
}
