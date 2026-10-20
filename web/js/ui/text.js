// Hoja «Texto»: reconoce (OCR) el texto de una página o de todo el documento, y permite editarlo, copiarlo y compartirlo.
import { h, icon, openSheet, toast, safeName } from '../lib/dom.js';
import { ocrPage } from '../core/docs.js';
import { savePage } from '../core/db.js';
import { LANGS } from '../core/ocr.js';
import { getSettings, setSettings } from '../lib/settings.js';
import { sendFiles } from './send.js';

// pages: todas las del documento; index: la actual
export function openText(doc, pages, index) {
  let scope = 'page', running = 0;
  const st = getSettings();
  const lang = h('select', { attrs: { 'aria-label': 'Idioma del documento' } }, LANGS.map((l) => h('option', { value: l.id, text: l.label })));
  lang.value = st.ocrLang;
  const scopeSeg = h('div', { class: 'seg' });
  const area = h('textarea', { attrs: { 'aria-label': 'Texto reconocido', spellcheck: 'false' }, placeholder: 'El texto reconocido aparecerá aquí' });
  const bar = h('div', { class: 'bar', hidden: true }, h('i'));
  const status = h('p', { class: 'hint' });
  const runBtn = h('button', { class: 'btn small', attrs: { type: 'button' } }, icon('text', 's'), 'Reconocer de nuevo');
  const copyBtn = h('button', { class: 'btn', attrs: { type: 'button' } }, icon('copy', 's'), 'Copiar');
  const shareBtn = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('share', 's'), 'Compartir…');
  const sheet = openSheet({ title: 'Texto del documento', body: h('div', {}, scopeSeg, h('label', { class: 'field' }, h('span', { text: 'Idioma' }), lang), h('div', { class: 'btn-row ocr-row' }, runBtn), status, bar, area), foot: [copyBtn, shareBtn] });

  const targets = () => (scope === 'page' ? [pages[index]] : pages);
  const draw = () => {
    scopeSeg.textContent = '';
    for (const [id, label] of [['page', `Página ${index + 1}`], ['all', 'Todo el documento']]) {
      if (id === 'all' && pages.length < 2) continue;
      scopeSeg.append(h('button', { class: id === scope ? 'on' : '', attrs: { type: 'button' }, text: label, on: { click: () => { scope = id; draw(); show(); } } }));
    }
  };
  const joined = () => targets().map((p, i) => (targets().length > 1 ? `--- Página ${pages.indexOf(p) + 1} ---\n` : '') + (p.text || '')).join('\n\n');
  const show = () => { area.value = targets().every((p) => p.text != null) ? joined() : ''; status.textContent = ''; };

  async function recognize(force) {
    const my = ++running;
    const ts = targets();
    if (!force && ts.every((p) => p.text != null && p.textLang === lang.value)) { show(); return; }
    runBtn.disabled = true; bar.hidden = false; area.value = '';
    await setSettings({ ocrLang: lang.value });
    try {
      for (let i = 0; i < ts.length; i++) {
        if (my !== running) return;
        if (force) { ts[i].text = null; ts[i].words = null; }
        status.textContent = `Reconociendo texto… ${ts.length > 1 ? `página ${i + 1} de ${ts.length}` : ''}`;
        await ocrPage(ts[i], { lang: lang.value, onProgress: (f) => { bar.firstChild.style.width = Math.round(((i + f) / ts.length) * 100) + '%'; } });
      }
      show();
      status.textContent = area.value.trim() ? 'Puedes corregir el texto aquí mismo antes de copiarlo o compartirlo.' : 'No se encontró texto. Prueba con el filtro «Blanco y negro» o con otro idioma.';
    } catch (e) { status.textContent = ''; toast(e.message || 'No se pudo reconocer el texto', 'error', 6000); }
    bar.hidden = true; bar.firstChild.style.width = '0'; runBtn.disabled = false;
  }
  // las correcciones a mano se guardan en la página (solo en vista de una página)
  let saveT = 0;
  area.addEventListener('input', () => {
    if (scope !== 'page') return;
    clearTimeout(saveT); saveT = setTimeout(() => { const p = pages[index]; p.text = area.value; savePage(p); }, 500);
  });
  runBtn.addEventListener('click', () => recognize(true));
  lang.addEventListener('change', () => recognize(true));
  copyBtn.addEventListener('click', async () => {
    if (!area.value.trim()) return toast('No hay texto que copiar.', 'info');
    try { await navigator.clipboard.writeText(area.value); toast('Texto copiado', 'ok'); } catch { area.select(); document.execCommand && document.execCommand('copy'); toast('Texto copiado', 'ok'); }
  });
  shareBtn.addEventListener('click', async () => {
    if (!area.value.trim()) return toast('No hay texto que compartir.', 'info');
    await sendFiles([{ blob: new Blob([area.value], { type: 'text/plain;charset=utf-8' }), name: safeName(doc.title) + '.txt' }], { mode: 'share' });
  });
  draw(); show(); recognize(false);
}
