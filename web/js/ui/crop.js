// Recorte con 4 esquinas arrastrables sobre la foto original (con detección automática y «toda la imagen»).
import { h, icon, toast, pushLayer } from '../lib/dom.js';
import { blobToCanvas, scaled } from '../core/pages.js';
import { detectQuad } from '../core/detect.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const full = () => [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]];
function isConvex(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (!z) return false; if (!s) s = Math.sign(z); else if (Math.sign(z) !== s) return false; }
  return true;
}

// Devuelve una promesa: el quad nuevo (4 puntos normalizados), null si se elige «toda la imagen», o undefined si se cancela.
// page: { orig (Blob) o canvas (lienzo), quad }. opts: { ok, cancel, title, hint } para cambiar los textos (p. ej. «Confirmar» / «Repetir»).
export function openCropper(page, opts = {}) {
  return new Promise(async (resolve) => {
    let result, done = false, q = page.quad ? page.quad.map((p) => [...p]) : null, drag = -1, dims = { w: 1, h: 1 };
    const stage = h('div', { class: 'crop-stage' });
    // la foto se muestra como imagen: en el WebView de Android un canvas redimensionado en pantalla se veía vacío (se recortaba a ciegas)
    const img = h('img', { class: 'crop-img', alt: 'Foto a recortar', draggable: false });
    const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'crop-svg');
    const poly = document.createElementNS(SVGNS, 'polygon'); poly.setAttribute('class', 'crop-poly'); svg.append(poly);
    const handles = [0, 1, 2, 3].map((i) => { const c = document.createElementNS(SVGNS, 'circle'); c.setAttribute('class', 'crop-h'); c.setAttribute('r', '15'); c.dataset.i = i; svg.append(c); return c; });
    stage.append(img, svg);
    const autoBtn = h('button', { class: 'btn', attrs: { type: 'button' } }, icon('wand', 's'), 'Auto');
    const allBtn = h('button', { class: 'btn', attrs: { type: 'button' } }, icon('crop', 's'), 'Toda la imagen');
    const cancelBtn = h('button', { class: 'btn', attrs: { type: 'button' }, text: opts.cancel || 'Cancelar' });
    const okBtn = h('button', { class: 'btn primary', attrs: { type: 'button' } }, icon('check', 's'), opts.ok || 'Aplicar');
    const root = h('div', { class: 'crop', attrs: { role: 'dialog', 'aria-label': 'Recortar' } },
      h('div', { class: 'crop-bar' }, h('strong', { text: opts.title || 'Ajusta las esquinas' }), h('span', { class: 'hint', text: opts.hint || 'Arrastra los puntos hasta los bordes del documento' })),
      stage, h('div', { class: 'crop-foot' }, autoBtn, allBtn, cancelBtn, okBtn));
    document.body.append(root);
    const finish = (v) => { if (done) return; done = true; root.remove(); window.removeEventListener('resize', layout); resolve(v); };
    const pop = pushLayer(() => finish(result));
    cancelBtn.addEventListener('click', () => pop());

    const src = scaled(page.canvas || await blobToCanvas(page.orig), 1600);
    dims = { w: src.width, h: src.height };
    img.src = src.toDataURL('image/jpeg', 0.85);
    if (!q) { try { q = await detectQuad(src, { maxSide: 520 }); } catch { q = null; } if (!q) q = full(); }

    let box = { x: 0, y: 0, w: 1, h: 1 };
    function layout() {
      const r = stage.getBoundingClientRect(), k = Math.min(r.width / dims.w, r.height / dims.h) * 0.98;
      box = { w: dims.w * k, h: dims.h * k, x: (r.width - dims.w * k) / 2, y: (r.height - dims.h * k) / 2 };
      img.style.width = box.w + 'px'; img.style.height = box.h + 'px'; img.style.left = box.x + 'px'; img.style.top = box.y + 'px';
      svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`); svg.setAttribute('width', r.width); svg.setAttribute('height', r.height);
      paint();
    }
    const pt = (p) => [box.x + p[0] * box.w, box.y + p[1] * box.h];
    function paint() {
      poly.setAttribute('points', q.map((p) => pt(p).join(',')).join(' '));
      handles.forEach((c, i) => { const [x, y] = pt(q[i]); c.setAttribute('cx', x); c.setAttribute('cy', y); });
    }
    const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    svg.addEventListener('pointerdown', (e) => {
      const [x, y] = local(e); let best = -1, bd = 46;
      q.forEach((p, i) => { const [px, py] = pt(p), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { drag = best; svg.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    svg.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const [x, y] = local(e);
      q[drag] = [Math.min(1, Math.max(0, (x - box.x) / box.w)), Math.min(1, Math.max(0, (y - box.y) / box.h))];
      paint();
    });
    const end = () => { drag = -1; };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    window.addEventListener('resize', layout);
    layout();

    autoBtn.addEventListener('click', async () => { const f = await detectQuad(src, { maxSide: 520 }).catch(() => null); if (f) { q = f; paint(); toast('Documento detectado', 'ok', 1800); } else toast('No se detectó el borde. Ajusta las esquinas a mano.', 'info'); });
    allBtn.addEventListener('click', () => { q = full(); paint(); });
    okBtn.addEventListener('click', () => {
      if (!isConvex(q)) { toast('Las esquinas se cruzan: colócalas en orden alrededor del documento.', 'error', 4500); return; }
      const isFull = q.every((p, i) => Math.abs(p[0] - full()[i][0]) < 0.001 && Math.abs(p[1] - full()[i][1]) < 0.001);
      result = isFull ? null : q; pop();
    });
  });
}
