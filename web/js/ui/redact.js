// Ocultar datos privados: se dibujan recuadros sobre la página y, al aplicar, se pixelan, se tapan en negro o se borran en blanco.
import { h, icon, toast, pushLayer } from '../lib/dom.js';
import { blobToCanvas, scaled } from '../core/pages.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const TYPES = [['pix', 'Pixelar'], ['blk', 'Tapar en negro'], ['wht', 'Borrar']];
const el = (name, attrs = {}) => { const e = document.createElementNS(SVGNS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

// Devuelve una promesa: la lista de zonas [{ x, y, w, h, t }] (fracciones de la imagen), o undefined si se cancela.
export function openRedact(page) {
  return new Promise(async (resolve) => {
    let marks = (page.marks || []).map((m) => ({ ...m })), type = 'pix', draft = null, result, done = false, dims = { w: 1, h: 1 }, box = { x: 0, y: 0, w: 1, h: 1 };
    const stage = h('div', { class: 'crop-stage' });
    const img = h('img', { class: 'crop-img', alt: 'Página', draggable: false });
    const svg = el('svg', { class: 'crop-svg red' });
    stage.append(img, svg);
    const typeBtns = TYPES.map(([id, label]) => h('button', { class: 'btn small', attrs: { type: 'button', 'aria-pressed': 'false' }, text: label, on: { click: () => { type = id; paintTypes(); } } }));
    const paintTypes = () => typeBtns.forEach((b, i) => { const on = TYPES[i][0] === type; b.classList.toggle('primary', on); b.setAttribute('aria-pressed', String(on)); });
    const undoBtn = h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Deshacer' });
    const cancelBtn = h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Cancelar' });
    const okBtn = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('check', 's'), 'Aplicar');
    const root = h('div', { class: 'crop', attrs: { role: 'dialog', 'aria-label': 'Ocultar datos privados' } },
      h('div', { class: 'crop-bar' }, h('strong', { text: 'Ocultar datos privados' }), h('span', { class: 'hint', text: 'Dibuja un recuadro sobre lo que quieras esconder' })),
      h('div', { class: 'red-types', attrs: { role: 'group', 'aria-label': 'Tipo de ocultado' } }, typeBtns),
      stage, h('div', { class: 'crop-foot' }, undoBtn, cancelBtn, okBtn));
    document.body.append(root);
    const finish = (v) => { if (done) return; done = true; root.remove(); window.removeEventListener('resize', layout); resolve(v); };
    const pop = pushLayer(() => finish(result));
    cancelBtn.addEventListener('click', () => pop());
    paintTypes();

    const src = scaled(await blobToCanvas(page.out), 1600);
    dims = { w: src.width, h: src.height };
    img.src = src.toDataURL('image/jpeg', 0.85);

    function layout() {
      const r = stage.getBoundingClientRect(), k = Math.min(r.width / dims.w, r.height / dims.h) * 0.98;
      box = { w: dims.w * k, h: dims.h * k, x: (r.width - dims.w * k) / 2, y: (r.height - dims.h * k) / 2 };
      img.style.width = box.w + 'px'; img.style.height = box.h + 'px'; img.style.left = box.x + 'px'; img.style.top = box.y + 'px';
      svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`); svg.setAttribute('width', r.width); svg.setAttribute('height', r.height);
      paint();
    }
    const px = (m) => ({ x: box.x + m.x * box.w, y: box.y + m.y * box.h, w: m.w * box.w, h: m.h * box.h });
    const xHandles = [];
    function paint() {
      svg.textContent = ''; xHandles.length = 0;
      undoBtn.disabled = !marks.length && !draft;
      [...marks, ...(draft ? [draft] : [])].forEach((m, i) => {
        const p = px(m);
        svg.append(el('rect', { class: 'red-rect ' + m.t, x: p.x, y: p.y, width: p.w, height: p.h, rx: 3 }));
        if (m === draft) return;
        const cx = Math.min(box.x + box.w - 4, p.x + p.w), cy = Math.max(box.y + 4, p.y);
        const g = el('g', { class: 'red-x' }); g.append(el('circle', { cx, cy, r: 11 }), el('path', { d: `M${cx - 4} ${cy - 4}L${cx + 4} ${cy + 4}M${cx + 4} ${cy - 4}L${cx - 4} ${cy + 4}` }));
        svg.append(g); xHandles.push({ cx, cy, i });
      });
    }
    const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const norm = (x, y) => [Math.min(1, Math.max(0, (x - box.x) / box.w)), Math.min(1, Math.max(0, (y - box.y) / box.h))];
    let start = null;
    svg.addEventListener('pointerdown', (e) => {
      const [x, y] = local(e);
      const hit = xHandles.find((hd) => Math.hypot(hd.cx - x, hd.cy - y) < 20);
      if (hit) { marks.splice(hit.i, 1); paint(); e.preventDefault(); return; }
      start = norm(x, y); draft = { x: start[0], y: start[1], w: 0, h: 0, t: type };
      try { svg.setPointerCapture(e.pointerId); } catch { /* sin puntero activo: se sigue con los eventos normales */ }
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!start) return;
      const [x, y] = norm(...local(e));
      draft = { x: Math.min(start[0], x), y: Math.min(start[1], y), w: Math.abs(x - start[0]), h: Math.abs(y - start[1]), t: type };
      paint();
    });
    const end = () => {
      if (!start) return;
      if (draft && draft.w * box.w > 14 && draft.h * box.h > 14) marks.push(draft);
      start = null; draft = null; paint();
    };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    window.addEventListener('resize', layout);
    layout();

    undoBtn.addEventListener('click', () => { marks.pop(); paint(); });
    okBtn.addEventListener('click', () => {
      result = marks.map((m) => ({ x: +m.x.toFixed(4), y: +m.y.toFixed(4), w: +m.w.toFixed(4), h: +m.h.toFixed(4), t: m.t }));
      if (!result.length && !(page.marks || []).length) toast('Dibuja al menos un recuadro, o toca Cancelar.', 'info', 2800);
      else pop();
    });
  });
}
