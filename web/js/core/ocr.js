// OCR sin conexión con Tesseract.js (el motor y los idiomas van incluidos en vendor/, no se descarga nada de internet).
import { canvasOf } from './cv.js';
import { applyFilter } from './filters.js';
import { isNative } from './share.js';

export const LANGS = [
  { id: 'spa', label: 'Español' },
  { id: 'eng', label: 'Inglés' },
  { id: 'spa+eng', label: 'Español + inglés' },
];

const url = (p) => new URL('../../vendor/tesseract/' + p, import.meta.url).href;
let lib = null, worker = null, workerLang = null, progressCb = null, busy = Promise.resolve();

function loadLib() {
  if (lib) return lib;
  lib = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = url('tesseract.min.js');
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { lib = null; reject(new Error('No se pudo cargar el motor de texto (OCR).')); };
    document.head.appendChild(s);
  });
  return lib;
}

async function getWorker(lang) {
  const T = await loadLib();
  if (worker && workerLang === lang) return worker;
  if (worker) { try { await worker.terminate(); } catch { /* ya parado */ } worker = null; }
  worker = await T.createWorker(lang, 1, {
    workerPath: url('worker.min.js'),
    corePath: url('core'),
    langPath: url('lang'),
    gzip: !isNative(),   // en la app de Android los .gz se empaquetan ya descomprimidos (spa.traineddata)
    cacheMethod: 'none',
    logger: (m) => { if (progressCb && m.status === 'recognizing text') progressCb(m.progress); },
  });
  await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '0' });   // análisis automático de la página (el modo por defecto salta títulos grandes)
  workerLang = lang;
  return worker;
}

// Reduce los lienzos grandes: a 1800 px lee igual de bien una página normal (probado con letra pequeña) y tarda bastante menos
function prepare(canvas, maxSide = 1800) {
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  if (k === 1) return canvas;
  const c = canvasOf(canvas.width * k, canvas.height * k); c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); return c;
}

// ¿Ya es blanco y negro puro? (no se vuelve a binarizar: degradaría los trazos finos)
function isBinary(c) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let n = 0, bin = 0;
  for (let i = 0; i < d.length; i += 4 * 37) { n++; if (d[i] < 6 || d[i] > 249) bin++; }
  return bin / n > 0.99;   // estricto: un «Mejorado» con letra negra se parece al blanco y negro, pero aún conviene binarizarlo
}

// Devuelve { text, confidence, words:[{text, x0,y0,x1,y1}] } con coordenadas del lienzo original.
// Las llamadas se hacen una tras otra (un solo motor): si hay varias páginas se encolan.
export function recognize(canvas, { lang = 'spa+eng', onProgress = null, binarize = true } = {}) {
  const job = busy.then(async () => {
    progressCb = onProgress;
    // el motor lee mejor texto negro sobre blanco: se binariza la página (sombras fuera) sea cual sea el filtro elegido
    const small = prepare(canvas), k = canvas.width / small.width;
    const src = binarize && !isBinary(small) ? await applyFilter(small, { filter: 'bn' }) : small;
    const w = await getWorker(lang);
    const { data } = await w.recognize(src, {}, { text: true, blocks: true });
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) {
      if (wd.text && wd.text.trim()) words.push({ text: wd.text, x0: wd.bbox.x0 * k, y0: wd.bbox.y0 * k, x1: wd.bbox.x1 * k, y1: wd.bbox.y1 * k, conf: wd.confidence });
    }
    progressCb = null;
    return { text: (data.text || '').replace(/\n{3,}/g, '\n\n').trim(), confidence: data.confidence, words };
  });
  busy = job.catch(() => {});
  return job;
}

export async function stopOcr() { if (worker) { try { await worker.terminate(); } catch { /* ya parado */ } worker = null; workerLang = null; } }
