// Páginas: guardan la foto original y los ajustes (esquinas, filtro, giro…); la imagen final se vuelve a generar al cambiar algo.
// Así nada es destructivo: siempre se puede volver a recortar o cambiar de filtro con la foto original.
import { uid } from './db.js';
import { canvasOf, timer } from './cv.js';
import { warpQuad, rotateCanvas, rotateBy } from './warp.js';
import { estimateSkew } from './deskew.js';
import { applyFilter } from './filters.js';

export const toBlob = (canvas, type = 'image/jpeg', q = 0.9) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), type, q));

export async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = canvasOf(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  return c;
}

export function scaled(canvas, maxSide) {
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  if (k === 1) return canvas;
  const c = canvasOf(canvas.width * k, canvas.height * k);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

// Amplía (con suavizado de calidad) las imágenes de poca resolución hasta ~1800 px: mejora lectura, OCR y PDF
function enlarge(c) {
  const m = Math.max(c.width, c.height);
  if (m >= 1500) return c;
  const k = Math.min(2.5, 1800 / m), o = canvasOf(c.width * k, c.height * k), x = o.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, o.width, o.height);
  return o;
}

// Mide la inclinación del texto de una página recortada (sin giro ni ampliación) para poder enderezarla
export async function measureSkew(page) {
  const src = await blobToCanvas(page.orig);
  const c = await warpQuad(src, page.quad || null, { maxSide: 1000 });
  return estimateSkew(c);
}

// La página ya recortada, enderezada y girada (antes del filtro) se guarda en memoria: cambiar de filtro o de brillo no repite la decodificación ni el recorte.
const pre = new Map();
export const dropPre = (id) => pre.delete(id);
async function prepared(page, t, srcCanvas = null) {
  const key = JSON.stringify([page.quad || null, page.skew || 0, page.rot || 0]), hit = pre.get(page.id);
  if (hit && hit.key === key) { t.step('recorte (en memoria)'); return hit.canvas; }
  const src = srcCanvas || await blobToCanvas(page.orig); t.step('decodificar');
  let c = await warpQuad(src, page.quad || null); t.step('recorte');
  if (page.skew) c = rotateBy(c, -page.skew);                         // enderezado por la inclinación del texto
  c = rotateCanvas(c, page.rot || 0);
  c = enlarge(c);                                                     // las fotos pequeñas se amplían para que el texto salga nítido
  pre.delete(page.id); pre.set(page.id, { key, canvas: c });
  while (pre.size > 2) pre.delete(pre.keys().next().value);
  return c;
}

// Genera la imagen final y la miniatura de una página a partir de su original y sus ajustes.
export async function renderPage(page, { quality = 0.9, src = null } = {}) {
  const t = timer('Página');
  const base = await prepared(page, t, src);
  const c = await applyFilter(base, { filter: page.filter || 'auto', bright: page.bright || 0, contrast: page.contrast || 0 }); t.step('filtro');
  const thumb = await toBlob(scaled(c, 420), 'image/jpeg', 0.75);
  const out = await toBlob(c, 'image/jpeg', quality); t.step('guardar JPG'); t.end();
  return { out, thumb, w: c.width, h: c.height, rev: Date.now() + Math.random() };   // rev: versión de la imagen (para saber si un OCR hecho en segundo plano sigue valiendo)
}

// Crea una página nueva desde un lienzo (foto de la cámara o imagen importada)
export async function newPage(docId, canvas, { quad = null, filter = 'auto', quality = 0.9, deskew = true } = {}) {
  const big = scaled(canvas, 3000);
  const origP = toBlob(big, 'image/jpeg', 0.92);                     // se codifica mientras se procesa la página (sin volver a decodificarla)
  const page = { id: uid(), docId, orig: null, quad, rot: 0, skew: 0, filter, bright: 0, contrast: 0, text: null, textLang: null, created: Date.now() };
  // sin bordes de papel detectados: se endereza por el texto si la foto está torcida
  if (!quad && deskew) { try { page.skew = estimateSkew(scaled(canvas, 1000)); } catch { page.skew = 0; } }
  Object.assign(page, await renderPage(page, { quality, src: big }));
  page.orig = await origP;
  return page;
}

export async function rerender(page, quality = 0.9) {
  Object.assign(page, await renderPage(page, { quality }), { text: page.text });
  return page;
}
