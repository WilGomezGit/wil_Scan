// Hoja «Exportar / compartir» de un documento: una vista de la primera página y una lista corta de acciones de un toque
// (compartir como PDF, como imágenes o como texto, o guardar el PDF en el teléfono). Las opciones del PDF van plegadas:
// se usan las de Ajustes y solo se tocan si hace falta.
import { h, icon, openSheet, busy, toast, safeName } from '../lib/dom.js';
import { docPages, docPdf, ocrPage, ensureFull } from '../core/docs.js';
import { sendFiles } from './send.js';
import { getSettings, setSettings } from '../lib/settings.js';
import { LANGS } from '../core/ocr.js';

// pages opcional (si el editor ya las tiene cargadas); mode: 'share' | 'save' (cuál va primero en la lista)
export async function openExport(doc, { pages = null, mode = 'share' } = {}) {
  const st = getSettings();
  const n = doc.pageCount || (pages ? pages.length : 0);
  const name = h('input', { type: 'text', value: safeName(doc.title), maxLength: 80, attrs: { 'aria-label': 'Nombre del archivo' } });
  const size = h('select', { attrs: { 'aria-label': 'Tamaño de página' } }, h('option', { value: 'auto', text: 'Automático (según la foto)' }), h('option', { value: 'a4', text: 'A4' }), h('option', { value: 'letter', text: 'Carta (Letter)' }), h('option', { value: 'fit', text: 'Ajustado a la imagen' }));
  size.value = st.pdfSize;
  const margin = h('input', { type: 'checkbox', checked: !!st.pdfMargin });
  const search = h('input', { type: 'checkbox', checked: !!st.searchablePdf });
  const lang = h('select', { attrs: { 'aria-label': 'Idioma del texto' } }, LANGS.map((l) => h('option', { value: l.id, text: l.label })));
  lang.value = st.ocrLang;

  // vista de la primera página
  let url = null;
  const cover = doc.cover || (pages && pages[0] && (pages[0].thumb || pages[0].out));
  if (cover) url = URL.createObjectURL(cover);
  const head = h('div', { class: 'exp-head' },
    h('span', { class: 'exp-thumb' }, url ? h('img', { src: url, alt: '' }) : icon('file', 'l')),
    h('span', { class: 'exp-info' }, h('b', { text: doc.title }), h('small', { text: n === 1 ? '1 página' : `${n} páginas` })));

  const ACTS = [
    ['pdf', 'share', 'file', 'Compartir como PDF', 'WhatsApp, correo, Telegram, Drive…'],
    ['jpg', 'share', 'image', 'Compartir como imágenes', 'Una imagen JPG por página'],
    ['txt', 'share', 'text', 'Compartir como texto', 'Reconoce el texto de las páginas'],
    ['pdf', 'save', 'download', 'Guardar PDF en el teléfono', 'En la carpeta Descargas'],
  ];
  if (mode === 'save') ACTS.unshift(ACTS.pop());
  const list = h('div', { class: 'exp-list' }, ACTS.map(([fmt, how, ic, label, sub]) =>
    h('button', { class: 'exp-act', attrs: { type: 'button' }, data: { fmt, how }, on: { click: () => go(fmt, how) } }, h('span', { class: 'exp-ic' }, icon(ic)), h('span', { class: 'exp-tx' }, h('b', { text: label }), h('small', { text: sub })))));
  const opts = h('details', { class: 'exp-opts' }, h('summary', {}, icon('settings', 's'), 'Opciones del PDF'),
    h('label', { class: 'field' }, h('span', { text: 'Nombre del archivo' }), name),
    h('label', { class: 'field' }, h('span', { text: 'Tamaño de página' }), size),
    h('label', { class: 'check' }, margin, h('span', { text: 'Dejar márgenes alrededor' })),
    h('label', { class: 'check' }, search, h('span', { text: 'PDF buscable (reconoce el texto; tarda más)' })),
    h('label', { class: 'field' }, h('span', { text: 'Idioma del documento' }), lang));
  const done = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
  const sheet = openSheet({ title: 'Exportar', body: h('div', {}, head, list, opts), onClose: done });

  async function go(format, how) {
    const base = safeName(name.value || doc.title);
    await setSettings({ pdfSize: size.value, pdfMargin: margin.checked, searchablePdf: search.checked, ocrLang: lang.value });
    sheet.close();
    const b = busy('Preparando…');
    try {
      const ps = pages || await docPages(doc);
      if (ps.some((p) => p.draft)) { b.update('Terminando las páginas…', 0); for (const p of ps) await ensureFull(p); }
      const files = [];
      if (format === 'pdf') {
        const blob = await docPdf(doc, ps, { size: size.value, margin: margin.checked, searchable: search.checked, lang: lang.value, onProgress: (f, t) => b.update(t, f) });
        files.push({ blob, name: base + '.pdf' });
      } else if (format === 'jpg') {
        ps.forEach((p, i) => files.push({ blob: p.out, name: ps.length > 1 ? `${base} - ${i + 1}.jpg` : base + '.jpg' }));
      } else {
        const parts = [];
        for (let i = 0; i < ps.length; i++) { b.update(`Reconociendo texto · página ${i + 1} de ${ps.length}`, i / ps.length); parts.push(await ocrPage(ps[i], { lang: lang.value, onProgress: (f) => b.update(null, (i + f) / ps.length) })); }
        const text = parts.map((t, i) => (ps.length > 1 ? `--- Página ${i + 1} ---\n` : '') + t).join('\n\n');
        if (!text.trim()) throw new Error('No se encontró texto en el documento.');
        files.push({ blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), name: base + '.txt' });
      }
      b.close();
      await sendFiles(files, { mode: how, title: base });
    } catch (e) { b.close(); toast(e.message || 'No se pudo exportar', 'error', 6000); }
  }
}
