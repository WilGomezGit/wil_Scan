// Páginas: guardan la foto original y los ajustes (esquinas, filtro, giro…); la imagen final se vuelve a generar al cambiar algo.
// Así nada es destructivo: siempre se puede volver a recortar o cambiar de filtro con la foto original.
import { uid } from './db.js';
import { canvasOf } from './cv.js';
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

// Genera la imagen final y la miniatura de una página a partir de su original y sus ajustes.
export async function renderPage(page, { quality = 0.9 } = {}) {
  const src = await blobToCanvas(page.orig);
  let c = await warpQuad(src, page.quad || null);
  if (page.skew) c = rotateBy(c, -page.skew);                         // enderezado por la inclinación del texto
  c = rotateCanvas(c, page.rot || 0);
  c = enlarge(c);                                                     // las fotos pequeñas se amplían para que el texto salga nítido
  c = await applyFilter(c, { filter: page.filter || 'auto', bright: page.bright || 0, contrast: page.contrast || 0 });
  const thumb = await toBlob(scaled(c, 420), 'image/jpeg', 0.75);
  return { out: await toBlob(c, 'image/jpeg', quality), thumb, w: c.width, h: c.height };
}

// Crea una página nueva desde un lienzo (foto de la cámara o imagen importada)
export async function newPage(docId, canvas, { quad = null, filter = 'auto', quality = 0.9 } = {}) {
  const orig = await toBlob(scaled(canvas, 3400), 'image/jpeg', 0.92);
  const page = { id: uid(), docId, orig, quad, rot: 0, skew: 0, filter, bright: 0, contrast: 0, text: null, textLang: null, created: Date.now() };
  // sin bordes de papel detectados: se endereza por el texto si la foto está torcida
  if (!quad) { try { page.skew = estimateSkew(scaled(canvas, 1000)); } catch { page.skew = 0; } }
  Object.assign(page, await renderPage(page, { quality }));
  return page;
}

export async function rerender(page, quality = 0.9) {
  Object.assign(page, await renderPage(page, { quality }), { text: page.text });
  return page;
}
