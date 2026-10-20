// Herramientas de PDF que funcionan en el propio dispositivo (nada se sube): unir, dividir, extraer, borrar, girar, ordenar,
// marca de agua, numerar, firmar, comprimir, PDF a imágenes y PDF a texto.
import { loadPdfLib, buildPdf } from './pdf-export.js';
import { canvasOf } from './cv.js';
import { toBlob } from './pages.js';

let pdfjsP = null;
export function loadPdfJs() {
  if (!pdfjsP) {
    pdfjsP = import(new URL('../../vendor/pdfjs/pdf.min.js', import.meta.url).href).then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
      return m;
    }).catch((e) => { pdfjsP = null; throw e; });
  }
  return pdfjsP;
}

const bytesOf = async (src) => (src instanceof Uint8Array ? src : new Uint8Array(await src.arrayBuffer()));
export async function loadDoc(src) {
  const { PDFDocument } = await loadPdfLib();
  try { return await PDFDocument.load(await bytesOf(src), { ignoreEncryption: false }); }
  catch (e) {
    if (/encrypt/i.test(String(e && e.message))) throw new Error('Este PDF está protegido con contraseña. Quítale la protección antes de usarlo aquí.');
    throw new Error('No se pudo leer el PDF (¿está dañado?).');
  }
}

// "1-3, 5, 8-" → [0,1,2,4,7,…] (índices base 0, sin repetir, dentro del rango). "" o "todas" → todas.
export function parseRanges(text, n) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || t === 'todas' || t === 'todo') return Array.from({ length: n }, (_, i) => i);
  const out = [];
  for (const part of t.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)-(\d*)$/.exec(part);
    if (m) { const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n; if (a < 1 || b > n || a > b) throw new Error(`Rango no válido: ${part} (el PDF tiene ${n} páginas).`); for (let i = a; i <= b; i++) out.push(i - 1); }
    else if (/^\d+$/.test(part)) { const v = +part; if (v < 1 || v > n) throw new Error(`La página ${v} no existe (el PDF tiene ${n}).`); out.push(v - 1); }
    else throw new Error(`No entiendo "${part}". Usa por ejemplo 1-3, 5, 8-`);
  }
  return [...new Set(out)];
}

export async function pageCount(src) { return (await loadDoc(src)).getPageCount(); }

export async function mergePdfs(files) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (const f of files) {
    const d = await loadDoc(f);
    (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p));
  }
  out.setProducer('WilScan'); out.setCreator('WilScan · WG');
  return out.save();
}

export async function extractPages(src, rangeText) {
  const { PDFDocument } = await loadPdfLib();
  const d = await loadDoc(src), idx = parseRanges(rangeText, d.getPageCount());
  if (!idx.length) throw new Error('No hay páginas que extraer.');
  const out = await PDFDocument.create();
  (await out.copyPages(d, idx)).forEach((p) => out.addPage(p));
  return out.save();
}

export async function deletePages(src, rangeText) {
  const d = await loadDoc(src), n = d.getPageCount(), idx = parseRanges(rangeText, n);
  if (!idx.length) throw new Error('Indica qué páginas borrar.');
  if (idx.length >= n) throw new Error('No se pueden borrar todas las páginas.');
  [...idx].sort((a, b) => b - a).forEach((i) => d.removePage(i));
  return d.save();
}

// Un PDF por cada rango separado por «;» (p. ej. "1-3; 4-6") o uno por página si se pide
export async function splitPdf(src, { mode = 'ranges', rangeText = '', every = 1 } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const d = await loadDoc(src), n = d.getPageCount();
  const groups = [];
  if (mode === 'each') for (let i = 0; i < n; i += every) groups.push(Array.from({ length: Math.min(every, n - i) }, (_, k) => i + k));
  else for (const part of String(rangeText).split(';').map((s) => s.trim()).filter(Boolean)) groups.push(parseRanges(part, n));
  if (!groups.length) throw new Error('Indica cómo dividir el PDF.');
  const files = [];
  for (const g of groups) {
    const o = await PDFDocument.create();
    (await o.copyPages(d, g)).forEach((p) => o.addPage(p));
    files.push({ name: g.length === 1 ? `pagina-${g[0] + 1}` : `paginas-${g[0] + 1}-a-${g[g.length - 1] + 1}`, bytes: await o.save() });
  }
  return files;
}

export async function rotatePdf(src, degrees, rangeText = '') {
  const { degrees: deg } = await loadPdfLib();
  const d = await loadDoc(src), idx = parseRanges(rangeText, d.getPageCount());
  for (const i of idx) { const p = d.getPage(i); p.setRotation(deg(((p.getRotation().angle + degrees) % 360 + 360) % 360)); }
  return d.save();
}

export async function reorderPdf(src, order) {
  const { PDFDocument } = await loadPdfLib();
  const d = await loadDoc(src), n = d.getPageCount();
  if (order.length !== n || new Set(order).size !== n || order.some((i) => i < 0 || i >= n)) throw new Error('El orden no es válido.');
  const out = await PDFDocument.create();
  (await out.copyPages(d, order)).forEach((p) => out.addPage(p));
  return out.save();
}

const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const v = m ? parseInt(m[1], 16) : 0x808080; return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };

export async function watermarkPdf(src, { text = 'CONFIDENCIAL', opacity = 0.25, size = 64, angle = 45, color = '#808080', rangeText = '' } = {}) {
  const { StandardFonts, rgb, degrees } = await loadPdfLib();
  const d = await loadDoc(src), font = await d.embedFont(StandardFonts.HelveticaBold);
  let t = String(text || '').trim(); if (!t) throw new Error('Escribe el texto de la marca de agua.');
  try { font.encodeText(t); } catch { t = t.replace(/[^\x20-\xff]/g, ''); if (!t) throw new Error('Ese texto tiene caracteres que el PDF no admite.'); }
  const [r, g, b] = hex(color);
  for (const i of parseRanges(rangeText, d.getPageCount())) {
    const p = d.getPage(i), { width: W, height: H } = p.getSize(), tw = font.widthOfTextAtSize(t, size);
    const a = (angle * Math.PI) / 180;
    p.drawText(t, { x: W / 2 - (tw / 2) * Math.cos(a), y: H / 2 - (tw / 2) * Math.sin(a) - size * 0.3, size, font, color: rgb(r, g, b), opacity, rotate: degrees(angle) });
  }
  return d.save();
}

export async function numberPdf(src, { position = 'bottom-center', start = 1, prefix = '' } = {}) {
  const { StandardFonts, rgb } = await loadPdfLib();
  const d = await loadDoc(src), font = await d.embedFont(StandardFonts.Helvetica);
  d.getPages().forEach((p, i) => {
    const { width: W, height: H } = p.getSize(), t = `${prefix}${start + i}`, tw = font.widthOfTextAtSize(t, 10);
    const x = position.endsWith('left') ? 28 : position.endsWith('right') ? W - 28 - tw : (W - tw) / 2, y = position.startsWith('top') ? H - 24 : 20;
    p.drawText(t, { x, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
  });
  return d.save();
}

// Estampa una firma (PNG con transparencia) en una página. x,y,w en fracciones de la página (origen arriba-izquierda).
export async function signPdf(src, { pageIndex = 0, png, x = 0.55, y = 0.85, w = 0.3 } = {}) {
  const d = await loadDoc(src);
  const p = d.getPage(pageIndex), { width: W, height: H } = p.getSize();
  const img = await d.embedPng(await (await fetch(png)).arrayBuffer());
  const dw = W * w, dh = dw * (img.height / img.width);
  p.drawImage(img, { x: W * x, y: H - H * y - dh, width: dw, height: dh });
  return d.save();
}

// ---- lectura con pdf.js ----
export async function openForRender(src) { const pdfjs = await loadPdfJs(); return pdfjs.getDocument({ data: (await bytesOf(src)).slice() }).promise; }

export async function renderPdfPage(doc, index, scale = 1.5) {
  const page = await doc.getPage(index + 1), vp = page.getViewport({ scale });
  const c = canvasOf(vp.width, vp.height), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: vp }).promise;
  return c;
}

export async function pdfToImages(src, { scale = 2, type = 'image/jpeg', quality = 0.9, rangeText = '', onProgress } = {}) {
  const doc = await openForRender(src), idx = parseRanges(rangeText, doc.numPages), out = [];
  for (let k = 0; k < idx.length; k++) {
    const c = await renderPdfPage(doc, idx[k], scale);
    out.push({ name: `pagina-${idx[k] + 1}.${type === 'image/png' ? 'png' : 'jpg'}`, blob: await toBlob(c, type, quality), w: c.width, h: c.height });
    if (onProgress) onProgress((k + 1) / idx.length);
  }
  return out;
}

export async function pdfToText(src) {
  const doc = await openForRender(src), parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    let line = '', y = null;
    for (const it of tc.items) { if (y !== null && Math.abs(it.transform[5] - y) > 2) { parts.push(line); line = ''; } line += it.str + (it.hasEOL ? '\n' : ''); y = it.transform[5]; }
    parts.push(line, '');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Vuelve a crear el PDF con las páginas como imágenes JPEG de menor calidad: pesa mucho menos (pierde el texto seleccionable)
export async function compressPdf(src, { quality = 0.6, scale = 1.3, onProgress } = {}) {
  const doc = await openForRender(src), pages = [];
  for (let i = 0; i < doc.numPages; i++) {
    const c = await renderPdfPage(doc, i, scale);
    pages.push({ blob: await toBlob(c, 'image/jpeg', quality), w: c.width, h: c.height });
    if (onProgress) onProgress((i + 1) / doc.numPages);
  }
  return buildPdf(pages, { size: 'fit', title: 'Documento comprimido' });
}
