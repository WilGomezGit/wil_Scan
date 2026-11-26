// Prueba del detector de bordes en JavaScript puro (web/js/core/quad.js), sin navegador:
//   node tests/core-quad.test.js
// Escenas sintéticas: un papel claro (girado, en perspectiva, con renglones de texto y sombra) sobre fondos de distinto tono, con ruido.
const path = require('path');
const { pathToFileURL } = require('url');

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  [' + d + ']' : '')); if (!ok) fails++; };

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const inside = (pts, x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

function scene(w, h) {
  const cx = w / 2 + (rnd() - 0.5) * 80, cy = h / 2 + (rnd() - 0.5) * 60, sc = 0.55 + rnd() * 0.35, pw = h * sc * 0.77, ph = h * sc, a = (rnd() - 0.5) * 0.8;
  const pts = [[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]].map(([px, py]) => { const j = 1 + (rnd() - 0.5) * 0.15; return [cx + (px * Math.cos(a) - py * Math.sin(a)) * j, cy + (px * Math.sin(a) + py * Math.cos(a)) * j]; });
  const bg = 40 + rnd() * 120, paper = 200 + rnd() * 55, shade = rnd() * 50, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = bg + (x / w) * 30;
      if (inside(pts, x, y)) {
        // coordenadas en el papel (sin girar) para los renglones
        const ux = (x - cx) * Math.cos(-a) - (y - cy) * Math.sin(-a), uy = (x - cx) * Math.sin(-a) + (y - cy) * Math.cos(-a);
        v = paper - shade * (0.5 - ux / pw);
        if (Math.abs(ux) < pw / 2 - 15 && Math.abs(uy) < ph / 2 - 20 && ((uy + ph) % (ph / 14)) < 3) v = 50;
      }
      v += (rnd() - 0.5) * 18;
      const i = (y * w + x) * 4; d[i] = v; d[i + 1] = v * 0.95; d[i + 2] = v * 0.9; d[i + 3] = 255;
    }
  }
  return { img: { data: d, width: w, height: h }, pts };
}

(async () => {
  const Q = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'core', 'quad.js')).href);
  const N = 30, w = 520, h = 390;
  let ok = 0, worst = 0, ms = 0;
  for (let s = 0; s < N; s++) {
    const { img, pts } = scene(w, h), truth = Q.orderQuad(pts);
    const t = performance.now(); const q = Q.detect(img); ms += performance.now() - t;
    const err = q ? Math.max(...q.map((p, i) => Math.hypot(p[0] - truth[i][0], p[1] - truth[i][1]))) : Infinity;
    if (err < 12) { ok++; worst = Math.max(worst, err); }
  }
  check('encuentra el papel en al menos el 90 % de las escenas', ok >= N * 0.9, `${ok}/${N}`);
  check('esquinas a menos de 12 px de las reales (imagen de 520 px)', worst < 12, 'peor ' + worst.toFixed(1) + ' px');
  check('rápido: menos de 80 ms por fotograma', ms / N < 80, (ms / N).toFixed(1) + ' ms');

  // sin papel: una escena lisa con ruido no debe dar un falso documento
  const flat = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < flat.length; i += 4) { const v = 120 + (rnd() - 0.5) * 20; flat[i] = flat[i + 1] = flat[i + 2] = v; flat[i + 3] = 255; }
  check('sin papel no inventa un documento', Q.detect({ data: flat, width: w, height: h }) === null);

  // perspectiva: el recorte de un rectángulo conocido conserva sus colores en su sitio
  const sw = 200, sh = 100, src = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = (y * sw + x) * 4; src[i] = x < sw / 2 ? 255 : 0; src[i + 1] = 0; src[i + 2] = x < sw / 2 ? 0 : 255; src[i + 3] = 255; }
  const out = Q.warp({ data: src, width: sw, height: sh }, [[100, 0], [199, 0], [199, 99], [100, 99]], 50, 50);
  check('perspectiva: la mitad derecha recortada es azul', out.width === 50 && out.data[(25 * 50 + 25) * 4 + 2] > 200 && out.data[(25 * 50 + 25) * 4] < 50);

  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})();
