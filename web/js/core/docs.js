// Operaciones de alto nivel sobre documentos (crear, páginas, OCR, PDF, unir, importar PDF).
import { uid, saveDoc, getDoc, deleteDoc, savePage, getPages, deletePage } from './db.js';
import { newPage, rerender, toBlob, blobToCanvas } from './pages.js';
import { recognize } from './ocr.js';
import { buildPdf } from './pdf-export.js';
import { openForRender, renderPdfPage } from './pdf-tools.js';
import { canvasOf } from './cv.js';
import { getSettings, QUALITY } from '../lib/settings.js';

const quality = () => QUALITY[getSettings().quality] || 0.9;

export async function newDoc(title, items, { onProgress } = {}) {
  const id = uid(), pages = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const p = await newPage(id, it.canvas, { quad: it.quad || null, filter: it.filter || getSettings().filter, quality: quality() });
    await savePage(p); pages.push(p);
    if (onProgress) onProgress((i + 1) / items.length);
  }
  const doc = { id, title, created: Date.now(), pageIds: pages.map((p) => p.id), pageCount: pages.length, cover: pages[0] ? pages[0].thumb : null };
  await saveDoc(doc);
  return { doc, pages };
}

export const docPages = (doc) => getPages(doc.pageIds).then((ps) => doc.pageIds.map((id) => ps.find((p) => p.id === id)).filter(Boolean));

export async function persistDoc(doc, pages) {
  doc.pageIds = pages.map((p) => p.id); doc.pageCount = pages.length; doc.cover = pages[0] ? pages[0].thumb : null;
  await saveDoc(doc);
}

export async function appendPages(doc, items) {
  const pages = await docPages(doc);
  for (const it of items) { const p = await newPage(doc.id, it.canvas, { quad: it.quad || null, filter: it.filter || getSettings().filter, quality: quality() }); await savePage(p); pages.push(p); }
  await persistDoc(doc, pages);
  return pages;
}

export async function removePage(doc, pageId) {
  const pages = (await docPages(doc)).filter((p) => p.id !== pageId);
  await deletePage(pageId);
  if (!pages.length) { await deleteDoc(doc.id); return null; }
  await persistDoc(doc, pages);
  return pages;
}

export async function updatePage(page, patch) {
  Object.assign(page, patch);
  await rerender(page, quality());
  page.text = null; page.textLang = null; page.words = null;   // cambió la imagen: el texto reconocido ya no vale
  await savePage(page);
  return page;
}

export async function updateAllPages(doc, patch) {
  const pages = await docPages(doc);
  for (const p of pages) await updatePage(p, patch);
  await persistDoc(doc, pages);
  return pages;
}

export async function reorderPages(doc, order) {
  const pages = await docPages(doc);
  const next = order.map((id) => pages.find((p) => p.id === id)).filter(Boolean);
  await persistDoc(doc, next);
  return next;
}

export async function ocrPage(page, { lang = getSettings().ocrLang, onProgress } = {}) {
  if (page.text != null && page.textLang === lang) return page.text;
  const canvas = await blobToCanvas(page.out);
  const r = await recognize(canvas, { lang, onProgress });
  page.text = r.text; page.textLang = lang; page.words = r.words; page.w = canvas.width; page.h = canvas.height;
  await savePage(page);
  return page.text;
}

// PDF del documento. Con { searchable } hace OCR de las páginas que aún no tienen palabras para añadir texto invisible.
export async function docPdf(doc, pages, { size = getSettings().pdfSize, margin = getSettings().pdfMargin, searchable = false, lang = getSettings().ocrLang, onProgress } = {}) {
  const items = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (searchable && !p.words) { await ocrPage(p, { lang, onProgress: (f) => onProgress && onProgress((i + f) / pages.length * 0.8, `Reconociendo texto · página ${i + 1} de ${pages.length}`) }); }
    items.push({ blob: p.out, w: p.w, h: p.h, words: searchable ? p.words : null });
    if (onProgress) onProgress(Math.min(0.85, (i + 1) / pages.length * 0.85), `Preparando página ${i + 1} de ${pages.length}`);
  }
  if (onProgress) onProgress(0.9, 'Creando el PDF…');
  const bytes = await buildPdf(items, { size, margin: margin ? 18 : 0, title: doc.title });
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function mergeDocs(ids, title) {
  const docs = (await Promise.all(ids.map(getDoc))).filter(Boolean);
  const id = uid(), pageIds = [], pagesOut = [];
  for (const d of docs) for (const p of await docPages(d)) {
    const copy = { ...p, id: uid(), docId: id };
    await savePage(copy); pagesOut.push(copy);
  }
  const doc = { id, title, created: Date.now(), pageIds: pagesOut.map((p) => p.id), pageCount: pagesOut.length, cover: pagesOut[0] ? pagesOut[0].thumb : null };
  await saveDoc(doc);
  return doc;
}

// Importa un PDF como documento editable (cada página pasa a ser una imagen)
export async function importPdf(file, { onProgress } = {}) {
  const pdf = await openForRender(file), items = [];
  for (let i = 0; i < pdf.numPages; i++) {
    items.push({ canvas: await renderPdfPage(pdf, i, 2), quad: null, filter: 'original' });
    if (onProgress) onProgress((i + 1) / pdf.numPages * 0.8);
  }
  const title = (file.name || 'PDF importado').replace(/\.pdf$/i, '');
  const r = await newDoc(title, items, { onProgress: (f) => onProgress && onProgress(0.8 + f * 0.2) });
  return r.doc;
}

// Documento de identidad: anverso y reverso en una sola hoja
export function composeIdSheet(front, back) {
  const W = 1654, H = 2339, pad = 150, gap = 90, cw = W - pad * 2;
  const sheet = canvasOf(W, H), x = sheet.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const fit = (img, y0, boxH) => { const k = Math.min(cw / img.width, boxH / img.height), w = img.width * k, hh = img.height * k; x.drawImage(img, (W - w) / 2, y0 + (boxH - hh) / 2, w, hh); x.strokeStyle = '#d0d0d0'; x.lineWidth = 3; x.strokeRect((W - w) / 2, y0 + (boxH - hh) / 2, w, hh); };
  const boxH = (H - pad * 2 - gap) / 2;
  fit(front, pad, boxH); fit(back, pad + boxH + gap, boxH);
  return sheet;
}

export { toBlob };
