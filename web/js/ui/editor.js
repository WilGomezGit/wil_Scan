// Editor de documento: ver páginas, recortar, filtros, girar, texto, ordenar, añadir y eliminar páginas, exportar.
import { h, icon, toast, confirmBox, promptBox, menuSheet, openSheet, withBusy, pushLayer, safeName } from '../lib/dom.js';
import { getDoc, getPage, saveDoc, deleteDoc } from '../core/db.js';
import { docPages, appendPages, removePage, updatePage, updateAllPages, reorderPages, rotatePage, finishLater } from '../core/docs.js';
import { scaled, toBlob, previewBlobs, blobToCanvas } from '../core/pages.js';
import { rotateCanvas } from '../core/warp.js';
import { FILTERS } from '../core/filters.js';
import { detectQuad } from '../core/detect.js';
import { canvasOf } from '../core/cv.js';
import { openCropper } from './crop.js';
import { openRedact } from './redact.js';
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
  // vista previa: una imagen (no un canvas): en el WebView de Android un canvas ya visible que cambia de tamaño se ve en blanco
  const live = h('img', { class: 'ed-img ed-live', hidden: true, alt: '', draggable: false });
  let liveTick = 0, liveUrl = null;
  const wrap = h('div', { class: 'ed-wrap' }, img);   // la vista previa (live) va fuera: ocupa todo el escenario aunque cambie la proporción (al girar)
  const prev = h('button', { class: 'icon-btn solid ed-nav l', attrs: { type: 'button', 'aria-label': 'Página anterior' } }, icon('back'));
  const next = h('button', { class: 'icon-btn solid ed-nav r', attrs: { type: 'button', 'aria-label': 'Página siguiente' } }, icon('next'));
  const counter = h('div', { class: 'ed-counter', attrs: { 'aria-live': 'polite' } });
  const prog = h('div', { class: 'ed-prog', hidden: true, attrs: { 'aria-live': 'polite' } });
  const stage = h('div', { class: 'ed-stage' }, wrap, live, prev, next, counter, prog);
  const strip = h('div', { class: 'ed-strip', attrs: { role: 'list', 'data-scroll': true } });
  const fbar = h('div', { class: 'ed-flt', attrs: { 'data-scroll': true, role: 'group', 'aria-label': 'Filtros' } });
  const tools = h('div', { class: 'ed-tools' });
  const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true });
  const root = h('div', { class: 'ed', attrs: { role: 'dialog', 'aria-label': 'Editor de documento' } },
    h('div', { class: 'ed-top' }, backBtn, titleBtn, exportBtn, moreBtn), stage, strip, fbar, tools, fileIn);
  document.body.append(root);

  // páginas importadas en borrador: cuando su imagen completa está lista se cambia sin parpadeo (y se terminan si la app se cerró antes)
  let previewing = false; const deferred = [];                    // mientras la hoja de filtros enseña su vista previa no se cambia la imagen de fondo
  const onReady = async (e) => {
    if (previewing) { deferred.push(e); return; }
    if (closed || !pages.some((p) => p.id === e.detail.id)) return;
    if (pendingN) { work.then(() => onReady(e)); return; }         // hay un cambio en curso: se aplica cuando termine
    const fresh = await getPage(e.detail.id), i = pages.findIndex((p) => p.id === e.detail.id);
    if (!fresh || closed || i < 0 || pages[i].rev === fresh.rev) return;
    Object.assign(pages[i], { out: fresh.out, thumb: fresh.thumb, w: fresh.w, h: fresh.h, rev: fresh.rev, draft: false, updatedKey: Date.now() });
    if (i === idx) drawStage();
    drawStrip();
  };
  window.addEventListener('wilscan:page', onReady);
  finishLater(pages);
  const pop = pushLayer(() => { closed = true; window.removeEventListener('wilscan:page', onReady); root.remove(); dropUrls(); if (liveUrl) URL.revokeObjectURL(liveUrl); for (const urls of fbCache.values()) urls.forEach((u) => URL.revokeObjectURL(u)); fbCache.clear(); clearTimeout(fbTimer); onClose(); });
  backBtn.addEventListener('click', () => pop());

  // ---------- pintar ----------
  const cur = () => pages[idx];
  function drawStage() {
    const p = cur();
    titleBtn.textContent = doc.title;
    // la imagen nueva se descodifica antes de quitar la vista previa: nunca se ve la anterior (ni detrás ni un instante)
    const src = url(p.out, 'out:' + p.id + ':' + (p.updatedKey || p.out.size)), my = ++stageTick;
    if (img.getAttribute('src') !== src) {
      const next = new Image(); next.src = src;
      (next.decode ? next.decode() : Promise.resolve()).catch(() => {}).then(() => {
        if (my !== stageTick || closed) return;
        img.src = src; img.classList.remove('under'); live.hidden = true; liveTick++;
      });
    } else { img.classList.remove('under'); live.hidden = true; liveTick++; }
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
    const defs = [['crop', 'Recortar', doCrop], ['filter', 'Filtros', after(() => doFilters(false))], ['rotate', 'Girar', doRotate], ['hide', 'Ocultar', after(doRedact)], ['text', 'Texto', after(() => openText(doc, pages, idx))], ['layers', 'Ordenar', after(doOrder)], ['trash', 'Eliminar', after(doDeletePage)]];
    for (const [ic, label, fn] of defs) tools.append(h('button', { class: 'ed-tool', attrs: { type: 'button' }, on: { click: fn } }, icon(ic), h('span', { text: label })));
  }
  // Carrusel de filtros: toca uno para aplicarlo a la página (o a todas), con vista previa de cada filtro sobre la página actual.
  // Todo el cálculo de imagen se hace en un Worker: aquí solo se muestran los resultados.
  let filterAll = false, fbarTick = 0, stageTick = 0;
  const fbCache = new Map();
  const showLive = (p, blob) => {
    if (!blob || closed || cur() !== p) return;
    const my = ++liveTick, u = URL.createObjectURL(blob);
    live.onload = () => {
      if (my !== liveTick || closed || cur() !== p) { URL.revokeObjectURL(u); return; }
      live.hidden = false; img.classList.add('under');
      if (liveUrl) URL.revokeObjectURL(liveUrl);
      liveUrl = u;
    };
    live.src = u;
  };
  const setProgress = (i, n) => { prog.hidden = !(n > 1); prog.textContent = n > 1 ? `${i} / ${n}` : ''; };
  // Muestra el resultado al instante (vista previa) y genera la imagen completa detrás, sin bloquear nada; al terminar todo, se refresca la página.
  // job(progreso) hace el trabajo; all: el trabajo toca todas las páginas
  function inBackground(p, preview, job, { all = false } = {}) {
    if (preview) Promise.resolve(preview).then((r) => showLive(p, r)).catch(() => {});
    return enqueue(async () => {
      await job(setProgress); setProgress(0, 0);
      for (const q of all ? pages : [p]) q.updatedKey = Date.now() + Math.random();
      doc = await getDoc(doc.id); if (all || pages[0] === p) await commit();
    }, all ? 60000 + pages.length * 30000 : 90000).then(() => { if (!pendingN) { setProgress(0, 0); if (!closed) refresh(); } });
  }
  // antes de exportar, leer el texto, ordenar o borrar, se termina lo que esté pendiente (para no usar una imagen vieja)
  const after = (fn) => async (...a) => { if (pendingN) await withBusy('Terminando los cambios…', () => work); return fn(...a); };
  // las operaciones pesadas se hacen de una en una y sin bloquear la pantalla
  // El círculo de la esquina refleja SIEMPRE cuántas tareas hay pendientes (nada lo pone o quita a mano) y ninguna tarea puede quedarse
  // esperando para siempre: pasado su tiempo máximo se da por fallida, se avisa y la cola sigue (lo que quedara a medias termina solo detrás).
  let work = Promise.resolve(), pendingN = 0;
  const syncSpinner = () => stage.classList.toggle('working', pendingN > 0);
  const enqueue = (fn, ms = 90000) => {
    pendingN++; syncSpinner();
    const guarded = () => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Esto tardó demasiado. Inténtalo de nuevo.')), ms);
      Promise.resolve().then(fn).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
    return (work = work.then(guarded).catch((e) => toast(e.message || 'No se pudo completar', 'error')).finally(() => { pendingN--; syncSpinner(); }));
  };
  const allPages = async (patch, progress) => { pages = await updateAllPages(doc, patch, { onProgress: progress }); };
  const specOf = (p, filter) => ({ filter, bright: p.bright || 0, contrast: p.contrast || 0 });
  function applyFilterTo(id) {
    const p = cur(), all = filterAll && pages.length > 1;
    if ((p.filter || 'auto') === id && !all) return;
    fbar.querySelectorAll('.flt').forEach((b, i) => { const on = FILTERS[i].id === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    inBackground(p, previewBlobs(p, [specOf(p, id)]).then((a) => a[0]), all ? (pr) => allPages({ filter: id }, pr) : () => updatePage(p, { filter: id }), { all });
  }
  // Las miniaturas del carrusel se calculan cuando el usuario se detiene en una página (no al pasar rápido por varias) y se guardan por
  // página: volver a una página ya vista no vuelve a calcular nada.
  let fbTimer = 0;
  function drawFilterBar() {
    const p = cur(), my = ++fbarTick, now = p.filter || 'auto';
    fbar.textContent = ''; clearTimeout(fbTimer);
    if (pages.length > 1) {
      const chk = h('input', { type: 'checkbox', checked: filterAll });
      chk.addEventListener('change', () => { filterAll = chk.checked; });
      fbar.append(h('label', { class: 'all' }, chk, h('span', { text: 'Todas' })));
    }
    const thumbs = FILTERS.map((f) => {
      const cv = h('img', { class: 'flt-prev', alt: '', draggable: false });
      fbar.append(h('button', { class: 'flt' + (f.id === now ? ' on' : ''), attrs: { type: 'button', 'aria-pressed': String(f.id === now) }, on: { click: () => applyFilterTo(f.id) } }, cv, h('span', { text: f.label })));
      return cv;
    });
    const key = [p.id, JSON.stringify(p.quad || null), p.rot || 0].join('|'), hit = fbCache.get(key);
    if (hit) { hit.forEach((u, i) => { thumbs[i].src = u; }); return; }
    fbTimer = setTimeout(() => {
      previewBlobs(p, FILTERS.map((f) => ({ filter: f.id })), { side: 160, quality: 0.8 }).then((blobs) => {
        if (closed) return;
        const urls = blobs.map((bl) => URL.createObjectURL(bl));
        fbCache.set(key, urls);
        while (fbCache.size > 12) { const k = fbCache.keys().next().value; fbCache.get(k).forEach((u) => URL.revokeObjectURL(u)); fbCache.delete(k); }
        if (my === fbarTick) urls.forEach((u, i) => { thumbs[i].src = u; });
      }).catch(() => {});
    }, 220);
  }
  const refresh = () => { drawStage(); drawStrip(); drawFilterBar(); };
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
    if (pendingN) await withBusy('Terminando los cambios…', () => work);
    const q = await openCropper(p);
    if (q === undefined) return;
    const patch = { quad: q, skew: q ? 0 : p.skew };
    if (p.marks && p.marks.length) {   // al cambiar el recorte las zonas ocultas ya no coincidirían
      if (!(await confirmBox({ title: 'Se quitarán las zonas ocultas', text: 'Al volver a recortar, las zonas pixeladas o tapadas se quitan porque ya no coincidirían. Podrás marcarlas de nuevo después.', ok: 'Recortar' }))) return;
      patch.marks = [];
    }
    inBackground(p, previewBlobs({ ...p, ...patch }, [specOf(p, p.filter || 'auto')]).then((a) => a[0]), () => updatePage(p, patch));
  }
  async function doRedact() {
    const p = cur();
    const marks = await openRedact(p);
    if (marks === undefined) return;
    inBackground(p, null, () => updatePage(p, { marks }));
  }
  async function doRotate() {
    const p = cur(), shown = !live.hidden ? live : img;
    let preview = null;                                    // lo que ya se ve en pantalla, girado (instantáneo)
    if (shown.naturalWidth || shown.width) { const k = Math.min(1, 900 / Math.max(shown.naturalWidth || shown.width, shown.naturalHeight || shown.height)); const c = canvasOf((shown.naturalWidth || shown.width) * k, (shown.naturalHeight || shown.height) * k); c.getContext('2d').drawImage(shown, 0, 0, c.width, c.height); preview = toBlob(rotateCanvas(c, 90), 'image/jpeg', 0.85); }
    inBackground(p, preview, () => rotatePage(p));
  }
  async function doDeletePage() {
    const p = cur();
    if (!(await confirmBox({ title: '¿Eliminar esta página?', text: pages.length === 1 ? 'Es la única página: se eliminará todo el documento.' : `Se eliminará la página ${idx + 1}.`, ok: 'Eliminar', danger: true }))) return;
    const left = await removePage(doc, p.id);
    if (!left) { toast('Documento eliminado', 'ok'); pop(); return; }
    pages = left; doc = await getDoc(doc.id); dropUrls('out:' + p.id); dropUrls('th:' + p.id);
    idx = Math.min(idx, pages.length - 1); refresh();
  }
  function doFilters(all) {
    const p = cur();
    let sel = p.filter || 'auto', bright = p.bright || 0, contrast = p.contrast || 0, applyAll = !!all, tick = 0;
    const chips = h('div', { class: 'flt-row', attrs: { 'data-scroll': true } });
    const chipEls = {}, chipUrls = [];
    const thumbs = FILTERS.map((f) => {
      const cv = h('img', { class: 'flt-prev', alt: '', draggable: false });
      const b = h('button', { class: 'flt' + (f.id === sel ? ' on' : ''), attrs: { type: 'button', 'aria-pressed': String(f.id === sel) }, on: { click: () => { sel = f.id; Object.entries(chipEls).forEach(([id, el]) => { el.classList.toggle('on', id === sel); el.setAttribute('aria-pressed', String(id === sel)); }); preview(); } } }, cv, h('span', { text: f.label }));
      chipEls[f.id] = b; chips.append(b);
      return cv;
    });
    previewBlobs(p, FILTERS.map((f) => ({ filter: f.id })), { side: 160, quality: 0.8 }).then((blobs) => blobs.forEach((bl, i) => { const u = URL.createObjectURL(bl); chipUrls.push(u); thumbs[i].src = u; })).catch(() => {});
    const sb = h('input', { type: 'range', min: -50, max: 50, step: 1, value: bright, attrs: { 'aria-label': 'Brillo' } });
    const sc = h('input', { type: 'range', min: -50, max: 50, step: 1, value: contrast, attrs: { 'aria-label': 'Contraste' } });
    const allChk = h('input', { type: 'checkbox', checked: applyAll });
    const reset = h('button', { class: 'btn small ghost', attrs: { type: 'button' }, text: 'Restablecer', on: { click: () => { sb.value = 0; sc.value = 0; bright = contrast = 0; preview(); } } });
    // al arrastrar un deslizador salen decenas de cambios por segundo: solo se calcula el último (una vista previa a la vez)
    let calculating = false, again = false;
    async function preview() {
      if (calculating) { again = true; return; }
      calculating = true;
      try {
        do {
          again = false; const my = ++tick;
          const [bl] = await previewBlobs(p, [{ filter: sel, bright, contrast }]);
          if (my === tick && !closed) showLive(cur(), bl);
        } while (again && !closed);
      } catch { /* sin vista previa */ }
      calculating = false;
    }
    sb.addEventListener('input', () => { bright = +sb.value; preview(); }); sc.addEventListener('input', () => { contrast = +sc.value; preview(); });
    const okBtn = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('check', 's'), 'Aplicar');
    const body = h('div', {}, chips, h('label', { class: 'field' }, h('span', { text: 'Brillo' }), sb), h('label', { class: 'field' }, h('span', { text: 'Contraste' }), sc), pages.length > 1 ? h('label', { class: 'check' }, allChk, h('span', { text: 'Aplicar a todas las páginas' })) : null, h('div', { class: 'btn-row' }, reset));
    let applied = false;
    previewing = true;
    const sheet = openSheet({ title: 'Filtros', body, foot: [okBtn], onClose: () => { previewing = false; chipUrls.forEach((u) => URL.revokeObjectURL(u)); if (!applied) { liveTick++; live.hidden = true; img.classList.remove('under'); } deferred.splice(0).forEach(onReady); } });
    sheet.el.classList.add('flt-sheet');
    okBtn.addEventListener('click', () => {
      applied = true; sheet.close();
      const patch = { filter: sel, bright, contrast }, doAll = allChk.checked && pages.length > 1;
      inBackground(p, null, doAll ? (pr) => allPages(patch, pr) : () => updatePage(p, patch), { all: doAll });   // la vista previa ya está en pantalla
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
      const items = files.map((f) => ({ draft: true, make: async () => { const big = await blobToCanvas(f, 3000); return { canvas: big, quad: await detectQuad(big).catch(() => null), draft: true }; } }));
      await appendPages(doc, items);
    });
    await reload(first);
  });

  titleBtn.addEventListener('click', rename);
  async function rename() { const t = await promptBox({ title: 'Cambiar nombre', value: doc.title, label: 'Nombre del documento' }); if (!t) return; doc.title = safeName(t); await saveDoc(doc); drawStage(); }
  exportBtn.addEventListener('click', after(() => openExport(doc, { pages })));
  moreBtn.addEventListener('click', () => menuSheet(doc.title, [
    { icon: 'share', label: 'Exportar o compartir', run: after(() => openExport(doc, { pages })) },
    { icon: 'download', label: 'Guardar como PDF', run: after(() => openExport(doc, { pages, mode: 'save' })) },
    { icon: 'edit', label: 'Cambiar nombre', run: rename },
    { icon: 'filter', label: 'Aplicar un filtro a todas las páginas', run: after(() => doFilters(true)) },
    { icon: 'trash', label: 'Eliminar documento', danger: true, run: async () => { if (await confirmBox({ title: '¿Eliminar el documento?', text: `«${doc.title}» se borrará de este dispositivo.`, ok: 'Eliminar', danger: true })) { await deleteDoc(doc.id); toast('Documento eliminado', 'ok'); pop(); } } },
  ]));

  drawTools(); refresh();
  return { close: () => pop(), state: () => ({ idx, pages: pages.length, doc }) };
}
