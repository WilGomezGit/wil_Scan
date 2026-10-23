// Páginas: guardan la foto original y los ajustes (esquinas, filtro, giro…); la imagen final se vuelve a generar al cambiar algo.
// Así nada es destructivo: siempre se puede volver a recortar o cambiar de filtro con la foto original.
import { uid } from './db.js';
import { canvasOf, timer, cvRun, canRender, disableRender } from './cv.js';
import { warpQuad } from './warp.js';
import { scaled, enlarge, applyMarks, rotateCanvas, rotateBy } from './canvas-ops.js';
export { scaled, enlarge, applyMarks };
import { estimateSkew } from './deskew.js';
import { applyFilter } from './filters.js';
import { getSettings } from '../lib/settings.js';

// Lado mayor con el que se procesa cada página, según la calidad elegida en Ajustes (A4 a 1800 px ≈ 215 ppp, de sobra para leer e imprimir)
const SIDE = { normal: 1400, high: 1800, max: 2400 };
const workSide = () => SIDE[getSettings().quality] || SIDE.high;
// Borrador: al importar, la página se genera primero a resolución de pantalla (se abre al instante) y la completa se hace detrás
const DRAFT_SIDE = 1100;

export const toBlob = (canvas, type = 'image/jpeg', q = 0.9) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), type, q));

// Tamaño de un JPEG leyendo solo su cabecera (sin decodificarlo): permite pedir al navegador que lo decodifique ya reducido, mucho más rápido
async function jpegSize(blob) {
  const d = new DataView(await blob.slice(0, 65536).arrayBuffer());
  if (d.byteLength < 4 || d.getUint16(0) !== 0xffd8) return null;
  for (let i = 2; i + 9 < d.byteLength;) {
    if (d.getUint8(i) !== 0xff) { i++; continue; }
    const m = d.getUint8(i + 1);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [d.getUint16(i + 7), d.getUint16(i + 5)];   // [ancho, alto]
    i += 2 + d.getUint16(i + 2);
  }
  return null;
}

// maxSide: si se indica, la imagen se decodifica directamente a ese tamaño (en vez de decodificarla entera y reducirla después)
export async function blobToCanvas(blob, maxSide = 0) {
  let opts;
  if (maxSide) { try { const s = await jpegSize(blob); if (s && Math.max(s[0], s[1]) > maxSide) { const k = maxSide / Math.max(s[0], s[1]); opts = { resizeWidth: Math.round(s[0] * k), resizeHeight: Math.round(s[1] * k), resizeQuality: 'medium' }; } } catch { /* se decodifica entera */ } }
  const bmp = await createImageBitmap(blob, opts);
  const c = canvasOf(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  return c;
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
async function prepared(page, t, srcCanvas = null, side = 0) {
  const key = JSON.stringify([page.quad || null, page.skew || 0, page.rot || 0, side]), hit = pre.get(page.id);
  if (hit && hit.key === key) { t.step('recorte (en memoria)'); return hit.canvas; }
  const src = srcCanvas || await blobToCanvas(page.orig); t.step('decodificar');
  let c = await warpQuad(src, page.quad || null, { maxSide: side || workSide() }); t.step('recorte');
  if (page.skew) c = rotateBy(c, -page.skew);                         // enderezado por la inclinación del texto
  c = rotateCanvas(c, page.rot || 0);
  pre.delete(page.id); pre.set(page.id, { key, canvas: c });
  while (pre.size > 2) pre.delete(pre.keys().next().value);
  return c;
}

// Genera la imagen final y la miniatura de una página a partir de su original y sus ajustes.
// Todo el trabajo (decodificar, recortar, filtrar, codificar) se hace en el Worker; si el teléfono no lo soporta, se hace aquí como antes.
// Si el Worker falla dos veces seguidas (algo que el teléfono no soporta), se deja de usar en esta sesión y todo sigue funcionando en el hilo principal.
let workerFails = 0;
async function viaWorker(fn) {
  if (!(await canRender())) return null;
  try { const r = await fn(); workerFails = 0; return r; }
  catch { if (++workerFails >= 2) disableRender(); return null; }
}

export async function renderPage(page, opts = {}) {
  return (await viaWorker(() => renderInWorker(page, opts))) || renderPageMain(page, opts);
}

async function renderInWorker(page, { quality = 0.9, src = null, draft = false, origP = null, autoSkew = false } = {}) {
  const tm = timer(draft ? 'Página (borrador)' : 'Página'), side = draft ? DRAFT_SIDE : workSide();
  const job = { id: page.id, quad: page.quad || null, skew: page.skew || 0, rot: page.rot || 0, side, filter: page.filter || 'auto', bright: page.bright || 0, contrast: page.contrast || 0, marks: page.marks || null, draft, quality, autoSkew, px: side * side * 0.6 };
  let r;
  if (!page.orig && src) {
    // página nueva: la foto aún no está codificada, se pasa tal cual (sin copiar) y se codifica a la vez en paralelo
    const bmp = await createImageBitmap(src);
    try { r = await cvRun('render', [{ ...job, bmp }], { transfer: [bmp], affinity: page.id, retry: false }); }
    catch (e) { if (!origP) throw e; r = await cvRun('render', [{ ...job, orig: await origP }], { affinity: page.id }); }   // si el motor falló, se repite con la foto ya codificada
  } else r = await cvRun('render', [{ ...job, orig: page.orig }], { affinity: page.id });
  if (r.t) for (const [k, v] of Object.entries(r.t)) tm.step(k + ' ' + v);   // desglose dentro del motor: base (decodificar y recortar) · filtro (análisis y dibujo) · codificar
  tm.step('en el Worker'); tm.end();
  const res = { out: r.out, thumb: r.thumb, w: r.w, h: r.h, draft, rev: Date.now() + Math.random() };   // rev: versión de la imagen (para saber si un OCR hecho en segundo plano sigue valiendo)
  if (autoSkew) res.skew = r.skew || 0;
  return res;
}

// Girar 90° la imagen y la miniatura ya generadas → { out, thumb, w, h }
export async function rotateBlobs(page, quality = 0.92) {
  const w = await viaWorker(() => cvRun('rotate90', [{ out: page.out, thumb: page.thumb, quality }], { affinity: page.id }));
  if (w) return w;
  const out = rotateCanvas(await blobToCanvas(page.out), 90), thumb = rotateCanvas(await blobToCanvas(page.thumb), 90);
  return { out: await toBlob(out, 'image/jpeg', quality), thumb: await toBlob(thumb, 'image/jpeg', 0.75), w: out.width, h: out.height };
}

// Prepara una página para el OCR dentro del Worker: ≤ 1800 px y en blanco y negro (PNG). → { blob, k, pixels } o null (se hace en el hilo principal)
export async function prepareOcr(page) {
  if (!page.out || !page.w) return null;
  const job = { id: 'ocr:' + page.id, orig: page.out, quad: null, skew: 0, rot: 0, side: 1800, filter: page.filter === 'bn' ? 'original' : 'bn', draft: true, format: 'png', noThumb: true, nocache: true, px: 1800 * 1800 * 0.6 };
  const r = await viaWorker(() => cvRun('render', [job]));
  return r ? { blob: r.out, k: page.w / r.w, pixels: r.w * r.h } : null;
}

// Vistas previas (JPEG) de la página con uno o varios filtros: miniaturas del carrusel y vista inmediata al tocar un filtro.
// specs: [{ filter, bright, contrast }]; side: lado mayor (≤ 900)  →  Blob[]
export async function previewBlobs(page, specs, { side = 900, quality = 0.82 } = {}) {
  const w = await viaWorker(() => cvRun('preview', [{ id: page.id, orig: page.orig, quad: page.quad || null, rot: page.rot || 0, specs, side, quality }], { affinity: page.id }));
  if (w) return w;
  const bmp = await createImageBitmap(page.orig, { resizeWidth: 1100 });
  let c = canvasOf(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
  c = scaled(rotateCanvas(await warpQuad(c, page.quad || null, { maxSide: 900 }), page.rot || 0), side);
  const out = [];
  for (const s of specs) out.push(await toBlob(await applyFilter(c, s), 'image/jpeg', quality));
  return out;
}

async function renderPageMain(page, { quality = 0.9, src = null, draft = false, autoSkew = false } = {}) {
  const t = timer(draft ? 'Página (borrador)' : 'Página');
  if (autoSkew && src) { try { page.skew = estimateSkew(scaled(src, 1000)); } catch { page.skew = 0; } }
  const base = await prepared(page, t, src, draft ? DRAFT_SIDE : 0);
  // se filtra a la resolución real de la foto y solo después se amplía (si es pequeña): mismo resultado, varias veces menos cálculo.
  // Blanco y negro es la excepción: el umbral se calcula ya ampliado para que los trazos finos (la «l», la «t») no se pierdan.
  const bn = (page.filter || 'auto') === 'bn' && !draft;
  const f = await applyFilter(bn ? enlarge(base) : base, { filter: page.filter || 'auto', bright: page.bright || 0, contrast: page.contrast || 0 }), c = draft || bn ? f : enlarge(f); t.step('filtro');
  if (page.marks && page.marks.length) applyMarks(c, page.marks);
  const thumb = await toBlob(scaled(c, 420), 'image/jpeg', 0.75);
  const out = await toBlob(c, 'image/jpeg', quality); t.step('guardar JPG'); t.end();
  return { out, thumb, w: c.width, h: c.height, draft, rev: Date.now() + Math.random() };   // rev: versión de la imagen (para saber si un OCR hecho en segundo plano sigue valiendo)
}

// Crea una página nueva desde un lienzo (foto de la cámara o imagen importada)
export async function newPage(docId, canvas, { quad = null, filter = 'auto', quality = 0.9, deskew = true, draft = false } = {}) {
  const big = scaled(canvas, 3000);
  const origP = toBlob(big, 'image/jpeg', 0.92);                     // se codifica mientras se procesa la página (sin volver a decodificarla)
  const page = { id: uid(), docId, orig: null, quad, rot: 0, skew: 0, filter, bright: 0, contrast: 0, text: null, textLang: null, created: Date.now() };
  // sin bordes de papel detectados: se endereza por el texto si la foto está torcida (se mide dentro de la misma tarea del Worker)
  Object.assign(page, await renderPage(page, { quality: draft ? 0.85 : quality, src: big, draft, origP, autoSkew: !quad && deskew }));
  page.orig = await origP;
  return page;
}

export async function rerender(page, quality = 0.9) {
  Object.assign(page, await renderPage(page, { quality }), { text: page.text });
  return page;
}
