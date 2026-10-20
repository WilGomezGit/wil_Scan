// Editor de documento: ver páginas, recortar, filtros, girar, texto, ordenar, añadir y eliminar páginas, exportar.
import { h, icon, toast, confirmBox, promptBox, menuSheet, openSheet, withBusy, pushLayer, safeName } from '../lib/dom.js';
import { getDoc, saveDoc, deleteDoc } from '../core/db.js';
import { docPages, appendPages, removePage, updatePage, updateAllPages, reorderPages } from '../core/docs.js';
import { blobToCanvas, scaled } from '../core/pages.js';
import { warpQuad, rotateCanvas } from '../core/warp.js';
import { applyFilter, FILTERS } from '../core/filters.js';
import { detectQuad } from '../core/detect.js';
import { canvasOf } from '../core/cv.js';
import { openCropper } from './crop.js';
import { openText } from './text.js';
import { openExport } from './export-flow.js';
import { openScanner } from './scan.js';

export async function openEditor(docId, { onClose = () => {} } = {}) {
  let doc = await getDoc(docId);
  if (!doc) { toast('No se encontró el documento.', 'error'); return; }
  let pages = await docPages(doc), idx = 0, zoomed = false, urls = new Map(), closed = false;

  const url = (blob, key) => { const k = key; if (!urls.has(k)) urls.set(k, URL.createObjectURL(blob)); return urls.get(k); };
  const dropUrls = (prefix) => { for (const [k, u] of urls) if (!prefix || k.startsWith(prefix)) { URL.revokeObjectURL(u); urls.delete(k); } };

  const titleBtn = h('button', { class: 'ed-title', attrs: { type: 'button', 'aria-label': 'Cambiar el nombre del documento' } });
  const backBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Volver a documentos' } }, icon('back'));
  const exportBtn = h('button', { class: 'btn primary small', attrs: { type: 'button' } }, icon('share', 's'), 'Exportar');
  const moreBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Más opciones' } }, icon('more'));
  const img = h('img', { class: 'ed-img', alt: 'Página del documento', draggable: false });
  const live = h('canvas', { class: 'ed-img ed-live', hidden: true });
  const wrap = h('div', { class: 'ed-wrap' }, img, live);
  const prev = h('button', { class: 'icon-btn solid ed-nav l', attrs: { type: 'button', 'aria-label': 'Página anterior' } }, icon('back'));
  const next = h('button', { class: 'icon-btn solid ed-nav r', attrs: { type: 'button', 'aria-label': 'Página siguiente' } }, icon('next'));
  const counter = h('div', { class: 'ed-counter', attrs: { 'aria-live': 'polite' } });
  const stage = h('div', { class: 'ed-stage' }, wrap, prev, next, counter);
  const strip = h('div', { class: 'ed-strip', attrs: { role: 'list', 'data-scroll': true } });
  const tools = h('div', { class: 'ed-tools' });
  const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true });
  const root = h('div', { class: 'ed', attrs: { role: 'dialog', 'aria-label': 'Editor de documento' } },
    h('div', { class: 'ed-top' }, backBtn, titleBtn, exportBtn, moreBtn), stage, strip, tools, fileIn);
  document.body.append(root);

  const pop = pushLayer(() => { closed = true; root.remove(); dropUrls(); onClose(); });
  backBtn.addEventListener('click', () => pop());

  // ---------- pintar ----------
  const cur = () => pages[idx];
  function drawStage() {
    const p = cur();
    titleBtn.textContent = doc.title;
    live.hidden = true;
    img.src = url(p.out, 'out:' + p.id + ':' + (p.updatedKey || p.out.size));
    counter.textContent = `${idx + 1} / ${pages.length}`;
    prev.hidden = idx === 0; next.hidden = idx === pages.length - 1;
    stage.classList.toggle('zoom', zoomed);
    stage.scrollTop = 0; stage.scrollLeft = 0;
  }
  function drawStrip() {
    strip.textContent = '';
    pages.forEach((p, i) => {
      strip.append(h('button', { class: 'ed-thumb' + (i === idx ? ' on' : ''), attrs: { type: 'button', role: 'listitem', 'aria-label': `Página ${i + 1}` + (i === idx ? ' (actual)' : '') }, on: { click: () => go(i) } },
        h('img', { src: url(p.thumb, 'th:' + p.id + ':' + p.thumb.size), alt: '', draggable: false }), h('span', { text: String(i + 1) })));
    });
    strip.append(h('button', { class: 'ed-thumb add', attrs: { type: 'button', 'aria-label': 'Añadir páginas' }, on: { click: addMenu } }, icon('plus')));
    const on = strip.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function drawTools() {
    tools.textContent = '';
    const defs = [['crop', 'Recortar', doCrop], ['filter', 'Filtros', () => doFilters(false)], ['rotate', 'Girar', doRotate], ['text', 'Texto', () => openText(doc, pages, idx)], ['layers', 'Ordenar', doOrder], ['trash', 'Eliminar', doDeletePage]];
    for (const [ic, label, fn] of defs) tools.append(h('button', { class: 'ed-tool', attrs: { type: 'button' }, on: { click: fn } }, icon(ic), h('span', { text: label })));
  }
  const refresh = () => { drawStage(); drawStrip(); };
  function go(i) { idx = Math.max(0, Math.min(pages.length - 1, i)); zoomed = false; refresh(); }
  prev.addEventListener('click', () => go(idx - 1)); next.addEventListener('click', () => go(idx + 1));
  img.addEventListener('dblclick', () => { zoomed = !zoomed; stage.classList.toggle('zoom', zoomed); });
  // deslizar con el dedo para cambiar de página
  let sx = 0, sy = 0, tracking = false;
  stage.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' || zoomed) return; sx = e.clientX; sy = e.clientY; tracking = true; });
  stage.addEventListener('pointerup', (e) => { if (!tracking) return; tracking = false; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(idx + (dx < 0 ? 1 : -1)); });
  stage.addEventListener('pointercancel', () => { tracking = false; });
  document.addEventListener('keydown', onKey);
  function onKey(e) { if (closed) { document.removeEventListener('keydown', onKey); return; } if (document.querySelector('.backdrop, .crop, .scan')) return; if (e.key === 'ArrowLeft') go(idx - 1); else if (e.key === 'ArrowRight') go(idx + 1); }

  // ---------- acciones ----------
  const commit = async () => { await (async () => { const d = await getDoc(doc.id); if (d) { d.cover = pages[0].thumb; await saveDoc(d); doc = d; } })(); };
  async function doCrop() {
    const p = cur();
    const q = await openCropper(p);
    if (q === undefined) return;
    await withBusy('Recortando…', () => updatePage(p, { quad: q, skew: q ? 0 : p.skew }));
    p.updatedKey = Date.now(); if (idx === 0) await commit(); refresh();
  }
  async function doRotate() {
    const p = cur();
    await withBusy('Girando…', () => updatePage(p, { rot: ((p.rot || 0) + 90) % 360 }));
    p.updatedKey = Date.now(); if (idx === 0) await commit(); refresh();
  }
  async function doDeletePage() {
    const p = cur();
    if (!(await confirmBox({ title: '¿Eliminar esta página?', text: pages.length === 1 ? 'Es la única página: se eliminará todo el documento.' : `Se eliminará la página ${idx + 1}.`, ok: 'Eliminar', danger: true }))) return;
    const left = await removePage(doc, p.id);
    if (!left) { toast('Documento eliminado', 'ok'); pop(); return; }
    pages = left; doc = await getDoc(doc.id); dropUrls('out:' + p.id); dropUrls('th:' + p.id);
    idx = Math.min(idx, pages.length - 1); refresh();
  }
  async function doFilters(all) {
    const p = cur();
    const orig = await withBusy('Preparando filtros…', async () => {
      const o = await blobToCanvas(p.orig);
      const w = await warpQuad(o, p.quad || null, { maxSide: 1000 });
      return rotateCanvas(w, p.rot || 0);
    });
    const mid = scaled(orig, 900), tiny = scaled(orig, 150);
    let sel = p.filter || 'auto', bright = p.bright || 0, contrast = p.contrast || 0, applyAll = !!all, tick = 0;
    const chips = h('div', { class: 'flt-row', attrs: { 'data-scroll': true } });
    const chipEls = {};
    for (const f of FILTERS) {
      const cv = h('canvas', { class: 'flt-prev' });
      const b = h('button', { class: 'flt' + (f.id === sel ? ' on' : ''), attrs: { type: 'button', 'aria-pressed': String(f.id === sel) }, on: { click: () => { sel = f.id; Object.entries(chipEls).forEach(([id, el]) => { el.classList.toggle('on', id === sel); el.setAttribute('aria-pressed', String(id === sel)); }); preview(); } } }, cv, h('span', { text: f.label }));
      chipEls[f.id] = b; chips.append(b);
      applyFilter(tiny, { filter: f.id }).then((r) => { cv.width = r.width; cv.height = r.height; cv.getContext('2d').drawImage(r, 0, 0); }).catch(() => {});
    }
    const sb = h('input', { type: 'range', min: -50, max: 50, step: 1, value: bright, attrs: { 'aria-label': 'Brillo' } });
    const sc = h('input', { type: 'range', min: -50, max: 50, step: 1, value: contrast, attrs: { 'aria-label': 'Contraste' } });
    const allChk = h('input', { type: 'checkbox', checked: applyAll });
    const reset = h('button', { class: 'btn small ghost', attrs: { type: 'button' }, text: 'Restablecer', on: { click: () => { sb.value = 0; sc.value = 0; bright = contrast = 0; preview(); } } });
    async function preview() {
      const my = ++tick;
      const r = await applyFilter(mid, { filter: sel, bright, contrast });
      if (my !== tick || closed) return;
      live.width = r.width; live.height = r.height; live.getContext('2d').drawImage(r, 0, 0); live.hidden = false;
    }
    sb.addEventListener('input', () => { bright = +sb.value; preview(); }); sc.addEventListener('input', () => { contrast = +sc.value; preview(); });
    const okBtn = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('check', 's'), 'Aplicar');
    const body = h('div', {}, chips, h('label', { class: 'field' }, h('span', { text: 'Brillo' }), sb), h('label', { class: 'field' }, h('span', { text: 'Contraste' }), sc), pages.length > 1 ? h('label', { class: 'check' }, allChk, h('span', { text: 'Aplicar a todas las páginas' })) : null, h('div', { class: 'btn-row' }, reset));
    let applied = false;
    const sheet = openSheet({ title: 'Filtros', body, foot: [okBtn], onClose: () => { if (!applied) live.hidden = true; } });
    sheet.el.classList.add('flt-sheet');
    okBtn.addEventListener('click', async () => {
      applied = true; sheet.close();
      const patch = { filter: sel, bright, contrast };
      await withBusy(allChk.checked && pages.length > 1 ? 'Aplicando a todas las páginas…' : 'Aplicando filtro…', async () => {
        if (allChk.checked && pages.length > 1) { pages = await updateAllPages(doc, patch); }
        else await updatePage(p, patch);
      });
      for (const q of pages) q.updatedKey = Date.now() + Math.random();
      doc = await getDoc(doc.id); await commit(); refresh();
    });
    preview();
  }
  function doOrder() {
    if (pages.length < 2) { toast('Con una sola página no hay nada que ordenar.', 'info'); return; }
    let order = pages.map((p) => p.id);
    const grid = h('div', { class: 'ord-grid' });
    const draw = () => {
      grid.textContent = '';
      order.forEach((id, i) => {
        const p = pages.find((x) => x.id === id);
        grid.append(h('div', { class: 'ord' }, h('img', { src: url(p.thumb, 'th:' + p.id + ':' + p.thumb.size), alt: `Página ${i + 1}`, draggable: false }),
          h('div', { class: 'ord-bar' }, h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Mover antes', disabled: i === 0 }, on: { click: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } } }, icon('back', 's')), h('span', { text: String(i + 1) }), h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Mover después', disabled: i === order.length - 1 }, on: { click: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } } }, icon('next', 's')))));
      });
    };
    const okBtn = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('check', 's'), 'Guardar orden');
    const sheet = openSheet({ title: 'Ordenar páginas', body: h('div', {}, h('p', { class: 'hint', text: 'Usa las flechas para mover cada página.' }), grid), foot: [okBtn] });
    draw();
    okBtn.addEventListener('click', async () => { sheet.close(); const cid = cur().id; pages = await reorderPages(doc, order); doc = await getDoc(doc.id); idx = Math.max(0, pages.findIndex((p) => p.id === cid)); refresh(); toast('Orden guardado', 'ok'); });
  }
  function addMenu() {
    menuSheet('Añadir páginas', [
      { icon: 'scan', label: 'Escanear con la cámara', run: () => openScanner({ onDone: async (items) => { await withBusy('Añadiendo páginas…', () => appendPages(doc, items)); await reload(pages.length); }, onCancel: () => {} }) },
      { icon: 'image', label: 'Importar imágenes', run: () => { fileIn.accept = 'image/*'; fileIn.click(); } },
    ]);
  }
  async function reload(focusIdx) { doc = await getDoc(doc.id); pages = await docPages(doc); idx = Math.min(focusIdx ?? idx, pages.length - 1); dropUrls(); refresh(); }
  fileIn.addEventListener('change', async () => {
    const files = [...fileIn.files].filter((f) => /^image\//.test(f.type)); fileIn.value = '';
    if (!files.length) return;
    const first = pages.length;
    await withBusy('Importando imágenes…', async () => {
      const items = [];
      for (const f of files) { const bmp = await createImageBitmap(f); const c = canvasOf(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close(); const big = scaled(c, 3400); items.push({ canvas: big, quad: await detectQuad(big).catch(() => null) }); }
      await appendPages(doc, items);
    });
    await reload(first);
  });

  titleBtn.addEventListener('click', rename);
  async function rename() { const t = await promptBox({ title: 'Cambiar nombre', value: doc.title, label: 'Nombre del documento' }); if (!t) return; doc.title = safeName(t); await saveDoc(doc); drawStage(); }
  exportBtn.addEventListener('click', () => openExport(doc, { pages }));
  moreBtn.addEventListener('click', () => menuSheet(doc.title, [
    { icon: 'share', label: 'Exportar o compartir', run: () => openExport(doc, { pages }) },
    { icon: 'download', label: 'Guardar como PDF', run: () => openExport(doc, { pages, mode: 'save' }) },
    { icon: 'edit', label: 'Cambiar nombre', run: rename },
    { icon: 'filter', label: 'Aplicar un filtro a todas las páginas', run: () => doFilters(true) },
    { icon: 'trash', label: 'Eliminar documento', danger: true, run: async () => { if (await confirmBox({ title: '¿Eliminar el documento?', text: `«${doc.title}» se borrará de este dispositivo.`, ok: 'Eliminar', danger: true })) { await deleteDoc(doc.id); toast('Documento eliminado', 'ok'); pop(); } } },
  ]));

  drawTools(); refresh();
  return { close: () => pop(), state: () => ({ idx, pages: pages.length, doc }) };
}
