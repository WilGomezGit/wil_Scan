// Pantalla «Herramientas»: convertir, organizar, firmar y extraer texto de PDF e imágenes, todo en el dispositivo.
import { h, icon, $, toast, openSheet, withBusy, busy, fmtSize, safeName, stamp } from '../lib/dom.js';
import { blobToCanvas, scaled, toBlob } from '../core/pages.js';
import { buildPdf } from '../core/pdf-export.js';
import * as T from '../core/pdf-tools.js';
import { importPdf } from '../core/docs.js';
import { recognize, LANGS } from '../core/ocr.js';
import { readQr } from '../core/qr.js';
import { sendFiles } from './send.js';
import { getSettings, getSignature, setSignature } from '../lib/settings.js';

let cb = {};
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImg = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|bmp|heic)$/i.test(f.name);
const base = (f) => safeName(f.name.replace(/\.[^.]+$/, ''));

const GROUPS = [
  ['Convertir', [
    { id: 'img2pdf', icon: 'file', title: 'Imágenes a PDF', desc: 'Junta varias fotos en un solo PDF' },
    { id: 'pdf2img', icon: 'image', title: 'PDF a imágenes', desc: 'Cada página como JPG o PNG' },
    { id: 'pdf2txt', icon: 'text', title: 'PDF a texto', desc: 'Extrae el texto (con OCR si es un escaneo)' },
    { id: 'img2txt', icon: 'scan', title: 'Imagen a texto', desc: 'Reconoce el texto de una foto (OCR)' },
    { id: 'qr', icon: 'qr', title: 'Leer código QR', desc: 'Enlaces, WiFi o contactos de una foto' },
    { id: 'importpdf', icon: 'upload', title: 'Importar PDF', desc: 'Edítalo como documento escaneado' },
  ]],
  ['Organizar PDF', [
    { id: 'merge', icon: 'merge', title: 'Unir PDF', desc: 'Combina varios PDF en uno' },
    { id: 'split', icon: 'split', title: 'Dividir PDF', desc: 'Separa por rangos o página a página' },
    { id: 'extract', icon: 'extract', title: 'Extraer páginas', desc: 'Crea un PDF con las páginas que elijas' },
    { id: 'delete', icon: 'trash', title: 'Eliminar páginas', desc: 'Quita las páginas que sobran' },
    { id: 'rotate', icon: 'rotate', title: 'Girar páginas', desc: '90°, 180° o 270°' },
    { id: 'order', icon: 'layers', title: 'Ordenar páginas', desc: 'Cambia el orden con flechas' },
    { id: 'compress', icon: 'compress', title: 'Comprimir PDF', desc: 'Reduce el peso para enviarlo' },
  ]],
  ['Marcar y firmar', [
    { id: 'sign', icon: 'sign', title: 'Firmar PDF', desc: 'Dibuja tu firma y colócala' },
    { id: 'watermark', icon: 'drop', title: 'Marca de agua', desc: 'Texto en diagonal sobre cada página' },
    { id: 'numbers', icon: 'hash', title: 'Numerar páginas', desc: 'Añade el número de página' },
  ]],
];

export function initTools(callbacks) {
  cb = callbacks;
  const root = $('#v-tools');
  root.append(h('div', { class: 'view-head' }, h('h1', { text: 'Herramientas' })), h('p', { class: 'hint tools-note' }, icon('info', 's'), ' Todo se procesa en tu dispositivo: tus archivos no se suben a ningún servidor.'));
  for (const [title, list] of GROUPS) {
    root.append(h('div', { class: 'section-title', text: title }), h('div', { class: 'tool-grid' }, list.map((t) => h('button', { class: 'tool', attrs: { type: 'button' }, on: { click: () => OPEN[t.id](t) } }, h('span', { class: 'tool-ic' }, icon(t.icon)), h('span', { class: 'tool-tx' }, h('b', { text: t.title }), h('small', { text: t.desc }))))));
  }
}

// ---------- piezas de formulario ----------
const F = {
  text: (label, value = '', ph = '') => { const i = h('input', { type: 'text', value, placeholder: ph, attrs: { 'aria-label': label, autocomplete: 'off' } }); return { el: h('label', { class: 'field' }, h('span', { text: label }), i), get: () => i.value.trim(), input: i }; },
  num: (label, value, min, max) => { const i = h('input', { type: 'number', value, min, max, inputMode: 'numeric', attrs: { 'aria-label': label } }); return { el: h('label', { class: 'field' }, h('span', { text: label }), i), get: () => +i.value }; },
  select: (label, opts, value) => { const s = h('select', { attrs: { 'aria-label': label } }, opts.map(([v, t]) => h('option', { value: v, text: t }))); s.value = value ?? opts[0][0]; return { el: h('label', { class: 'field' }, h('span', { text: label }), s), get: () => s.value, input: s }; },
  range: (label, value, min, max, step = 1, fmt = (v) => v) => { const i = h('input', { type: 'range', min, max, step, value, attrs: { 'aria-label': label } }); const out = h('b', { text: fmt(value) }); i.addEventListener('input', () => { out.textContent = fmt(i.value); }); return { el: h('label', { class: 'field' }, h('span', {}, label + ': ', out), i), get: () => +i.value }; },
  check: (label, value = false) => { const i = h('input', { type: 'checkbox', checked: value }); return { el: h('label', { class: 'check' }, i, h('span', { text: label })), get: () => i.checked }; },
};

// Selector de archivos con lista (y orden, si se pide). Devuelve { el, files(), onChange(fn) }
function filePicker({ accept, multiple = false, label = 'Elegir archivos', orderable = false }) {
  let files = [], listeners = [];
  const input = h('input', { type: 'file', accept, multiple, hidden: true });
  const list = h('ul', { class: 'files' });
  const btn = h('button', { class: 'btn block', attrs: { type: 'button' } }, icon('upload', 's'), label);
  const drop = h('div', { class: 'drop' }, btn, h('p', { class: 'hint center', text: 'o arrastra los archivos aquí' }), input);
  const changed = () => { draw(); listeners.forEach((fn) => fn(files)); };
  const add = (fl) => { const ok = [...fl].filter((f) => (accept.includes('pdf') && isPdf(f)) || (accept.includes('image') && isImg(f))); if (!ok.length) { toast('Ese tipo de archivo no sirve aquí.', 'error'); return; } files = multiple ? files.concat(ok) : ok.slice(0, 1); changed(); };
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); });
  function draw() {
    list.textContent = '';
    files.forEach((f, i) => list.append(h('li', {}, icon(isPdf(f) ? 'file' : 'image', 's'), h('span', { class: 'fn', text: f.name }), h('small', { text: fmtSize(f.size) }),
      orderable && files.length > 1 ? [h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Subir', disabled: i === 0 }, on: { click: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; changed(); } } }, icon('back', 's')), h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Bajar', disabled: i === files.length - 1 }, on: { click: () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; changed(); } } }, icon('next', 's'))] : null,
      h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Quitar ' + f.name }, on: { click: () => { files.splice(i, 1); changed(); } } }, icon('close', 's')))));
    btn.lastChild.textContent = files.length && multiple ? 'Añadir más archivos' : files.length ? 'Cambiar archivo' : label;
  }
  draw();
  return { el: h('div', {}, drop, list), files: () => files, onChange: (fn) => listeners.push(fn), input };
}

// Hoja genérica: archivos + opciones + botón; muestra resultados con Guardar / Compartir.
function toolSheet({ title, desc, accept, multiple, orderable, min = 1, extra = [], action = 'Procesar', run, onFiles }) {
  const pick = filePicker({ accept, multiple, orderable });
  const info = h('p', { class: 'hint' });
  const go = h('button', { class: 'btn primary', attrs: { type: 'button' } }, action);
  const opts = h('div', {}, extra.map((x) => x.el));
  const sheet = openSheet({ title, body: h('div', {}, h('p', { class: 'hint first', text: desc }), pick.el, info, opts), foot: [go] });
  const upd = async (files) => {
    go.disabled = files.length < min;
    info.textContent = '';
    if (onFiles) { try { await onFiles(files, info); } catch (e) { info.textContent = e.message; } }
  };
  pick.onChange(upd); upd([]);
  go.addEventListener('click', async () => {
    const files = pick.files(); if (files.length < min) return;
    const b = busy('Procesando…');
    try {
      const out = await run(files, b);
      b.close();
      if (out) { sheet.close(); showResults(out); }
    } catch (e) { b.close(); toast(e.message || 'No se pudo completar la operación', 'error', 6500); }
  });
  return { sheet, pick, info };
}

export function showResults(out) {
  const files = Array.isArray(out) ? out : out.files, note = Array.isArray(out) ? '' : out.note || '';
  const toFile = (f) => ({ blob: f.blob || new Blob([f.bytes], { type: 'application/pdf' }), name: f.name });
  const fl = files.map(toFile);
  const pdfs = fl.filter((f) => f.name.endsWith('.pdf'));
  const saveAll = h('button', { class: 'btn', attrs: { type: 'button' } }, icon('download', 's'), fl.length > 1 ? 'Guardar todo' : 'Guardar');
  const shareAll = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('share', 's'), 'Compartir…');
  const body = h('div', {}, h('p', { class: 'ok-line' }, icon('check', 's'), fl.length > 1 ? ` ${fl.length} archivos listos` : ' Listo'), note ? h('p', { class: 'hint', text: note }) : null,
    h('ul', { class: 'files res' }, fl.map((f) => h('li', {}, icon(f.name.endsWith('.pdf') ? 'file' : f.name.endsWith('.txt') ? 'text' : 'image', 's'), h('span', { class: 'fn', text: f.name }), h('small', { text: fmtSize(f.blob.size) })))),
    pdfs.length === 1 ? h('button', { class: 'btn block small', attrs: { type: 'button' }, on: { click: async () => { s.close(); const d = await withBusy('Importando…', (b) => importPdf(new File([pdfs[0].blob], pdfs[0].name, { type: 'application/pdf' }), { onProgress: (f) => b.update(null, f) })); cb.onOpenDoc(d.id); } } }, icon('docs', 's'), 'Abrir en Documentos para editarlo') : null);
  const s = openSheet({ title: 'Resultado', body, foot: [saveAll, shareAll] });
  const act = (mode) => sendFiles(fl, { mode });
  saveAll.addEventListener('click', () => act('save')); shareAll.addEventListener('click', () => act('share'));
}

async function pdfInfo(files, info) { if (!files[0]) return; const n = await T.pageCount(files[0]); info.textContent = `Este PDF tiene ${n} ${n === 1 ? 'página' : 'páginas'}.`; }
const rangeHint = 'Ejemplos: 1-3, 5, 8-  ·  vacío = todas';

// ---------- herramientas ----------
const OPEN = {
  img2pdf(t) {
    const size = F.select('Tamaño de página', [['a4', 'A4'], ['letter', 'Carta (Letter)'], ['fit', 'Ajustado a la imagen']], getSettings().pdfSize), margin = F.check('Dejar márgenes', true);
    toolSheet({ title: t.title, desc: 'Elige las fotos en el orden en que quieres las páginas. Puedes moverlas con las flechas.', accept: 'image/*', multiple: true, orderable: true, extra: [size, margin], action: 'Crear PDF',
      run: async (files, b) => {
        const pages = [];
        for (let i = 0; i < files.length; i++) { b.update(`Preparando imagen ${i + 1} de ${files.length}`, i / files.length); const bmp = await createImageBitmap(files[i]); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close(); const sc = scaled(c, 3400); pages.push({ blob: await toBlob(sc, 'image/jpeg', 0.92), w: sc.width, h: sc.height }); }
        b.update('Creando el PDF…', 0.95);
        return [{ name: (files.length === 1 ? base(files[0]) : 'Imágenes ' + stamp()) + '.pdf', bytes: await buildPdf(pages, { size: size.get(), margin: margin.get() ? 18 : 0, title: 'Imágenes' }) }];
      } });
  },
  merge(t) {
    toolSheet({ title: t.title, desc: 'Elige dos o más PDF. Se unirán en el orden de la lista.', accept: 'application/pdf', multiple: true, orderable: true, min: 2, action: 'Unir PDF',
      run: async (files) => [{ name: 'Unido ' + stamp() + '.pdf', bytes: await T.mergePdfs(files) }] });
  },
  split(t) {
    const mode = F.select('Cómo dividir', [['ranges', 'Por rangos'], ['each', 'Una página por archivo'], ['every', 'Cada N páginas']], 'ranges');
    const ranges = F.text('Rangos (sepáralos con «;»)', '', 'Ej.: 1-3; 4-6; 7-');
    const every = F.num('Páginas por archivo', 2, 1, 500);
    const sync = () => { ranges.el.hidden = mode.get() !== 'ranges'; every.el.hidden = mode.get() !== 'every'; };
    mode.input.addEventListener('change', sync); sync();
    toolSheet({ title: t.title, desc: 'Separa un PDF en varios archivos.', accept: 'application/pdf', extra: [mode, ranges, every], onFiles: pdfInfo, action: 'Dividir',
      run: async (files) => {
        const m = mode.get();
        const parts = await T.splitPdf(files[0], m === 'ranges' ? { mode: 'ranges', rangeText: ranges.get() } : m === 'each' ? { mode: 'each' } : { mode: 'each', every: Math.max(1, every.get() || 1) });
        return parts.map((p, i) => ({ name: `${base(files[0])} - ${String(i + 1).padStart(2, '0')} (${p.name}).pdf`, bytes: p.bytes }));
      } });
  },
  extract(t) {
    const r = F.text('Páginas a extraer', '', rangeHint);
    toolSheet({ title: t.title, desc: 'Crea un PDF nuevo solo con las páginas que indiques.', accept: 'application/pdf', extra: [r], onFiles: pdfInfo, action: 'Extraer',
      run: async (files) => [{ name: base(files[0]) + ' (extracto).pdf', bytes: await T.extractPages(files[0], r.get()) }] });
  },
  delete(t) {
    const r = F.text('Páginas a eliminar', '', 'Ej.: 2, 5-7');
    toolSheet({ title: t.title, desc: 'Quita del PDF las páginas que indiques.', accept: 'application/pdf', extra: [r], onFiles: pdfInfo, action: 'Eliminar páginas',
      run: async (files) => [{ name: base(files[0]) + ' (editado).pdf', bytes: await T.deletePages(files[0], r.get()) }] });
  },
  rotate(t) {
    const deg = F.select('Giro', [['90', '90° a la derecha'], ['180', '180°'], ['270', '90° a la izquierda']], '90'), r = F.text('Páginas (vacío = todas)', '', rangeHint);
    toolSheet({ title: t.title, desc: 'Gira todas las páginas del PDF o solo las que indiques.', accept: 'application/pdf', extra: [deg, r], onFiles: pdfInfo, action: 'Girar',
      run: async (files) => [{ name: base(files[0]) + ' (girado).pdf', bytes: await T.rotatePdf(files[0], +deg.get(), r.get()) }] });
  },
  compress(t) {
    const q = F.select('Calidad', [['0.7', 'Alta (menos compresión)'], ['0.5', 'Media'], ['0.35', 'Baja (el archivo más pequeño)']], '0.5');
    toolSheet({ title: t.title, desc: 'Reduce el tamaño volviendo a crear las páginas como imágenes. Atención: el texto dejará de ser seleccionable.', accept: 'application/pdf', extra: [q], action: 'Comprimir',
      run: async (files, b) => {
        const before = files[0].size;
        const bytes = await T.compressPdf(files[0], { quality: +q.get(), scale: +q.get() > 0.6 ? 1.6 : 1.3, onProgress: (f) => b.update(`Comprimiendo… ${Math.round(f * 100)} %`, f) });
        if (bytes.length >= before) { toast('Este PDF ya está muy optimizado: no se pudo reducir más.', 'info', 5000); return null; }
        return { files: [{ name: base(files[0]) + ' (comprimido).pdf', bytes }], note: `De ${fmtSize(before)} a ${fmtSize(bytes.length)} (−${Math.round((1 - bytes.length / before) * 100)} %).` };
      } });
  },
  watermark(t) {
    const text = F.text('Texto', 'CONFIDENCIAL'), op = F.range('Opacidad', 25, 5, 80, 5, (v) => v + ' %'), size = F.range('Tamaño', 64, 20, 140, 2, (v) => v + ' pt'), ang = F.select('Inclinación', [['45', 'Diagonal'], ['0', 'Horizontal'], ['90', 'Vertical']], '45');
    const color = F.select('Color', [['#808080', 'Gris'], ['#c0392b', 'Rojo'], ['#1f4fd8', 'Azul'], ['#000000', 'Negro']], '#808080');
    toolSheet({ title: t.title, desc: 'Escribe un texto que se verá en cada página.', accept: 'application/pdf', extra: [text, op, size, ang, color], action: 'Añadir marca de agua',
      run: async (files) => [{ name: base(files[0]) + ' (marca de agua).pdf', bytes: await T.watermarkPdf(files[0], { text: text.get(), opacity: op.get() / 100, size: size.get(), angle: +ang.get(), color: color.get() }) }] });
  },
  numbers(t) {
    const pos = F.select('Posición', [['bottom-center', 'Abajo, centro'], ['bottom-right', 'Abajo, derecha'], ['bottom-left', 'Abajo, izquierda'], ['top-center', 'Arriba, centro'], ['top-right', 'Arriba, derecha']], 'bottom-center'), start = F.num('Empezar en', 1, 1, 9999), prefix = F.text('Texto antes del número', '', 'Ej.: Pág. ');
    toolSheet({ title: t.title, desc: 'Añade el número a cada página.', accept: 'application/pdf', extra: [pos, start, prefix], action: 'Numerar',
      run: async (files) => [{ name: base(files[0]) + ' (numerado).pdf', bytes: await T.numberPdf(files[0], { position: pos.get(), start: start.get() || 1, prefix: prefix.input.value }) }] });
  },
  pdf2img(t) {
    const fmt = F.select('Formato', [['jpg', 'JPG (más ligero)'], ['png', 'PNG (sin pérdida)']], 'jpg'), res = F.select('Resolución', [['1.5', 'Normal'], ['2', 'Alta'], ['3', 'Muy alta']], '2'), r = F.text('Páginas (vacío = todas)', '', rangeHint);
    toolSheet({ title: t.title, desc: 'Convierte cada página del PDF en una imagen.', accept: 'application/pdf', extra: [fmt, res, r], onFiles: pdfInfo, action: 'Convertir',
      run: async (files, b) => {
        const imgs = await T.pdfToImages(files[0], { scale: +res.get(), type: fmt.get() === 'png' ? 'image/png' : 'image/jpeg', rangeText: r.get(), onProgress: (f) => b.update(`Convirtiendo… ${Math.round(f * 100)} %`, f) });
        return imgs.map((i) => ({ name: `${base(files[0])} - ${i.name}`, blob: i.blob }));
      } });
  },
  pdf2txt(t) {
    const lang = F.select('Idioma (si hay que reconocer el texto)', LANGS.map((l) => [l.id, l.label]), getSettings().ocrLang);
    toolSheet({ title: t.title, desc: 'Extrae el texto de un PDF. Si es un escaneo sin texto, se reconoce con OCR.', accept: 'application/pdf', extra: [lang], onFiles: pdfInfo, action: 'Extraer texto',
      run: async (files, b) => {
        let text = await T.pdfToText(files[0]), note = '';
        if (text.replace(/\s/g, '').length < 20) {
          const doc = await T.openForRender(files[0]), parts = [];
          for (let i = 0; i < doc.numPages; i++) { b.update(`Reconociendo texto · página ${i + 1} de ${doc.numPages}`, i / doc.numPages); const c = await T.renderPdfPage(doc, i, 2.2); parts.push((await recognize(c, { lang: lang.get() })).text); }
          text = parts.join('\n\n'); note = 'Este PDF no tenía texto: se reconoció con OCR.';
        }
        if (!text.trim()) throw new Error('No se encontró texto en este PDF.');
        return { files: [{ name: base(files[0]) + '.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) }], note };
      } });
  },
  img2txt(t) {
    const lang = F.select('Idioma', LANGS.map((l) => [l.id, l.label]), getSettings().ocrLang);
    toolSheet({ title: t.title, desc: 'Reconoce el texto de una o varias fotos o capturas.', accept: 'image/*', multiple: true, extra: [lang], action: 'Reconocer texto',
      run: async (files, b) => {
        const parts = [];
        for (let i = 0; i < files.length; i++) { b.update(`Reconociendo texto · imagen ${i + 1} de ${files.length}`, i / files.length); const bmp = await createImageBitmap(files[i]); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close(); parts.push((await recognize(c, { lang: lang.get() })).text); }
        const text = parts.map((p, i) => (files.length > 1 ? `--- ${files[i].name} ---\n` : '') + p).join('\n\n');
        if (!text.trim()) throw new Error('No se encontró texto. Prueba con una foto más nítida y bien iluminada.');
        return { files: [{ name: (files.length === 1 ? base(files[0]) : 'Texto ' + stamp()) + '.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) }], note: text.length > 400 ? text.slice(0, 400) + '…' : text };
      } });
  },
  qr(t) {
    toolSheet({ title: t.title, desc: 'Lee el código QR de una foto o captura: enlaces, redes WiFi, contactos, pagos…', accept: 'image/*', multiple: true, action: 'Leer código',
      run: async (files, b) => {
        const found = [];
        for (let i = 0; i < files.length; i++) {
          b.update(`Buscando el código · imagen ${i + 1} de ${files.length}`, i / files.length);
          const bmp = await createImageBitmap(files[i]); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
          const v = await readQr(c); if (v) found.push(v);
        }
        if (!found.length) throw new Error('No se encontró ningún código QR. Acércate más y que salga entero y bien iluminado.');
        const text = found.join('\n');
        return { files: [{ name: 'Codigo QR ' + stamp() + '.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) }], note: text.length > 600 ? text.slice(0, 600) + '…' : text };
      } });
  },
  importpdf(t) {
    toolSheet({ title: t.title, desc: 'Convierte un PDF en un documento de la app para recortar, aplicar filtros, reconocer el texto y volver a exportarlo.', accept: 'application/pdf', action: 'Importar',
      run: async (files, b) => { const d = await importPdf(files[0], { onProgress: (f) => b.update('Importando páginas…', f) }); setTimeout(() => cb.onOpenDoc(d.id), 50); return null; } });
  },
  async order(t) {
    const pick = filePicker({ accept: 'application/pdf' });
    const go = h('button', { class: 'btn primary', attrs: { type: 'button' }, text: 'Guardar orden', disabled: true });
    const grid = h('div', { class: 'ord-grid' });
    const sheet = openSheet({ title: t.title, body: h('div', {}, h('p', { class: 'hint first', text: 'Elige un PDF y mueve las páginas con las flechas.' }), pick.el, grid), foot: [go] });
    let order = [], thumbs = [], src = null;
    const draw = () => {
      grid.textContent = '';
      order.forEach((pi, i) => grid.append(h('div', { class: 'ord' }, h('img', { src: thumbs[pi], alt: `Página ${pi + 1}`, draggable: false }),
        h('div', { class: 'ord-bar' }, h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Mover antes', disabled: i === 0 }, on: { click: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } } }, icon('back', 's')), h('span', { text: `${pi + 1}` }), h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Mover después', disabled: i === order.length - 1 }, on: { click: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } } }, icon('next', 's'))))));
    };
    pick.onChange(async (files) => {
      go.disabled = true; grid.textContent = '';
      if (!files[0]) return;
      const b = busy('Leyendo páginas…');
      try {
        src = files[0]; const doc = await T.openForRender(src); thumbs.forEach((u) => URL.revokeObjectURL(u)); thumbs = [];
        for (let i = 0; i < doc.numPages; i++) { const c = await T.renderPdfPage(doc, i, 0.35); thumbs.push(URL.createObjectURL(await toBlob(c, 'image/jpeg', 0.7))); b.update(null, (i + 1) / doc.numPages); }
        order = thumbs.map((_, i) => i); draw(); go.disabled = false;
      } catch (e) { toast(e.message || 'No se pudo leer el PDF', 'error'); }
      b.close();
    });
    go.addEventListener('click', async () => { try { const bytes = await withBusy('Reordenando…', () => T.reorderPdf(src, order)); sheet.close(); showResults([{ name: base(src) + ' (reordenado).pdf', bytes }]); } catch (e) { toast(e.message, 'error'); } });
  },
  async sign(t) {
    const pick = filePicker({ accept: 'application/pdf' });
    const canvasBox = h('div', { class: 'sign-stage', hidden: true });
    const pageLbl = h('span', { class: 'hint', text: '' });
    const prevB = h('button', { class: 'icon-btn solid', attrs: { type: 'button', 'aria-label': 'Página anterior' } }, icon('back', 's'));
    const nextB = h('button', { class: 'icon-btn solid', attrs: { type: 'button', 'aria-label': 'Página siguiente' } }, icon('next', 's'));
    const sizeR = F.range('Tamaño de la firma', 30, 10, 60, 1, (v) => v + ' %');
    const drawBtn = h('button', { class: 'btn small', attrs: { type: 'button' } }, icon('sign', 's'), 'Dibujar mi firma');
    const go = h('button', { class: 'btn primary', attrs: { type: 'button' }, text: 'Firmar y guardar', disabled: true });
    const ctl = h('div', { class: 'sign-ctl', hidden: true }, prevB, pageLbl, nextB);
    const sheet = openSheet({ title: t.title, body: h('div', {}, h('p', { class: 'hint first', text: 'Elige el PDF, dibuja tu firma una vez y arrástrala hasta su sitio.' }), pick.el, h('div', { class: 'btn-row sign-row' }, drawBtn), ctl, canvasBox, sizeR.el), foot: [go] });
    let doc = null, pageI = 0, sig = await getSignature(), pos = { x: 0.55, y: 0.82 }, sigImg = null, pageCanvas = null;
    const place = () => { if (!sigImg || !pageCanvas) return; const w = sizeR.get() / 100; sigImg.style.width = (w * 100) + '%'; sigImg.style.left = (pos.x * 100) + '%'; sigImg.style.top = (pos.y * 100) + '%'; };
    async function showPage() {
      if (!doc) return;
      pageCanvas = await T.renderPdfPage(doc, pageI, 0.9);
      pageCanvas.className = 'sign-page';
      canvasBox.textContent = ''; canvasBox.append(pageCanvas);
      if (sig) { sigImg = h('img', { class: 'sign-sig', src: sig, alt: 'Tu firma', draggable: false }); canvasBox.append(sigImg); place(); drag(); }
      pageLbl.textContent = `Página ${pageI + 1} de ${doc.numPages}`; prevB.disabled = pageI === 0; nextB.disabled = pageI === doc.numPages - 1;
      go.disabled = !sig;
    }
    function drag() {
      let on = false, ox = 0, oy = 0;
      sigImg.addEventListener('pointerdown', (e) => { on = true; const r = sigImg.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; sigImg.setPointerCapture(e.pointerId); e.preventDefault(); });
      sigImg.addEventListener('pointermove', (e) => { if (!on) return; const b = pageCanvas.getBoundingClientRect(); pos.x = Math.min(0.95, Math.max(0, (e.clientX - ox - b.left) / b.width)); pos.y = Math.min(0.97, Math.max(0, (e.clientY - oy - b.top) / b.height)); place(); });
      sigImg.addEventListener('pointerup', () => { on = false; }); sigImg.addEventListener('pointercancel', () => { on = false; });
    }
    sizeR.el.addEventListener('input', place);
    prevB.addEventListener('click', () => { pageI--; showPage(); }); nextB.addEventListener('click', () => { pageI++; showPage(); });
    pick.onChange(async (files) => { if (!files[0]) { doc = null; canvasBox.hidden = ctl.hidden = true; return; } try { doc = await T.openForRender(files[0]); pageI = 0; canvasBox.hidden = ctl.hidden = false; await showPage(); } catch (e) { toast(e.message || 'No se pudo leer el PDF', 'error'); } });
    drawBtn.addEventListener('click', () => signPad(async (png) => { sig = png; await setSignature(png); await showPage(); }));
    go.addEventListener('click', async () => {
      const f = pick.files()[0]; if (!f || !sig) return;
      try { const w = sizeR.get() / 100; const bytes = await withBusy('Firmando…', () => T.signPdf(f, { pageIndex: pageI, png: sig, x: pos.x, y: pos.y, w })); sheet.close(); showResults([{ name: base(f) + ' (firmado).pdf', bytes }]); } catch (e) { toast(e.message, 'error'); }
    });
    if (!sig) toast('Primero dibuja tu firma.', 'info');
  },
};

// Lienzo para dibujar la firma; devuelve un PNG con fondo transparente recortado al trazo
function signPad(onUse) {
  const c = h('canvas', { class: 'sig-pad', width: 900, height: 360, attrs: { 'aria-label': 'Zona para firmar' } });
  const x = c.getContext('2d'); x.lineWidth = 7; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#0b2a8a';
  let on = false, any = false, last = null;
  const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  c.addEventListener('pointerdown', (e) => { on = true; last = pt(e); c.setPointerCapture(e.pointerId); e.preventDefault(); x.beginPath(); x.arc(last[0], last[1], 3.5, 0, 6.3); x.fillStyle = '#0b2a8a'; x.fill(); any = true; });
  c.addEventListener('pointermove', (e) => { if (!on) return; const p = pt(e); x.beginPath(); x.moveTo(last[0], last[1]); x.lineTo(p[0], p[1]); x.stroke(); last = p; });
  c.addEventListener('pointerup', () => { on = false; }); c.addEventListener('pointercancel', () => { on = false; });
  const clear = h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Borrar', on: { click: () => { x.clearRect(0, 0, c.width, c.height); any = false; } } });
  const use = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('check', 's'), 'Usar esta firma');
  const s = openSheet({ title: 'Dibuja tu firma', body: h('div', {}, h('p', { class: 'hint first', text: 'Firma con el dedo o el ratón dentro del recuadro.' }), c), foot: [clear, use] });
  use.addEventListener('click', () => {
    if (!any) { toast('Dibuja tu firma primero.', 'info'); return; }
    const d = x.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) if (d[(yy * c.width + xx) * 4 + 3] > 10) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    const pad = 10, w = x1 - x0 + 2 * pad, hh = y1 - y0 + 2 * pad, out = document.createElement('canvas'); out.width = w; out.height = hh;
    out.getContext('2d').drawImage(c, x0 - pad, y0 - pad, w, hh, 0, 0, w, hh);
    s.close(); onUse(out.toDataURL('image/png'));
  });
}
