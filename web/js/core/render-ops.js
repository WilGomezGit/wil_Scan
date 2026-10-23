// Trabajo de página dentro del Worker: decodificar la foto, recortar, filtrar y codificar el JPG sin tocar el hilo principal.
// Así la pantalla sigue fluida mientras se procesa, y la página ya recortada queda en memoria del Worker:
// cambiar de filtro o de brillo no vuelve a decodificar ni a recortar.
import { setCanvasFactory, mk, rotateBy, rotateCanvas, scaled, enlarge, needsEnlarge, applyMarks } from './canvas-ops.js';
import { warp, filter as cvFilter, detect } from './cv-ops.js';
import { estimateSkew } from './deskew.js';

setCanvasFactory((w, h) => { const c = new OffscreenCanvas(w, h); c.getContext('2d', { willReadFrequently: true }); return c; });

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toCanvas = (img) => { const c = mk(img.width, img.height); c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0); return c; };
const imageOf = (c) => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); return { data: d.data, width: c.width, height: c.height }; };
const jpeg = (c, quality) => c.convertToBlob({ type: 'image/jpeg', quality });
const plain = (f, bright, contrast) => f === 'original' && !bright && !contrast;     // nada que calcular

// ¿Este Worker sabe hacerlo todo (OffscreenCanvas, decodificar y codificar JPG)? Se prueba de verdad una vez.
export async function selfTest() {
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return false;
    const c = new OffscreenCanvas(8, 8), x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, 8, 8);
    const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }), bmp = await createImageBitmap(b);
    const ok = bmp.width === 8 && b.size > 0; if (bmp.close) bmp.close();
    return ok;
  } catch { return false; }
}

// Páginas recortadas en memoria (las 3 últimas): clave → { data, width, height }
const cache = new Map();
const remember = (key, img) => { cache.delete(key); cache.set(key, img); while (cache.size > 3) cache.delete(cache.keys().next().value); return img; };

// Recorte de perspectiva (como warpQuad) sobre un ImageBitmap. Devuelve { img } (píxeles) o { canvas } (sin esquinas: solo se reduce).
function warpBase(cv, bmp, quad, side) {
  const sw = bmp.width, sh = bmp.height;
  if (!quad) {
    const k = Math.min(1, side / Math.max(sw, sh)), c = mk(sw * k, sh * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return { canvas: c };
  }
  const p = quad.map(([x, y]) => [x * sw, y * sh]);
  let W = Math.max(dist(p[0], p[1]), dist(p[3], p[2])), H = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
  const k = Math.min(1, side / Math.max(W, H));
  W = Math.max(8, Math.round(W * k)); H = Math.max(8, Math.round(H * k));
  const x0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[0]))) - 2), y0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[1]))) - 2);
  const x1 = Math.min(sw, Math.ceil(Math.max(...p.map((q) => q[0]))) + 2), y1 = Math.min(sh, Math.ceil(Math.max(...p.map((q) => q[1]))) + 2);
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const crop = mk(bw * k, bh * k), x = crop.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, x0, y0, bw, bh, 0, 0, crop.width, crop.height);
  const local = p.map(([px, py]) => [(px - x0) * crop.width / bw, (py - y0) * crop.height / bh]);
  return { img: warp(cv, imageOf(crop), local, W, H) };
}

const decode = (job, resizeWidth) => (job.bmp ? Promise.resolve(job.bmp) : createImageBitmap(job.orig, resizeWidth ? { resizeWidth, resizeQuality: 'medium' } : undefined));

// La página recortada, enderezada y girada, antes de filtrar
async function baseOf(cv, job) {
  const key = [job.id, JSON.stringify(job.quad || null), job.skew || 0, job.rot || 0, job.side].join('|');
  const hit = cache.get(key);
  if (hit) return remember(key, hit);
  const own = !job.bmp, bmp = await decode(job, job.resizeWidth);
  try {
    const w = warpBase(cv, bmp, job.quad || null, job.side);
    let img = w.img || null, canvas = w.canvas || null;
    if (job.skew || job.rot) {
      canvas = canvas || toCanvas(img);
      if (job.skew) canvas = rotateBy(canvas, -job.skew);                // enderezado por la inclinación del texto
      canvas = rotateCanvas(canvas, job.rot || 0);
      img = null;
    }
    return remember(key, img || imageOf(canvas));
  } finally { if (own && bmp.close) bmp.close(); }
}

// Imagen final y miniatura de una página. job: { id, orig | bmp, quad, skew, rot, side, filter, bright, contrast, marks, draft, quality }
export async function render(cv, job) {
  // página nueva sin esquinas: se mide la inclinación del texto aquí mismo (así tampoco ocupa el hilo principal)
  let bmp = job.bmp || null;
  try {
    if (job.autoSkew) {
      bmp = bmp || await decode(job);
      let skew = 0; try { skew = estimateSkew(scaled(bmp, 1000)); } catch { /* sin medida */ }
      job = { ...job, bmp, skew };
    }
    return await renderFrom(cv, job);
  } finally { if (bmp && bmp.close) bmp.close(); }
}

async function renderFrom(cv, job) {
  const base = await baseOf(cv, job), f = job.filter || 'auto', bright = job.bright || 0, contrast = job.contrast || 0;
  // se filtra a la resolución real y solo después se amplía (si es pequeña). Blanco y negro es la excepción: el umbral se calcula ya ampliado.
  const bn = f === 'bn' && !job.draft;
  let src = base;
  if (bn && needsEnlarge(base.width, base.height)) src = imageOf(enlarge(toCanvas(base)));
  let c = toCanvas(plain(f, bright, contrast) ? src : cvFilter(cv, src, { filter: f, bright, contrast }));
  if (!job.draft && !bn) c = enlarge(c);
  if (job.marks && job.marks.length) applyMarks(c, job.marks);
  const thumb = await jpeg(scaled(c, 420), 0.75), out = await jpeg(c, job.quality || 0.9);
  return { out, thumb, w: c.width, h: c.height, skew: job.skew || 0 };
}

// Girar 90° la imagen ya generada y su miniatura
export async function rotate90(cv, job) {
  const one = async (blob, q) => {
    const bmp = await createImageBitmap(blob), c = mk(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
    const r = rotateCanvas(c, 90);
    return { blob: await jpeg(r, q), w: r.width, h: r.height };
  };
  const o = await one(job.out, job.quality || 0.92), t = await one(job.thumb, 0.75);
  return { out: o.blob, thumb: t.blob, w: o.w, h: o.h };
}

// Vistas previas de una página con uno o varios filtros (miniaturas del carrusel y vista inmediata al tocar un filtro).
// job: { id, orig, quad, rot, specs: [{ filter, bright, contrast }], side, quality }  →  Blob[] (JPEG)
export async function preview(cv, job) {
  const big = await baseOf(cv, { id: job.id + ':v', orig: job.orig, quad: job.quad, skew: 0, rot: job.rot, side: 900, resizeWidth: 1100 });
  let src = big;
  if (job.side < Math.max(big.width, big.height)) {
    const key = [job.id, 'v', JSON.stringify(job.quad || null), job.rot || 0, job.side].join('|');
    src = cache.get(key) || remember(key, imageOf(scaled(toCanvas(big), job.side)));
  }
  const out = [];
  for (const s of job.specs) out.push(await jpeg(toCanvas(plain(s.filter, s.bright, s.contrast) ? src : cvFilter(cv, src, s)), job.quality || 0.82));
  return out;
}

// Bordes del papel a partir de una imagen reducida (fotograma del video o foto) que llega como ImageBitmap: la lectura de píxeles se hace aquí, no en el hilo principal
export function detectBmp(cv, job) {
  const c = mk(job.w, job.h);
  c.getContext('2d').drawImage(job.bmp, 0, 0, job.w, job.h);
  if (job.bmp.close) job.bmp.close();
  return detect(cv, imageOf(c));
}
