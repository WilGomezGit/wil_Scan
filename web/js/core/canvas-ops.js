// Operaciones de lienzo que funcionan igual en la página y dentro de un Worker (OffscreenCanvas):
// girar, ampliar, reducir y tapar zonas. El Worker cambia la fábrica de lienzos con setCanvasFactory.
let factory = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d', { willReadFrequently: true }); return c; };
export const setCanvasFactory = (f) => { factory = f; };
export const mk = (w, h) => factory(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));

// Giro fino (ángulos pequeños) manteniendo el tamaño; el relleno de las esquinas toma el color medio del borde
export function rotateBy(c, deg) {
  if (!deg) return c;
  const out = mk(c.width, c.height), x = out.getContext('2d'), s = c.getContext('2d', { willReadFrequently: true });
  const px = [[2, 2], [c.width - 3, 2], [2, c.height - 3], [c.width - 3, c.height - 3]].map(([a, b]) => s.getImageData(a, b, 1, 1).data);
  const avg = [0, 1, 2].map((i) => Math.round(px.reduce((t, p) => t + p[i], 0) / 4));
  x.fillStyle = `rgb(${avg[0]},${avg[1]},${avg[2]})`; x.fillRect(0, 0, out.width, out.height);
  x.translate(out.width / 2, out.height / 2); x.rotate((deg * Math.PI) / 180); x.imageSmoothingQuality = 'high'; x.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export function rotateCanvas(c, deg) {
  const r = ((deg % 360) + 360) % 360;
  if (!r) return c;
  const swap = r === 90 || r === 270;
  const out = mk(swap ? c.height : c.width, swap ? c.width : c.height);
  const x = out.getContext('2d');
  x.translate(out.width / 2, out.height / 2); x.rotate((r * Math.PI) / 180); x.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export function scaled(canvas, maxSide) {
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  if (k === 1) return canvas;
  const c = mk(canvas.width * k, canvas.height * k);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

// Las fotos pequeñas se amplían (con suavizado de calidad) hasta ~1800 px: mejora lectura, OCR y PDF
export const needsEnlarge = (w, h) => Math.max(w, h) < 1500;
export function enlarge(c) {
  const m = Math.max(c.width, c.height);
  if (!needsEnlarge(c.width, c.height)) return c;
  const k = Math.min(2.5, 1800 / m), o = mk(c.width * k, c.height * k), x = o.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, o.width, o.height);
  return o;
}

// Zonas ocultas: marks = [{ x, y, w, h, t }] en fracciones de la imagen final; t = 'pix' (pixelar), 'blk' (tapar en negro), 'wht' (borrar en blanco)
export function applyMarks(c, marks) {
  const x = c.getContext('2d');
  for (const m of marks) {
    const px = Math.max(0, Math.round(m.x * c.width)), py = Math.max(0, Math.round(m.y * c.height));
    const pw = Math.min(c.width - px, Math.max(1, Math.round(m.w * c.width))), ph = Math.min(c.height - py, Math.max(1, Math.round(m.h * c.height)));
    if (m.t === 'blk' || m.t === 'wht') { x.fillStyle = m.t === 'blk' ? '#000' : '#fff'; x.fillRect(px, py, pw, ph); continue; }
    const cell = Math.max(10, Math.round(Math.max(pw, ph) / 8)), tw = Math.max(1, Math.round(pw / cell)), th = Math.max(1, Math.round(ph / cell));
    const t = mk(tw, th), tx = t.getContext('2d');
    tx.imageSmoothingEnabled = true; tx.drawImage(c, px, py, pw, ph, 0, 0, tw, th);
    x.imageSmoothingEnabled = false; x.drawImage(t, 0, 0, tw, th, px, py, pw, ph); x.imageSmoothingEnabled = true;
  }
  return c;
}
