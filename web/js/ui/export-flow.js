// Hoja «Exportar / compartir» de un documento: PDF (buscable), imágenes JPG o texto.
import { h, icon, openSheet, busy, toast, safeName } from '../lib/dom.js';
import { docPages, docPdf, ocrPage, ensureFull } from '../core/docs.js';
import { sendFiles } from './send.js';
import { getSettings, setSettings, QUALITY } from '../lib/settings.js';
import { LANGS } from '../core/ocr.js';

// pages opcional (si el editor ya las tiene cargadas); mode inicial: 'share' | 'save'
export async function openExport(doc, { pages = null, mode = 'share' } = {}) {
  const st = getSettings();
  let format = 'pdf';
  const seg = h('div', { class: 'seg', attrs: { role: 'tablist' } });
  const fmts = [['pdf', 'PDF'], ['jpg', 'Imágenes'], ['txt', 'Texto']];
  const name = h('input', { type: 'text', value: safeName(doc.title), maxLength: 80, attrs: { 'aria-label': 'Nombre del archivo' } });
  const size = h('select', { attrs: { 'aria-label': 'Tamaño de página' } }, h('option', { value: 'a4', text: 'A4' }), h('option', { value: 'letter', text: 'Carta (Letter)' }), h('option', { value: 'fit', text: 'Ajustado a la imagen' }));
  size.value = st.pdfSize;
  const margin = h('input', { type: 'checkbox', checked: !!st.pdfMargin });
  const search = h('input', { type: 'checkbox', checked: !!st.searchablePdf });
  const lang = h('select', { attrs: { 'aria-label': 'Idioma del texto' } }, LANGS.map((l) => h('option', { value: l.id, text: l.label })));
  lang.value = st.ocrLang;
  const pdfOpts = h('div', {},
    h('label', { class: 'field' }, h('span', { text: 'Tamaño de página' }), size),
    h('label', { class: 'check' }, margin, h('span', { text: 'Dejar márgenes alrededor' })),
    h('label', { class: 'check' }, search, h('span', { text: 'PDF buscable (reconoce el texto; tarda más)' })));
  const langBox = h('label', { class: 'field' }, h('span', { text: 'Idioma del documento' }), lang);
  const info = h('p', { class: 'hint' });
  const sendNote = h('p', { class: 'hint send-note' }, icon('share', 's'), ' «Compartir…» te deja enviarlo por WhatsApp, correo, Telegram, Discord y más.');
  const saveBtn = h('button', { class: 'btn', attrs: { type: 'button' } }, icon('download', 's'), 'Guardar');
  const shareBtn = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('share', 's'), 'Compartir…');
  const body = h('div', {}, seg, h('label', { class: 'field' }, h('span', { text: 'Nombre del archivo' }), name), h('div', { id: 'opts' }, pdfOpts), langBox, info, sendNote);
  const sheet = openSheet({ title: 'Exportar', body, foot: [saveBtn, shareBtn] });

  const refresh = () => {
    seg.textContent = '';
    for (const [id, label] of fmts) seg.append(h('button', { class: id === format ? 'on' : '', attrs: { type: 'button', role: 'tab', 'aria-selected': id === format } , text: label, on: { click: () => { format = id; refresh(); } } }));
    pdfOpts.hidden = format !== 'pdf';
    langBox.hidden = !(format === 'txt' || (format === 'pdf' && search.checked));
    info.textContent = format === 'pdf' ? `${doc.pageCount} ${doc.pageCount === 1 ? 'página' : 'páginas'} en un solo PDF.` : format === 'jpg' ? 'Una imagen JPG por página.' : 'Reconoce el texto de todas las páginas y lo guarda en un archivo .txt.';
  };
  search.addEventListener('change', refresh);
  refresh();

  const go = async (how) => {
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
  };
  saveBtn.addEventListener('click', () => go('save'));
  shareBtn.addEventListener('click', () => go('share'));
  if (mode === 'save') saveBtn.classList.add('primary'), shareBtn.classList.remove('primary');
}
