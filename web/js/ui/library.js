// Pantalla de inicio: búsqueda, accesos rápidos (escanear, importar, herramientas…) y la lista de documentos recientes con selección múltiple,
// menú por documento y acciones en lote.
import { h, icon, $, toast, confirmBox, promptBox, menuSheet, emptyState, fmtDate, safeName, withBusy } from '../lib/dom.js';
import { listDocs, saveDoc, deleteDoc, getDoc } from '../core/db.js';
import { mergeDocs } from '../core/docs.js';
import { openExport } from './export-flow.js';

let cbs = {}, docs = [], query = '', selecting = false, selected = new Set(), urls = [];

export function initLibrary(callbacks) {
  cbs = callbacks;
  const root = $('#v-docs');
  // accesos rápidos: lo que más se usa, a un toque (el color de cada uno ayuda a encontrarlo de un vistazo)
  const QUICK = [
    ['scan', 'Escanear', 'c1', () => cbs.onScan()],
    ['idcard', 'Identificación', 'c2', () => cbs.onScanId()],
    ['image', 'Importar imágenes', 'c3', () => cbs.onImport()],
    ['upload', 'Importar PDF', 'c4', () => cbs.onTool('importpdf')],
    ['text', 'Sacar texto', 'c5', () => cbs.onTool('img2txt')],
    ['sign', 'Firmar PDF', 'c6', () => cbs.onTool('sign')],
    ['merge', 'Unir PDF', 'c7', () => cbs.onTool('merge')],
    ['grid', 'Todas las herramientas', 'c8', () => cbs.onTools()],
  ];
  root.append(
    h('div', { class: 'search' }, icon('search', 's'), h('input', { id: 'search', type: 'search', placeholder: 'Buscar documentos', attrs: { 'aria-label': 'Buscar documentos', autocomplete: 'off' }, on: { input: (e) => { query = e.target.value.trim().toLowerCase(); draw(); } } })),
    h('div', { class: 'quick', attrs: { role: 'list' } }, QUICK.map(([ic, label, c, run]) => h('button', { class: 'q ' + c, attrs: { type: 'button', role: 'listitem' }, on: { click: run } }, h('span', { class: 'q-ic' }, icon(ic)), h('span', { class: 'q-tx', text: label })))),
    h('div', { class: 'recent-head' }, h('h2', { text: 'Recientes' }),
      h('button', { id: 'btnSelect', class: 'btn small ghost', attrs: { type: 'button' }, on: { click: toggleSelect } }, icon('select', 's'), 'Seleccionar')),
    h('div', { id: 'docGrid', class: 'doc-list' }),
    h('div', { id: 'selBar', class: 'selbar', hidden: true }));
  refreshDocs();
}

export async function refreshDocs() { docs = await listDocs(); draw(); }

function toggleSelect() { selecting = !selecting; selected.clear(); draw(); }

function visibleDocs() { return docs.filter((d) => !query || d.title.toLowerCase().includes(query)); }

function draw() {
  const grid = $('#docGrid'); if (!grid) return;
  urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
  grid.textContent = '';
  $('#btnSelect').textContent = ''; $('#btnSelect').append(icon(selecting ? 'close' : 'select', 's'), selecting ? 'Cancelar' : 'Seleccionar');
  $('#btnSelect').hidden = !docs.length;
  const list = visibleDocs();
  if (!docs.length) {
    grid.className = '';
    grid.append(emptyState({ iconName: 'scan', title: 'Aún no hay documentos', text: 'Escanea tu primer documento con la cámara o importa fotos y PDF desde tu dispositivo. Todo se queda en tu equipo.', action: h('div', { class: 'btn-row center' }, h('button', { class: 'btn primary', attrs: { type: 'button' }, on: { click: () => cbs.onScan() } }, icon('scan', 's'), 'Escanear'), h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => cbs.onImport() } }, icon('image', 's'), 'Importar')) }));
    drawSelBar(); return;
  }
  grid.className = 'doc-list';
  if (!list.length) { grid.className = ''; grid.append(h('p', { class: 'hint center', text: 'Ningún documento coincide con la búsqueda.' })); drawSelBar(); return; }
  for (const d of list) {
    let url = null;
    if (d.cover) { url = URL.createObjectURL(d.cover); urls.push(url); }
    const sel = selected.has(d.id);
    const act = () => (selecting ? pick(d.id) : cbs.onOpen(d.id));
    const label = (selecting ? 'Seleccionar ' : 'Abrir ') + d.title;
    const pages = d.pageCount === 1 ? '1 página' : `${d.pageCount} páginas`;
    const card = h('div', { class: 'doc' + (sel ? ' sel' : ''), data: { id: d.id } },
      h('button', { class: 'doc-open', attrs: { type: 'button', 'aria-label': label }, on: { click: act } },
        h('span', { class: 'doc-thumb' }, url ? h('img', { src: url, alt: '', loading: 'lazy', draggable: false }) : icon('file', 'l')),
        h('span', { class: 'doc-info' }, h('span', { class: 'doc-title', text: d.title }), h('span', { class: 'doc-meta' }, fmtDate(d.updated || d.created), h('span', { class: 'doc-n' }, icon('file', 's'), pages)))),
      selecting ? h('span', { class: 'doc-check' + (sel ? ' on' : ''), attrs: { 'aria-hidden': 'true' } }, sel ? icon('check', 's') : null)
        : h('button', { class: 'icon-btn doc-more', attrs: { type: 'button', 'aria-label': 'Más acciones de ' + d.title }, on: { click: () => docMenu(d) } }, icon('more')));
    grid.append(card);
  }
  drawSelBar();
}

function pick(id) { selected.has(id) ? selected.delete(id) : selected.add(id); draw(); }

function drawSelBar() {
  const bar = $('#selBar'); bar.textContent = '';
  bar.hidden = !selecting;
  if (!selecting) return;
  const n = selected.size;
  bar.append(h('span', { class: 'selcount', text: n ? `${n} seleccionado${n > 1 ? 's' : ''}` : 'Elige documentos' }),
    h('button', { class: 'btn small', attrs: { type: 'button', disabled: n < 2 }, on: { click: doMerge } }, icon('merge', 's'), 'Unir'),
    h('button', { class: 'btn small', attrs: { type: 'button', disabled: n !== 1 }, on: { click: () => { const d = docs.find((x) => selected.has(x.id)); if (d) openExport(d); } } }, icon('share', 's'), 'Compartir'),
    h('button', { class: 'btn small danger', attrs: { type: 'button', disabled: !n }, on: { click: doDelete } }, icon('trash', 's'), 'Eliminar'));
}

async function doMerge() {
  const ids = docs.filter((d) => selected.has(d.id)).map((d) => d.id);
  const title = await promptBox({ title: 'Unir documentos', label: 'Nombre del documento nuevo', value: 'Unido ' + new Date().toLocaleDateString('es') });
  if (!title) return;
  await withBusy('Uniendo documentos…', () => mergeDocs(ids, safeName(title)));
  selecting = false; selected.clear(); await refreshDocs(); toast('Documentos unidos', 'ok');
}

async function doDelete() {
  const n = selected.size;
  if (!(await confirmBox({ title: `¿Eliminar ${n} documento${n > 1 ? 's' : ''}?`, text: 'Se borrarán de este dispositivo y no se podrán recuperar.', ok: 'Eliminar', danger: true }))) return;
  for (const id of selected) await deleteDoc(id);
  selecting = false; selected.clear(); await refreshDocs(); toast('Eliminado', 'ok');
}

function docMenu(d) {
  menuSheet(d.title, [
    { icon: 'docs', label: 'Abrir', run: () => cbs.onOpen(d.id) },
    { icon: 'share', label: 'Exportar o compartir', run: () => openExport(d) },
    { icon: 'edit', label: 'Cambiar nombre', run: async () => { const t = await promptBox({ title: 'Cambiar nombre', value: d.title, label: 'Nombre' }); if (t) { const cur = await getDoc(d.id); cur.title = safeName(t); await saveDoc(cur); refreshDocs(); } } },
    { icon: 'trash', label: 'Eliminar', danger: true, run: async () => { if (await confirmBox({ title: '¿Eliminar este documento?', text: `«${d.title}» se borrará de este dispositivo.`, ok: 'Eliminar', danger: true })) { await deleteDoc(d.id); refreshDocs(); toast('Eliminado', 'ok'); } } },
  ]);
}
