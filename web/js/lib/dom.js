// Utilidades de interfaz: crear elementos, iconos, avisos, diálogos, hojas inferiores y pantalla de progreso.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ICONS = new URL('../../assets/icons.svg', import.meta.url).href;
const SVGNS = 'http://www.w3.org/2000/svg';

// h('button', { class:'btn', on:{click}, attrs:{type:'button'}, text:'Hola' }, hijo1, 'texto', …)
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'attrs') for (const [a, val] of Object.entries(v)) { if (val !== false && val != null) el.setAttribute(a, val === true ? '' : val); }
    else if (k === 'data') Object.assign(el.dataset, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', ('i ' + cls).trim()); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('viewBox', '0 0 24 24');
  const use = document.createElementNS(SVGNS, 'use'); use.setAttribute('href', ICONS + '#' + name);
  svg.append(use);
  return svg;
}

export const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
export function fmtDate(t) {
  const d = new Date(t), now = new Date(), same = (a, b) => a.toDateString() === b.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (same(d, now)) return 'Hoy ' + hm;
  if (same(d, y)) return 'Ayer ' + hm;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
export const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`; };
export const safeName = (s) => String(s || 'Documento').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Documento';
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- aviso breve ----
let toastTimer = 0;
export function toast(msg, type = 'info', ms = 3600) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast', attrs: { role: 'status', 'aria-live': 'polite' } }); document.body.append(t); }
  t.textContent = msg; t.className = 'toast ' + type; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- capas con soporte del botón «atrás» (Android, navegador) ----
// Una sola entrada de historial mientras haya capas abiertas: «atrás» cierra la de arriba y se vuelve a armar si quedan.
// Al cerrar por código la última capa, la entrada se retira un instante después (si se abre otra enseguida, se reutiliza).
const layers = [];
let armed = false, ignoreNext = false, pendingBack = 0;
const arm = () => { if (pendingBack) { clearTimeout(pendingBack); pendingBack = 0; return; } if (!armed) { history.pushState({ wilscanLayer: 1 }, ''); armed = true; } };
window.addEventListener('popstate', () => {
  armed = false;
  if (ignoreNext) { ignoreNext = false; return; }
  const top = layers.pop();
  if (top) top.close(true);
  if (layers.length) { history.pushState({ wilscanLayer: 1 }, ''); armed = true; }
});
export function pushLayer(close) {
  const layer = { close: (fromPop) => {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    close();
    if (!fromPop && !layers.length && armed && !pendingBack) pendingBack = setTimeout(() => { pendingBack = 0; if (!layers.length && armed) { ignoreNext = true; armed = false; history.back(); } }, 60);
  } };
  layers.push(layer);
  arm();
  return () => layer.close(false);
}
export const topLayerCount = () => layers.length;

// ---- hoja inferior (modal en pantallas grandes) ----
export function openSheet({ title = '', body = null, foot = null, onClose = null, dismissable = true } = {}) {
  const bodyEl = h('div', { class: 'sheet-body' }, body);
  const closeBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Cerrar' } }, icon('close'));
  const sheet = h('div', { class: 'sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } },
    h('div', { class: 'sheet-head' }, h('h2', { text: title }), dismissable ? closeBtn : null), bodyEl, foot ? h('div', { class: 'sheet-foot' }, foot) : null);
  const back = h('div', { class: 'backdrop' }, sheet);
  let closed = false;
  const doClose = () => { if (closed) return; closed = true; back.remove(); if (onClose) onClose(); };
  const pop = pushLayer(doClose);
  closeBtn.addEventListener('click', () => pop());
  if (dismissable) back.addEventListener('pointerdown', (e) => { if (e.target === back) pop(); });
  document.body.append(back);
  return { el: sheet, body: bodyEl, close: () => pop(), setTitle: (t) => { sheet.querySelector('h2').textContent = t; } };
}

export function menuSheet(title, items) {
  const m = h('div', { class: 'menu' });
  const s = openSheet({ title, body: m });
  for (const it of items) {
    if (!it) continue;
    m.append(h('button', { class: it.danger ? 'danger' : '', attrs: { type: 'button' }, on: { click: () => { s.close(); setTimeout(it.run, 30); } } }, icon(it.icon || 'info'), it.label));
  }
  return s;
}

export function confirmBox({ title, text = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const okBtn = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), attrs: { type: 'button' }, text: ok });
    const noBtn = h('button', { class: 'btn', attrs: { type: 'button' }, text: cancel });
    const s = openSheet({ title, body: h('p', { class: 'hint', text }), foot: [noBtn, okBtn], onClose: () => resolve(answer) });
    okBtn.addEventListener('click', () => { answer = true; s.close(); });
    noBtn.addEventListener('click', () => s.close());
  });
}

export function promptBox({ title, label = '', value = '', ok = 'Guardar', placeholder = '', maxLength = 120 }) {
  return new Promise((resolve) => {
    let answer = null;
    const input = h('input', { type: 'text', value, placeholder, maxLength, attrs: { 'aria-label': label || title, autocomplete: 'off' } });
    const okBtn = h('button', { class: 'btn primary', attrs: { type: 'button' }, text: ok });
    const noBtn = h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Cancelar' });
    const s = openSheet({ title, body: h('label', { class: 'field' }, label ? h('span', { text: label }) : null, input), foot: [noBtn, okBtn], onClose: () => resolve(answer) });
    const done = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } answer = v; s.close(); };
    okBtn.addEventListener('click', done); noBtn.addEventListener('click', () => s.close());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
    setTimeout(() => { input.focus(); input.select(); }, 60);
  });
}

// Pantalla de progreso que bloquea la interfaz: const b = busy('Procesando…'); b.update('texto', 0.4); b.close();
export function busy(text = 'Procesando…') {
  const fill = h('i'), msg = h('p', { text }), bar = h('div', { class: 'bar' }, fill);
  bar.hidden = true;
  const el = h('div', { class: 'busy', attrs: { role: 'alert', 'aria-live': 'polite' } }, h('div', { class: 'busy-box' }, h('div', { class: 'spin' }), msg, bar));
  document.body.append(el);
  return {
    update(t, pct) { if (t != null) msg.textContent = t; if (pct != null) { bar.hidden = false; fill.style.width = Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%'; } },
    close() { el.remove(); },
  };
}

export async function withBusy(text, fn) {
  const b = busy(text);
  try { return await fn(b); } finally { b.close(); }
}

export function emptyState({ iconName, title, text, action }) {
  return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon(iconName)), h('h2', { text: title }), h('p', { text }), action || null);
}
