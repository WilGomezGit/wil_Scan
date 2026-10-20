// Auditor de diseño. Se inyecta en la página y devuelve una lista de problemas:
//   overlap   · controles interactivos que se solapan
//   overflow  · elementos que se salen de su contenedor o de la ventana, o texto que desborda su botón
//   spacing   · controles contiguos sin margen
//   contrast  · texto con poco contraste frente a su fondo (WCAG: 4.5:1, o 3:1 para texto grande)
// Uso:  const issues = await wc.executeJavaScript('(' + AUDIT.toString() + ')(' + JSON.stringify(opts) + ')')
function AUDIT(opts) {
  opts = opts || {};
  const IGNORE = opts.ignore || ['.handle', '.h', '.drag', '.glow', '.ring', '.track', '.playhead', '.selrange', '.pickdim', '.picksel'];
  const issues = [];
  const add = (type, el, msg, extra) => issues.push({ type, el: describe(el), msg, ...(extra || {}) });
  const describe = (el) => {
    if (!el || !el.tagName) return '?';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return t ? `${s} "${t}"` : s;
  };
  const ignored = (el) => IGNORE.some((sel) => { try { return el.matches(sel) || el.closest(sel); } catch { return false; } });
  const inScope = (el) => !opts.scope || !!el.closest(opts.scope);     // opts.scope: solo se audita lo que hay dentro de ese contenedor
  const visible = (el) => {
    if (!inScope(el)) return false;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  };
  const rect = (el) => el.getBoundingClientRect();
  // ¿está el elemento tapado por otro (p. ej. la biblioteca bajo el editor a pantalla completa)? Lo tapado no se ve: no cuenta.
  const occluded = (el) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;     // fuera de pantalla: lo decide el resto de comprobaciones
    const top = document.elementFromPoint(x, y);
    return !!top && !el.contains(top) && !top.contains(el) && getComputedStyle(top).pointerEvents !== 'none';
  };

  // ---------- contraste ----------
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined || Number.isNaN(p[3]) ? 1 : p[3] };
  };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  // posibles colores de fondo efectivos (un degradado aporta varios)
  const backgrounds = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const img = cs.backgroundImage;
      if (img && img !== 'none') {
        const stops = [...img.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])).filter(Boolean);
        if (stops.length) { layers.push({ stops }); if (stops.every((c) => c.a >= 0.99)) break; }
        else layers.push({ unknown: true });
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push({ solid: c }); if (c.a >= 0.99) break; }
    }
    let cands = [{ r: 11, g: 11, b: 18, a: 1 }];            // base: el fondo del documento
    const bodyBg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (bodyBg && bodyBg.a > 0) cands = [blend(bodyBg, { r: 255, g: 255, b: 255, a: 1 })];
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (L.unknown) return null;                             // imagen/vídeo: no se puede medir
      cands = L.solid ? cands.map((b) => blend(L.solid, b)) : cands.flatMap((b) => L.stops.map((s) => blend(s, b)));
    }
    return cands;
  };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);

  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('script,style,video,canvas,svg') || !visible(el) || occluded(el)) continue;
    const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'radio';
    if (!ownText(el) && !isField) continue;
    if (el.matches('option')) continue;
    const cs = getComputedStyle(el);
    let fg = parse(cs.color);
    if (!fg) continue;
    const bgs = backgrounds(el);
    if (!bgs) continue;
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : (el.disabled ? 3 : 4.5);
    let worst = Infinity;
    for (const bg of bgs) { const f = blend(fg, bg); worst = Math.min(worst, ratio(f, bg)); }
    if (worst < need) add('contrast', el, `contraste ${worst.toFixed(2)}:1 (mínimo ${need}:1)`, { ratio: +worst.toFixed(2), color: cs.color });
  }
  // texto de ayuda de los campos
  for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (!visible(el)) continue;
    const bgs = backgrounds(el), cs = getComputedStyle(el, '::placeholder'), fg = parse(cs.color);
    if (!bgs || !fg) continue;
    const worst = Math.min(...bgs.map((bg) => ratio(blend(fg, bg), bg)));
    if (worst < 3) add('contrast', el, `el texto de ayuda tiene contraste ${worst.toFixed(2)}:1 (mínimo 3:1)`);
  }

  // ---------- solapes entre controles ----------
  const ctrls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=slider], summary')].filter((e) => visible(e) && !ignored(e) && !occluded(e));
  for (let i = 0; i < ctrls.length; i++) {
    for (let j = i + 1; j < ctrls.length; j++) {
      const a = ctrls[i], b = ctrls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const A = rect(a), B = rect(b);
      const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (w > 2 && h > 2) add('overlap', a, `se solapa con ${describe(b)} (${Math.round(w)}×${Math.round(h)} px)`);
    }
  }

  // ---------- controles pegados (sin margen) ----------
  const MIN_GAP = opts.minGap == null ? 3 : opts.minGap;
  for (let i = 0; i < ctrls.length; i++) {
    for (let j = i + 1; j < ctrls.length; j++) {
      const a = ctrls[i], b = ctrls[j];
      if (a.contains(b) || b.contains(a) || a.parentElement !== b.parentElement) continue;
      const A = rect(a), B = rect(b);
      const vOverlap = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      const hOverlap = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      if (vOverlap > 4) { const gap = Math.max(B.left - A.right, A.left - B.right); if (gap >= 0 && gap < MIN_GAP) add('spacing', a, `está pegado a ${describe(b)} (${gap.toFixed(1)} px)`); }
      else if (hOverlap > 4) { const gap = Math.max(B.top - A.bottom, A.top - B.bottom); if (gap >= 0 && gap < MIN_GAP) add('spacing', a, `está pegado a ${describe(b)} (${gap.toFixed(1)} px)`); }
    }
  }

  // ---------- desbordes ----------
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const doc = document.scrollingElement || document.documentElement;
  if (!opts.allowHScroll && doc.scrollWidth > vw + 1) add('overflow', document.body, `la página tiene scroll horizontal (${doc.scrollWidth}px > ${vw}px)`);
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('script,style,svg') || !visible(el) || ignored(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && !/^(toast|countdown)/.test(el.id || '')) { /* los fijos se comprueban contra la ventana */ }
    const r = rect(el);
    // texto que desborda su propia caja (botones, etiquetas, chips)
    if (/^(BUTTON|LABEL|SPAN|B|SMALL|A|OPTION)$/.test(el.tagName) && ownText(el) && cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.display !== 'inline') {
      add('overflow', el, `el texto se sale de su caja (${el.scrollWidth}px > ${el.clientWidth}px)`);
    }
    // hijo que sobresale de un contenedor que no hace scroll ni recorta
    const p = el.parentElement;
    if (p && p !== document.body && p !== document.documentElement) {
      const pc = getComputedStyle(p), pr = rect(p);
      const clips = /(hidden|auto|scroll|clip)/.test(pc.overflowX + pc.overflowY);
      if (!clips && cs.position !== 'absolute' && cs.position !== 'fixed' && pr.width > 0 && pr.height > 0 && pc.display !== 'contents') {
        const out = [r.right - pr.right, pr.left - r.left, r.bottom - pr.bottom, pr.top - r.top].map((x) => Math.round(x));
        if (out[0] > 2 || out[1] > 2) add('overflow', el, `sobresale de ${describe(p)} por ${Math.max(out[0], out[1])} px`);
        else if (el.tagName === 'BUTTON' && (out[2] > 2 || out[3] > 2)) add('overflow', el, `sobresale de ${describe(p)} en vertical por ${Math.max(out[2], out[3])} px`);
      }
    }
    // controles fuera de la ventana
    if (/^(BUTTON|SELECT|INPUT|TEXTAREA|A)$/.test(el.tagName) && !el.closest('[data-scroll],.view,.ed-main,.ed-export,.picker')) {
      if (r.right > vw + 1 || r.left < -1) add('overflow', el, `queda fuera de la ventana (${Math.round(r.left)}–${Math.round(r.right)} de ${vw})`);
    }
  }
  // controles cortados por un contenedor con scroll horizontal oculto
  for (const el of document.querySelectorAll('button, select, input, textarea')) {
    if (!visible(el) || ignored(el)) continue;
    const r = rect(el);
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pc = getComputedStyle(p);
      if (/(hidden|clip)/.test(pc.overflowX)) { const pr = rect(p); if (r.right > pr.right + 1 || r.left < pr.left - 1) add('overflow', el, `lo recorta ${describe(p)}`); break; }
    }
  }
  // quitar duplicados
  const seen = new Set();
  return issues.filter((i) => { const k = i.type + '|' + i.el + '|' + i.msg; if (seen.has(k)) return false; seen.add(k); return true; });
}
module.exports = { AUDIT, source: (opts) => '(' + AUDIT.toString() + ')(' + JSON.stringify(opts || {}) + ')' };
