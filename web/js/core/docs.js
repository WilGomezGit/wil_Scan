// Operaciones de alto nivel sobre documentos (crear, páginas, OCR, PDF, unir, importar PDF).
import { uid, saveDoc, getDoc, deleteDoc, savePage, getPage, getPages, deletePage, patchDoc, patchPage } from './db.js';
import { newPage, rerender, toBlob, blobToCanvas, dropPre } from './pages.js';
import { rotateCanvas } from './warp.js';
import { timer, cvIdleFor, cvLanes } from './cv.js';
import { limiter, mapLimit } from './pool.js';
import { recognize } from './ocr.js';
import { buildPdf } from './pdf-export.js';
import { openForRender, renderPdfPage } from './pdf-tools.js';
import { canvasOf } from './cv.js';
import { getSettings, QUALITY } from '../lib/settings.js';

const quality = () => QUALITY[getSettings().quality] || 0.9;
const pageOpts = (it) => ({ quad: it.quad || null, filter: it.filter || getSettings().filter, quality: quality(), deskew: it.deskew !== false, draft: !!it.draft });

// ---- Páginas en borrador ----
// Las fotos importadas se abren con una versión a resolución de pantalla; la imagen completa se genera enseguida en segundo plano.
// Exportar, leer el texto o unir documentos esperan a que esté lista (ensureFull). Al terminar se avisa con el evento «wilscan:page».
const draftLane = limiter(cvLanes);          // varias páginas a la vez si el teléfono tiene núcleos de sobra
const drafting = new Map();
async function finishDraft(id) {
  for (let i = 0; i < 4; i++) {
    const p = await getPage(id);
    if (!p || !p.draft) return p;
    const rev = p.rev, full = await rerender({ ...p }, quality());
    // se guarda solo si la página no cambió mientras tanto (giro, filtro…); si cambió, se rehace con los ajustes nuevos
    const cur = await patchPage(id, (c) => { if (c.rev !== rev) return false; Object.assign(c, { out: full.out, thumb: full.thumb, w: full.w, h: full.h, rev: full.rev, draft: false }); return true; });
    if (!cur) { if (!(await getPage(id))) return null; continue; }
    if (cur.docId) await patchDoc(cur.docId, (d) => { if (d.pageIds[0] !== id) return false; d.cover = cur.thumb; return true; });
    window.dispatchEvent(new CustomEvent('wilscan:page', { detail: { id } }));
    ocrLater([cur]);
    return cur;
  }
  return getPage(id);
}
export function finishLater(pages) {
  for (const p of pages) {
    if (!p || !p.draft || drafting.has(p.id)) continue;
    const job = draftLane(() => finishDraft(p.id)).catch(() => null).finally(() => drafting.delete(p.id));
    drafting.set(p.id, job);
  }
}
export async function ensureFull(page) {
  if (!page || !page.draft) return page;
  const done = await (drafting.get(page.id) || finishDraft(page.id));
  if (done && !done.draft) Object.assign(page, { out: done.out, thumb: done.thumb, w: done.w, h: done.h, rev: done.rev, draft: false });
  return page;
}

// ---- OCR en segundo plano ----
// Con «PDF buscable» activado, el texto de las páginas se reconoce sin esperar a que se pida: así exportar es casi inmediato.
// Va de una página en una, cede el paso a cualquier OCR que pida el usuario y espera a que el motor de imagen esté libre.
const bgQueue = []; let bgRunning = false, fg = 0, bgCurrent = null, bgJob = null;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export function ocrLater(pages) {
  if (!getSettings().searchablePdf) return;
  for (const p of pages) if (p && !bgQueue.includes(p.id)) bgQueue.push(p.id);
  if (!bgRunning) setTimeout(pumpOcr, 2500);
}
async function pumpOcr() {
  if (bgRunning) return; bgRunning = true;
  try {
    while (bgQueue.length) {
      while (fg || !cvIdleFor(2000) || document.visibilityState !== 'visible') await pause(700);
      if (!bgQueue.length) break;                                   // el usuario pudo pedir esas páginas mientras se esperaba
      const id = bgQueue.shift(), lang = getSettings().ocrLang;
      let p = null; try { p = id ? await getPage(id) : null; } catch { p = null; }
      if (!p || p.draft || (p.words && p.textLang === lang)) continue;   // los borradores se reconocen cuando tengan la imagen completa
      bgCurrent = id;
      bgJob = (async () => {
        const rev = p.rev, canvas = await blobToCanvas(p.out);
        const r = await recognize(canvas, { lang });
        const cur = await getPage(id);
        if (!cur || cur.rev !== rev) return;                          // la página cambió mientras tanto: ese texto ya no vale
        Object.assign(cur, { text: r.text, textLang: lang, words: r.words, w: canvas.width, h: canvas.height });
        await savePage(cur);
      })();
      try { await bgJob; } catch { /* se reintentará cuando se pida */ }
      bgCurrent = null;
    }
  } finally { bgRunning = false; }
}

// Procesa una foto (recorte, filtro, miniatura) a partir de { canvas, quad, filter }. Lo usa el escáner para ir trabajando mientras se sigue fotografiando.
export const startPage = (it) => newPage('pendiente', it.canvas, pageOpts(it));

// Cambia el recorte de una foto ya procesada y la vuelve a generar
export async function recropPage(page, quad) {
  page.quad = quad; if (quad) page.skew = 0;
  return rerender(page, quality());
}

// Página lista de un elemento del escáner: la que ya se procesó en segundo plano, o se procesa ahora
async function pageFor(docId, it) {
  let p = null;
  if (it.page) { try { p = await it.page; } catch { p = null; } }
  if (!p) { const src = it.make ? await it.make() : it; p = await newPage(docId, src.canvas, pageOpts(src)); }   // make(): la foto se decodifica justo antes de procesarla y se libera enseguida
  p.docId = docId;
  return p;
}

export async function newDoc(title, items, { onProgress } = {}) {
  const id = uid();
  let done = 0;
  const pages = await mapLimit(items, cvLanes(), async (it) => { const p = await pageFor(id, it); await savePage(p); if (onProgress) onProgress(++done / items.length); return p; });
  const doc = { id, title, created: Date.now(), pageIds: pages.map((p) => p.id), pageCount: pages.length, cover: pages[0] ? pages[0].thumb : null };
  await saveDoc(doc);
  ocrLater(pages.filter((p) => !p.draft)); finishLater(pages);
  return { doc, pages };
}

export const docPages = (doc) => getPages(doc.pageIds).then((ps) => doc.pageIds.map((id) => ps.find((p) => p.id === id)).filter(Boolean));

export async function persistDoc(doc, pages) {
  doc.pageIds = pages.map((p) => p.id); doc.pageCount = pages.length; doc.cover = pages[0] ? pages[0].thumb : null;
  await saveDoc(doc);
}

export async function appendPages(doc, items) {
  const pages = await docPages(doc);
  const added = await mapLimit(items, cvLanes(), async (it) => { const p = await pageFor(doc.id, it); await savePage(p); return p; });
  pages.push(...added);
  await persistDoc(doc, pages);
  ocrLater(added.filter((p) => !p.draft)); finishLater(added);
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
  ocrLater([page]);
  return page;
}

// Girar 90° sin repetir todo el proceso: se gira la imagen ya generada y su miniatura (de décimas de segundo, no de segundos)
export async function rotatePage(page) {
  const t = timer('Girar');
  const out = rotateCanvas(await blobToCanvas(page.out), 90), thumb = rotateCanvas(await blobToCanvas(page.thumb), 90); t.step('girar');
  Object.assign(page, { rot: ((page.rot || 0) + 90) % 360, out: await toBlob(out, 'image/jpeg', Math.max(quality(), 0.92)), thumb: await toBlob(thumb, 'image/jpeg', 0.75), w: out.width, h: out.height, text: null, textLang: null, words: null });
  // las zonas ocultas giran con la página: (x, y) → (1 − y − alto, x)
  if (page.marks && page.marks.length) page.marks = page.marks.map((m) => ({ ...m, x: 1 - m.y - m.h, y: m.x, w: m.h, h: m.w }));
  dropPre(page.id); page.rev = Date.now() + Math.random();
  await savePage(page); t.step('guardar'); t.end();
  ocrLater([page]);
  return page;
}

export async function updateAllPages(doc, patch) {
  const pages = await docPages(doc);
  await mapLimit(pages, cvLanes(), (p) => updatePage(p, patch));   // en paralelo si hay núcleos de sobra
  await persistDoc(doc, pages);
  return pages;
}

export async function reorderPages(doc, order) {
  const pages = await docPages(doc);
  const next = order.map((id) => pages.find((p) => p.id === id)).filter(Boolean);
  await persistDoc(doc, next);
  return next;
}

export async function ocrPage(page, { lang = getSettings().ocrLang, onProgress, force = false } = {}) {
  if (page.text != null && page.textLang === lang) return page.text;
  fg++;
  try {
    await ensureFull(page);
    const q = bgQueue.indexOf(page.id); if (q >= 0) bgQueue.splice(q, 1);
    if (bgCurrent === page.id && bgJob) await bgJob.catch(() => {});   // ya se está reconociendo en segundo plano: se espera ese resultado
    // ¿ya lo reconoció el OCR en segundo plano? (misma versión de la imagen)
    const saved = await getPage(page.id);
    if (!force && saved && saved.rev === page.rev && saved.words && saved.textLang === lang) { Object.assign(page, { text: saved.text, textLang: lang, words: saved.words, w: saved.w, h: saved.h }); return page.text; }
    const canvas = await blobToCanvas(page.out);
    const r = await recognize(canvas, { lang, onProgress });
    page.text = r.text; page.textLang = lang; page.words = r.words; page.w = canvas.width; page.h = canvas.height;
    await savePage(page);
    return page.text;
  } finally { fg--; }
}

// PDF del documento. Con { searchable } hace OCR de las páginas que aún no tienen palabras para añadir texto invisible.
export async function docPdf(doc, pages, { size = getSettings().pdfSize, margin = getSettings().pdfMargin, searchable = false, lang = getSettings().ocrLang, onProgress } = {}) {
  const items = [];
  for (let i = 0; i < pages.length; i++) {
    const p = await ensureFull(pages[i]);
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
    await ensureFull(p);
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
    items.push({ canvas: await renderPdfPage(pdf, i, 2), quad: null, filter: 'original', deskew: false });   // las páginas de un PDF ya vienen rectas
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
