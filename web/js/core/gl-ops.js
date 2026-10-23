// Motor de páginas en la GPU (WebGL2 dentro de un Worker): recorta (perspectiva), endereza, gira, quita sombras y aplica los filtros
// con un «shader» que procesa todos los píxeles a la vez. Por eso cambiar de filtro o de brillo cuesta milisegundos en vez de segundos.
// El cálculo pesado por píxel va en la GPU; en la CPU solo queda lo pequeño (mapas de fondo a ~320 px). Si el teléfono no soporta
// WebGL2 en un Worker, o algo falla, se usa el motor de OpenCV (render-ops.js) con los mismos resultados.
import { setCanvasFactory, mk, rotateCanvas, scaled, needsEnlarge, applyMarks } from './canvas-ops.js';
import { estimateSkew } from './deskew.js';

setCanvasFactory((w, h) => { const c = new OffscreenCanvas(w, h); c.getContext('2d', { willReadFrequently: true }); return c; });

// ---------------------------------------------------------------- shaders
const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Recorte: para cada píxel de la página resultante, de dónde sale en la foto (giro + inclinación + perspectiva)
const FS_WARP = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform mat3 uA;        // píxel de salida → píxel de la imagen recortada (deshace giro e inclinación)
uniform vec2 uWarpSize; // tamaño de la imagen recortada
uniform mat3 uH;        // píxel de la imagen recortada → píxel de la foto (perspectiva)
uniform vec3 uFill;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x - 0.5, gl_FragCoord.y - 0.5);
  vec2 q = (uA * vec3(p, 1.0)).xy;
  if (q.x < -0.51 || q.y < -0.51 || q.x > uWarpSize.x - 0.49 || q.y > uWarpSize.y - 0.49) { o = vec4(uFill, 1.0); return; }
  vec3 s = uH * vec3(q, 1.0);
  o = vec4(texture(uSrc, (s.xy / s.z + 0.5) / uSrcSize).rgb, 1.0);
}`;

const FS_COPY = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform float uFlip;     // 1 = se dibuja en el lienzo (origen abajo)
in vec2 vUv;
out vec4 o;
void main() { o = vec4(texture(uBase, vec2(vUv.x, uFlip > 0.5 ? 1.0 - vUv.y : vUv.y)).rgb, 1.0); }`;

// Filtros. Modos: 0 original · 1 color (sin sombras, enfoque, niveles) · 2 grises · 3 blanco y negro
const FS_FILTER = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uBg;     // fondo estimado (papel sin texto), baja resolución
uniform sampler2D uMean;   // media local del gris aplanado (para el blanco y negro)
uniform vec2 uBaseSize;
uniform vec2 uOutSize;
uniform float uFlip;       // 1 = se dibuja en el lienzo (origen abajo)
uniform int uMode;
uniform float uClean;      // 1 = imagen digital limpia: no se aplana el fondo
uniform vec3 uTone;        // tono del papel (Sin sombras)
uniform float uSharp;
uniform float uLo;         // niveles: negro
uniform float uGamma;
uniform float uLevels;     // 1 = aplicar niveles
uniform float uDark;       // oscurecer tonos medios (nota a lápiz, pizarra)
uniform float uInvert;
uniform float uSat;
uniform float uScale;      // contraste
uniform float uOffset;     // brillo
uniform float uC;          // umbral del blanco y negro
uniform float uStep;       // >0: muestreo puntual cada uStep píxeles (para medir el histograma sin promediar el texto fino)
out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 bgAt(vec2 uv) { return max(texture(uBg, uv).rgb, vec3(1.0 / 255.0)); }
void main() {
  vec2 p = vec2(gl_FragCoord.x - 0.5, uFlip > 0.5 ? uOutSize.y - 0.5 - gl_FragCoord.y : gl_FragCoord.y - 0.5);
  vec2 uv = (p + 0.5) / uOutSize;
  vec3 c = uStep > 0.5 ? texelFetch(uBase, ivec2(p * uStep), 0).rgb : texture(uBase, uv).rgb;
  vec3 v;
  if (uMode == 0) {
    v = c;
  } else if (uMode == 1) {
    vec3 k = uClean > 0.5 ? vec3(1.0) : vec3(1.0) / bgAt(uv);
    if (uSharp > 0.0) {
      vec2 t = 1.0 / uBaseSize;
      vec3 b = 0.20 * c
        + 0.12 * (textureLod(uBase, uv + vec2(3.0, 0.0) * t, 0.0).rgb + textureLod(uBase, uv - vec2(3.0, 0.0) * t, 0.0).rgb
                + textureLod(uBase, uv + vec2(0.0, 3.0) * t, 0.0).rgb + textureLod(uBase, uv - vec2(0.0, 3.0) * t, 0.0).rgb)
        + 0.08 * (textureLod(uBase, uv + vec2(2.1, 2.1) * t, 0.0).rgb + textureLod(uBase, uv - vec2(2.1, 2.1) * t, 0.0).rgb
                + textureLod(uBase, uv + vec2(2.1, -2.1) * t, 0.0).rgb + textureLod(uBase, uv - vec2(2.1, -2.1) * t, 0.0).rgb);
      c = c + uSharp * (c - b);
    }
    v = clamp(c * k * uTone, 0.0, 1.0);
  } else {
    float g = lum(c);
    if (uInvert > 0.5) g = 1.0 - g;
    float k = uClean > 0.5 ? 1.0 : 1.0 / max(texture(uBg, uv).r, 1.0 / 255.0);
    if (uMode == 3) {
      vec2 t = 1.0 / uBaseSize;
      float s = 4.0 * lum(c);
      s += 2.0 * (lum(texture(uBase, uv + vec2(t.x, 0.0)).rgb) + lum(texture(uBase, uv - vec2(t.x, 0.0)).rgb)
                + lum(texture(uBase, uv + vec2(0.0, t.y)).rgb) + lum(texture(uBase, uv - vec2(0.0, t.y)).rgb));
      s += lum(texture(uBase, uv + t).rgb) + lum(texture(uBase, uv - t).rgb)
         + lum(texture(uBase, uv + vec2(t.x, -t.y)).rgb) + lum(texture(uBase, uv + vec2(-t.x, t.y)).rgb);
      float gb = clamp(s / 16.0 * k, 0.0, 1.0);
      float m = texture(uMean, uv).r;
      float w = gb > m - uC ? 1.0 : 0.0;
      v = vec3(w);
    } else {
      v = vec3(clamp(g * k, 0.0, 1.0));
    }
  }
  if (uLevels > 0.5) v = mix(vec3(0.0), pow(max((v - uLo) / max(1.0 - uLo, 0.001), 0.0), vec3(uGamma)), step(uLo + 1e-6, v));
  if (uDark != 1.0) v = pow(v, vec3(uDark));
  v = clamp(v * uScale + uOffset, 0.0, 1.0);
  if (uSat != 1.0) { float y = lum(v); v = clamp(vec3(y) + (v - vec3(y)) * uSat, 0.0, 1.0); }
  o = vec4(v, 1.0);
}`;

// ---------------------------------------------------------------- utilidades de WebGL
let canvas = null, gl = null, P = null, vao = null, fbo = null, lost = false, MAXTEX = 4096;
export const info = { renderer: '', error: '' };
const cache = new Map();            // páginas recortadas en la GPU (las 3 últimas)

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('programa: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

function ensureGL() {
  if (gl && !gl.isContextLost() && !lost) return;
  cache.clear(); lost = false;
  canvas = new OffscreenCanvas(16, 16);
  gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('sin WebGL2');
  if (canvas.addEventListener) canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; cache.clear(); });
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  info.renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'WebGL2';
  MAXTEX = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
  P = { warp: program(FS_WARP), copy: program(FS_COPY), filter: program(FS_FILTER) };
  vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  fbo = gl.createFramebuffer();
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
}

function newTex(w, h, { mips = false, fmt = 'rgba' } = {}) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  if (fmt === 'r') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
const bindTex = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
function toTexture(t, w, h, draw) {   // dibuja dentro de una textura (la fila 0 de la textura es la fila 0 de la imagen)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incompleto');
  gl.viewport(0, 0, w, h); draw(); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
function toCanvas(w, h, draw) {
  canvas.width = w; canvas.height = h;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); draw();
}
const tri = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
const checkErr = (what) => { const e = gl.getError(); if (e !== gl.NO_ERROR) throw new Error('WebGL ' + what + ' (' + e + ')'); };

// ---------------------------------------------------------------- geometría (matrices 3×3, por columnas)
const mul = (a, b) => { const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[j * 3 + i] += a[k * 3 + i] * b[j * 3 + k]; return r; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Homografía que lleva los 4 puntos de `from` a los de `to` (resuelve el sistema 8×8)
function homography(from, to) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]); A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let m = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
    [A[c], A[m]] = [A[m], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  const h = A.map((r, i) => r[8] / r[i]);
  return [h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], 1];   // por columnas
}

// Todo lo geométrico de una página: tamaño de la imagen recortada, de la salida, y las matrices de los dos pasos
function geometry(job, sw, sh) {
  let Ww, Hh, H;
  if (!job.quad) {
    const k = Math.min(1, job.side / Math.max(sw, sh));
    Ww = Math.max(1, Math.round(sw * k)); Hh = Math.max(1, Math.round(sh * k));
    const fx = sw / Ww, fy = sh / Hh;
    H = [fx, 0, 0, 0, fy, 0, 0.5 * fx - 0.5, 0.5 * fy - 0.5, 1];
  } else {
    const p = job.quad.map(([x, y]) => [x * sw, y * sh]);
    let W = Math.max(dist(p[0], p[1]), dist(p[3], p[2])), Hq = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
    const k = Math.min(1, job.side / Math.max(W, Hq));
    Ww = Math.max(8, Math.round(W * k)); Hh = Math.max(8, Math.round(Hq * k));
    H = homography([[0, 0], [Ww - 1, 0], [Ww - 1, Hh - 1], [0, Hh - 1]], p);
  }
  const rot = (((job.rot || 0) % 360) + 360) % 360, swap = rot === 90 || rot === 270;
  const outW = swap ? Hh : Ww, outH = swap ? Ww : Hh;
  // se deshacen el giro y la inclinación de una vez: Q = R(−(skew + rot))·(P − centro de salida) + centro de la recortada
  const phi = (-(job.skew || 0) + rot) * Math.PI / 180, c = Math.cos(-phi), s = Math.sin(-phi);
  const cx = Ww / 2, cy = Hh / 2, ox = outW / 2, oy = outH / 2;
  const tx = c * (0.5 - ox) - s * (0.5 - oy) + cx - 0.5, ty = s * (0.5 - ox) + c * (0.5 - oy) + cy - 0.5;
  const A = [c, s, 0, -s, c, 0, tx, ty, 1];
  return { Ww, Hh, outW, outH, A, H };
}

// ---------------------------------------------------------------- análisis pequeño en la CPU (mapas de ~320 px)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function maxFilter(src, w, h, r) {   // dilatación cuadrada separable
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = -r; k <= r; k++) { const v = src[y * w + clamp(x + k, 0, w - 1)]; if (v > m) m = v; } tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = -r; k <= r; k++) { const v = tmp[clamp(y + k, 0, h - 1) * w + x]; if (v > m) m = v; } out[y * w + x] = m; }
  return out;
}
function medianFilter(src, w, h, r) {   // mediana cuadrada con histograma deslizante (Huang)
  const out = new Uint8Array(w * h), half = ((2 * r + 1) * (2 * r + 1)) >> 1, hist = new Uint16Array(256);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    for (let dy = -r; dy <= r; dy++) { const row = clamp(y + dy, 0, h - 1) * w; for (let dx = -r; dx <= r; dx++) hist[src[row + clamp(dx, 0, w - 1)]]++; }
    let med = 0, lt = 0;
    while (lt + hist[med] <= half) lt += hist[med++];
    for (let x = 0; x < w; x++) {
      if (x > 0) {
        const xo = clamp(x - 1 - r, 0, w - 1), xn = clamp(x + r, 0, w - 1);
        for (let dy = -r; dy <= r; dy++) {
          const row = clamp(y + dy, 0, h - 1) * w, vo = src[row + xo], vn = src[row + xn];
          hist[vo]--; if (vo < med) lt--; hist[vn]++; if (vn < med) lt++;
        }
        while (lt > half) lt -= hist[--med];
        while (lt + hist[med] <= half) lt += hist[med++];
      }
      out[y * w + x] = med;
    }
  }
  return out;
}
function gaussFilter(src, w, h, sigma) {
  const r = Math.max(1, Math.round(sigma * 3)), k = new Float32Array(2 * r + 1); let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += k[i + r] * src[y * w + clamp(x + i, 0, w - 1)]; tmp[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += k[i + r] * tmp[clamp(y + i, 0, h - 1) * w + x]; out[y * w + x] = Math.round(a); }
  return out;
}
// Fondo (papel sin texto) de un plano: máximo local borra el texto oscuro, mediana y suavizado lo dejan liso (como la versión de OpenCV)
const background = (plane, w, h) => gaussFilter(medianFilter(maxFilter(plane, w, h, 2), w, h, 5), w, h, 3);
function boxMean(src, w, h, r) {
  const out = new Uint8Array(w * h), I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    out[y * w + x] = Math.round((I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)));
  }
  return out;
}
const lumOf = (r, g, b) => (r * 77 + g * 150 + b * 29) >> 8;
// Percentil de un histograma → nivel de negro (como levels() de OpenCV): el tono más oscuro del texto pasa a negro
function levelLo(hist, dark) {
  let n = 0; for (let i = 0; i < 256; i++) n += hist[i];
  let acc = 0, lo = 0; while (lo < 255 && (acc += hist[lo]) < n * dark) lo++;
  return Math.min(lo, 110) / 255;
}

// Mapa pequeño de la página (~320 px) leído de la GPU, y todo lo que se calcula a partir de él (una vez por página)
function smallOf(base) {
  if (base.small) return base.small;
  const k = Math.max(1, Math.max(base.w, base.h) / 320), w = Math.max(8, Math.round(base.w / k)), h = Math.max(8, Math.round(base.h / k));
  const t = newTex(w, h), data = new Uint8Array(w * h * 4);
  gl.useProgram(P.copy.p); bindTex(0, base.tex); gl.uniform1i(P.copy.u.uBase, 0); gl.uniform1f(P.copy.u.uFlip, 0);
  toTexture(t, w, h, tri);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteTexture(t);
  const n = w * h, R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n), Y = new Uint8Array(n);
  let white = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) { R[i] = data[j]; G[i] = data[j + 1]; B[i] = data[j + 2]; Y[i] = lumOf(R[i], G[i], B[i]); if (Y[i] >= 248) white++; }
  return (base.small = { w, h, R, G, B, Y, clean: white / n > 0.3, an: {} });
}

const uploadR = (plane, w, h) => { const t = newTex(w, h, { fmt: 'r' }); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, plane); return t; };
function uploadRGB(r, g, b, w, h) {
  const d = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = r[i]; d[i * 4 + 1] = g[i]; d[i * 4 + 2] = b[i]; d[i * 4 + 3] = 255; }
  const t = newTex(w, h); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d); return t;
}

// Parámetros de cada filtro (mismos valores que la versión de OpenCV)
const FILTER = {
  original: { mode: 0 },
  auto: { mode: 1, sharp: 0.7, dark: 0.03, gamma: 1 },
  sombras: { mode: 1, sharp: 0, tone: true },
  color: { mode: 1, sharp: 0.7, dark: 0.05, gamma: 1.15, sat: 1.9 },
  nitido: { mode: 1, sharp: 1.6, dark: 0.03, gamma: 1 },
  gris: { mode: 2, dark: 0.005, gamma: 1 },
  nota: { mode: 2, darkGamma: 2.4 },
  pizarra: { mode: 2, invert: true, darkGamma: 2 },
  bn: { mode: 3 },
};

// Lo que hace falta de la página para un filtro: textura de fondo, media local, niveles y tono. Se guarda para no repetirlo.
function analysis(base, f) {
  const s = smallOf(base), name = f.mode === 1 ? 'rgb' : f.mode === 3 ? 'bn' : f.invert ? 'inv' : 'gray';
  if (s.an[name]) return s.an[name];
  const { w, h, R, G, B, Y } = s, out = { clean: s.clean, hist: null, tone: [1, 1, 1], bg: null, mean: null };
  if (f.mode === 1) {
    if (!s.clean) {
      const bR = background(R, w, h), bG = background(G, w, h), bB = background(B, w, h);
      out.bg = uploadRGB(bR, bG, bB, w, h);
      if (f.tone) {   // «Sin sombras» conserva el tono del papel: el color medio del fondo, normalizado
        let mr = 0, mg = 0, mb = 0; for (let i = 0; i < w * h; i++) { mr += bR[i]; mg += bG[i]; mb += bB[i]; }
        const top = Math.max(mr, mg, mb, 1); out.tone = [Math.min(1, mr / top * 0.97), Math.min(1, mg / top * 0.97), Math.min(1, mb / top * 0.97)];
      }
    }
  } else {
    const plane = f.invert ? Y.map((v) => 255 - v) : Y;
    if (f.invert) { let white = 0; for (let i = 0; i < plane.length; i++) if (plane[i] >= 248) white++; out.clean = white / plane.length > 0.3; }
    const bgp = out.clean ? null : background(plane, w, h);
    if (bgp) out.bg = uploadR(bgp, w, h);
    const flat = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) flat[i] = bgp ? clamp(plane[i] * 255 / Math.max(bgp[i], 1), 0, 255) : plane[i];
    if (f.mode === 3) out.mean = uploadR(boxMean(flat, w, h, Math.max(1, Math.round(Math.min(w, h) / 22 / 2))), w, h);
  }
  return (s.an[name] = out);
}

// Pone todos los parámetros del filtro. plain: sin niveles ni ajustes (tono, brillo, contraste, saturación), para medir el histograma
function setFilter(base, f, a, spec, outW, outH, flip, plain, step = 0) {
  const u = P.filter.u;
  gl.useProgram(P.filter.p);
  bindTex(0, base.tex); gl.uniform1i(u.uBase, 0);
  bindTex(1, a && a.bg ? a.bg : base.tex); gl.uniform1i(u.uBg, 1);
  bindTex(2, a && a.mean ? a.mean : base.tex); gl.uniform1i(u.uMean, 2);
  gl.uniform2f(u.uBaseSize, base.w, base.h); gl.uniform2f(u.uOutSize, outW, outH); gl.uniform1f(u.uFlip, flip ? 1 : 0);
  gl.uniform1i(u.uMode, f.mode); gl.uniform1f(u.uClean, a && a.clean ? 1 : 0);
  gl.uniform3f(u.uTone, ...(a && !plain ? a.tone : [1, 1, 1]));
  gl.uniform1f(u.uSharp, f.sharp || 0);                   // el nivel de negro se mide DESPUÉS de enfocar (el enfoque lleva el centro del texto a negro puro)
  gl.uniform1f(u.uLevels, !plain && f.dark && a ? 1 : 0); gl.uniform1f(u.uLo, !plain && a ? a.lo : 0); gl.uniform1f(u.uGamma, f.gamma || 1);
  gl.uniform1f(u.uDark, plain ? 1 : f.darkGamma || 1); gl.uniform1f(u.uInvert, f.invert ? 1 : 0);
  gl.uniform1f(u.uSat, plain ? 1 : f.sat || 1);
  gl.uniform1f(u.uScale, plain ? 1 : 1 + (spec.contrast || 0) / 50); gl.uniform1f(u.uOffset, plain ? 0 : (spec.bright || 0) * 1.6 / 255);
  gl.uniform1f(u.uC, 24 / 255); gl.uniform1f(u.uStep, step);
}

// Histograma de la luminancia de la página ya aplanada y enfocada, de una muestra a media resolución (el texto fino cuenta: en el mapa de ~320 px se borra).
// De él sale el nivel de negro de «Mejorado», «Color vivo», «Nítido» y «Grises».
function histogramOf(base, f, a) {
  if (a.hist) return a.hist;
  const hw = Math.max(8, Math.round(base.w / 2)), hh = Math.max(8, Math.round(base.h / 2)), t = newTex(hw, hh), data = new Uint8Array(hw * hh * 4), hist = new Uint32Array(256);
  setFilter(base, f, a, {}, hw, hh, false, true, 2);     // muestreo puntual: cada 2 píxeles en cada eje (como OpenCV, que mira 1 de cada 7)
  toTexture(t, hw, hh, tri);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.readPixels(0, 0, hw, hh, gl.RGBA, gl.UNSIGNED_BYTE, data); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteTexture(t);
  if (f.mode === 1) for (let i = 0; i < data.length; i += 4) hist[lumOf(data[i], data[i + 1], data[i + 2])]++;
  else for (let i = 0; i < data.length; i += 4) hist[data[i]]++;
  return (a.hist = hist);
}

// Dibuja la página con un filtro en una textura del tamaño pedido (con mipmaps). De ahí salen el JPG completo y la miniatura.
function drawFiltered(base, spec, outW, outH) {
  const f = FILTER[spec.filter] || FILTER.auto, a = f.mode === 0 ? null : analysis(base, f);
  if (a && f.dark) a.lo = levelLo(histogramOf(base, f, a), f.dark);
  const t = newTex(outW, outH, { mips: true });
  try {
    setFilter(base, f, a, spec, outW, outH, false, false);
    toTexture(t, outW, outH, tri);
    bindTex(0, t); gl.generateMipmap(gl.TEXTURE_2D);
  } catch (e) { gl.deleteTexture(t); throw e; }
  return t;
}
// Copia una textura al lienzo a un tamaño (si es menor, con mipmaps: reducción de calidad, como la miniatura de la otra versión)
function show(t, w, h) {
  gl.useProgram(P.copy.p); bindTex(0, t); gl.uniform1i(P.copy.u.uBase, 0); gl.uniform1f(P.copy.u.uFlip, 1);
  toCanvas(w, h, tri);
}
// Atajo para vistas previas: filtra y deja el resultado en el lienzo
function draw(base, spec, outW, outH) { const t = drawFiltered(base, spec, outW, outH); show(t, outW, outH); gl.deleteTexture(t); }

// ---------------------------------------------------------------- página base (recortada, enderezada, girada) en la GPU
function drop(entry) { try { gl.deleteTexture(entry.tex); const s = entry.small; if (s) for (const a of Object.values(s.an)) { if (a.bg) gl.deleteTexture(a.bg); if (a.mean) gl.deleteTexture(a.mean); } } catch { /* contexto perdido */ } }
function remember(key, entry) {
  const old = cache.get(key); if (old) { cache.delete(key); if (old !== entry) drop(old); }
  cache.set(key, entry);
  while (cache.size > 3) { const k = cache.keys().next().value; drop(cache.get(k)); cache.delete(k); }
  return entry;
}

// color medio de las 4 esquinas de la imagen recortada (relleno de las esquinas que deja el enderezado)
function cornerFill(bmp, g) {
  const c = mk(1, 1), x = c.getContext('2d', { willReadFrequently: true }), acc = [0, 0, 0];
  for (const [qx, qy] of [[2, 2], [g.Ww - 3, 2], [2, g.Hh - 3], [g.Ww - 3, g.Hh - 3]]) {
    const w = g.H[2] * qx + g.H[5] * qy + 1, sx = Math.round((g.H[0] * qx + g.H[3] * qy + g.H[6]) / w), sy = Math.round((g.H[1] * qx + g.H[4] * qy + g.H[7]) / w);
    x.drawImage(bmp, clamp(sx, 0, bmp.width - 1), clamp(sy, 0, bmp.height - 1), 1, 1, 0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data; acc[0] += d[0]; acc[1] += d[1]; acc[2] += d[2];
  }
  return acc.map((v) => v / 4 / 255);
}

async function baseOf(job) {
  const key = keyOf(job), hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const own = !job.bmp, bmp = job.bmp || await createImageBitmap(job.orig, job.resizeWidth ? { resizeWidth: job.resizeWidth, resizeQuality: 'medium' } : undefined);
  try {
    ensureGL();
    if (Math.max(bmp.width, bmp.height) > MAXTEX) throw new Error('foto más grande que la textura máxima');
    const g = geometry(job, bmp.width, bmp.height);
    const src = gl.createTexture();   // la foto se sube directamente (sin reservar la textura dos veces)
    let tex = null;
    try {
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex = newTex(g.outW, g.outH, { mips: true }); const u = P.warp.u;
    gl.useProgram(P.warp.p); bindTex(0, src); gl.uniform1i(u.uSrc, 0);
    gl.uniform2f(u.uSrcSize, bmp.width, bmp.height); gl.uniform2f(u.uWarpSize, g.Ww, g.Hh);
    gl.uniformMatrix3fv(u.uA, false, g.A); gl.uniformMatrix3fv(u.uH, false, g.H);
    gl.uniform3f(u.uFill, ...(job.skew ? cornerFill(bmp, g) : [1, 1, 1]));
    toTexture(tex, g.outW, g.outH, tri);
    bindTex(0, tex); gl.generateMipmap(gl.TEXTURE_2D);
    checkErr('recorte');
    return remember(key, { tex, w: g.outW, h: g.outH, small: null });
    } catch (e) { if (tex) gl.deleteTexture(tex); throw e; }
    finally { gl.deleteTexture(src); }
  } finally { if (own && bmp.close) bmp.close(); }
}

const jpeg = (c, quality) => c.convertToBlob({ type: 'image/jpeg', quality });
const png = (c) => c.convertToBlob({ type: 'image/png' });
const keyOf = (job) => [job.id, JSON.stringify(job.quad || null), job.skew || 0, job.rot || 0, job.side].join('|');
const factor = (w, h) => (needsEnlarge(w, h) ? Math.min(2.5, 1800 / Math.max(w, h)) : 1);

// ---------------------------------------------------------------- operaciones que llegan del hilo principal
// job: { id, orig | bmp, quad, skew, rot, side, filter, bright, contrast, marks, draft, quality, autoSkew }
export async function render(job) {
  ensureGL();
  const T0 = performance.now(), T = {}, lap = (k) => { const n = performance.now(); T[k] = Math.round(n - (lap.last || T0)); lap.last = n; };
  let bmp = job.bmp || null;
  try {
    if (job.autoSkew) {   // sin esquinas: se mide la inclinación del texto en esta misma tarea
      bmp = bmp || await createImageBitmap(job.orig);
      let skew = 0; try { skew = estimateSkew(scaled(bmp, 1000)); } catch { /* sin medida */ }
      job = { ...job, bmp, skew };
    }
    const base = await baseOf(job), k = factor(base.w, base.h); lap('base');
    const outW = Math.round(base.w * (job.draft ? 1 : k)), outH = Math.round(base.h * (job.draft ? 1 : k));
    const spec = { filter: job.filter || 'auto', bright: job.bright || 0, contrast: job.contrast || 0 };
    const q = job.quality || 0.9;
    let out, thumb;
    const t = drawFiltered(base, spec, outW, outH); gl.finish(); lap('filtro');
    try {
      const tk = Math.min(1, 420 / Math.max(outW, outH)), tw = Math.max(1, Math.round(outW * tk)), th = Math.max(1, Math.round(outH * tk));
      show(t, outW, outH);
      if (job.marks && job.marks.length) {   // las zonas ocultas se dibujan con lienzo 2D sobre el resultado
        const c = mk(outW, outH); c.getContext('2d').drawImage(canvas, 0, 0); applyMarks(c, job.marks);
        thumb = job.noThumb ? null : await jpeg(scaled(c, 420), 0.75); out = job.format === 'png' ? await png(c) : await jpeg(c, q);
      } else {
        out = job.format === 'png' ? await png(canvas) : await jpeg(canvas, q);
        if (job.noThumb) thumb = null;
        else if (tk < 1) { show(t, tw, th); thumb = await jpeg(canvas, 0.75); } else thumb = out;
      }
    } finally { gl.deleteTexture(t); if (job.nocache) { const e = cache.get(keyOf(job)); if (e) { cache.delete(keyOf(job)); drop(e); } } }
    checkErr('dibujo'); lap('codificar');
    return { out, thumb, w: outW, h: outH, skew: job.skew || 0, t: T };
  } finally { if (bmp && bmp.close) bmp.close(); }
}

export async function rotate90(job) {
  const one = async (blob, q) => {
    const bmp = await createImageBitmap(blob), c = mk(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
    const r = rotateCanvas(c, 90);
    return { blob: await jpeg(r, q), w: r.width, h: r.height };
  };
  const o = await one(job.out, job.quality || 0.92), t = await one(job.thumb, 0.75);
  return { out: o.blob, thumb: t.blob, w: o.w, h: o.h };
}

// Vistas previas: la página reducida (≤ 900 px) con uno o varios filtros → Blob[] (JPEG)
export async function preview(job) {
  ensureGL();
  const base = await baseOf({ id: job.id + ':v', orig: job.orig, quad: job.quad, skew: 0, rot: job.rot, side: 900, resizeWidth: 1100 });
  const k = Math.min(1, job.side / Math.max(base.w, base.h)), w = Math.max(1, Math.round(base.w * k)), h = Math.max(1, Math.round(base.h * k));
  const out = [];
  for (const s of job.specs) { draw(base, s, w, h); out.push(await jpeg(canvas, job.quality || 0.82)); }
  checkErr('vista previa');
  return out;
}

// ---------------------------------------------------------------- arranque: ¿funciona de verdad en este teléfono?
// Se dibuja una hoja conocida (papel con degradado de sombra, un recuadro negro y una mancha roja) con TODOS los filtros, con perspectiva y con giro,
// y se comprueba el resultado píxel a píxel. Un controlador de GPU con errores daría filtros corruptos: si algo no cuadra, no se usa la GPU.
async function pixelsOf(blob) {
  const bmp = await createImageBitmap(blob), c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
  return { w: c.width, h: c.height, at: (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data).slice(0, 3) };
}
export async function selfTest() {
  const W = 96, H = 72, c = new OffscreenCanvas(W, H), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#9a9a96'); g.addColorStop(1, '#efefe8');
  x.fillStyle = g; x.fillRect(0, 0, W, H); x.fillStyle = '#101010'; x.fillRect(30, 20, 30, 12); x.fillStyle = '#d02020'; x.fillRect(6, 4, 14, 10); x.fillStyle = '#101010'; x.fillRect(10, 48, 70, 3);   // (una línea fina: el blanco y negro adaptativo deja huecos los bloques negros grandes, como el de OpenCV)
  const run = async (extra) => {
    const bmp = await createImageBitmap(c);
    const r = await render({ id: 'selftest' + Math.random(), bmp, quad: null, skew: 0, rot: 0, side: 96, filter: 'auto', draft: true, quality: 0.95, nocache: true, noThumb: true, ...extra });
    return pixelsOf(r.out);
  };
  const fail = (m) => { info.error = 'prueba inicial: ' + m; return false; };
  const grey = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) <= 4;
  // 1) cada filtro: papel claro, negro oscuro, y propiedades propias
  for (const f of ['original', 'auto', 'sombras', 'color', 'nitido', 'gris', 'nota', 'bn']) {
    const r = await run({ filter: f });
    if (r.w !== W || r.h !== H) return fail(f + ': tamaño');
    const dark = f === 'bn' ? r.at(45, 49) : r.at(45, 26), paper = r.at(8, 60), paper2 = r.at(88, 60);
    if (dark[0] > 95) return fail(f + ': el negro no es negro (' + dark + ')');
    if (f === 'original') { if (Math.abs(paper[0] - 0x9a) > 14 || Math.abs(paper2[0] - 0xef) > 14) return fail('original: cambia el papel'); continue; }
    if (paper[0] < 205 || paper2[0] < 205) return fail(f + ': el papel no queda claro (' + paper + ' ' + paper2 + ')');
    if (['gris', 'nota', 'bn'].includes(f) && !(grey(dark) && grey(paper))) return fail(f + ': debería ser gris');
    if (f === 'bn' && ![0, 255].includes(r.at(70, 50)[0]) && r.at(70, 50)[0] > 12 && r.at(70, 50)[0] < 243) return fail('bn: no es blanco y negro');
  }
  const red = (await run({ filter: 'color' })).at(12, 9);
  if (!(red[0] > 150 && red[1] < 110 && red[2] < 110)) return fail('color: se pierde el rojo (' + red + ')');
  // 2) giro de 90° a la derecha: el recuadro rojo de arriba-izquierda pasa a arriba-derecha
  const rot = await run({ filter: 'original', rot: 90 });
  if (rot.w !== H || rot.h !== W) return fail('giro: tamaño');
  const rr = rot.at(H - 9, 12);
  if (!(rr[0] > 150 && rr[1] < 110)) return fail('giro: orientación (' + rr + ')');
  // 3) perspectiva: el recorte de la mitad derecha de la hoja muestra el recuadro negro a la izquierda del resultado
  const half = await run({ filter: 'original', quad: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] });
  const hd = half.at(Math.round(half.w * (60 - 48) / 48 * 0.5 + 0) , Math.round(half.h * 26 / 72));
  if (!(half.w >= 40 && half.at(4, 40)[0] > 150 && hd[0] < 120)) return fail('recorte: posición');
  cache.clear();
  return true;
}

// ¿Es de verdad rápida esta GPU? Una GPU «por software» (el navegador emula la GPU con la CPU: SwiftShader, llvmpipe…) o una muy lenta no
// compensa: en ese caso se usa OpenCV. Se mide un filtro «Mejorado» (el más pesado) sobre una imagen de 3 megapíxeles.
const SLOW_MS = 220;
async function benchmark() {
  const w = 2000, h = 1500, c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  x.fillStyle = '#eee'; x.fillRect(0, 0, w, h); x.fillStyle = '#222'; x.font = '28px serif';
  for (let i = 0; i < 30; i++) x.fillText('Prueba de velocidad de la GPU ' + i, 40, 60 + i * 44);
  const bmp = await createImageBitmap(c);
  const base = await baseOf({ id: 'bench', bmp, quad: null, skew: 0, rot: 0, side: 2000 });
  const spec = { filter: 'auto' }, px = new Uint8Array(4), once = () => { draw(base, spec, w, h); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  once(); once();                                   // la primera vez compila y calienta
  const t0 = performance.now(); for (let i = 0; i < 3; i++) once();
  info.benchmarkMs = Math.round((performance.now() - t0) / 3);
  cache.clear(); drop(base);
  return info.benchmarkMs;
}

export async function init(mode = 'auto') {   // mode: 'auto' (con prueba de velocidad) | 'force' (sin ella, para pruebas) | 'off'
  try {
    if (mode === 'off') { info.error = 'desactivada en los ajustes'; return false; }
    ensureGL();
    if (!(await selfTest())) { info.error = info.error || 'la prueba inicial dio un resultado distinto'; return false; }
    if (mode !== 'force') {
      if (/swiftshader|llvmpipe|software|softpipe|basic render/i.test(info.renderer)) { info.error = 'GPU por software (' + info.renderer + ')'; return false; }
      const ms = await benchmark();
      if (ms > SLOW_MS) { info.error = 'GPU lenta en la prueba (' + ms + ' ms por filtro de 3 MP)'; return false; }
    }
    return true;
  } catch (e) { info.error = String((e && e.message) || e); return false; }
}
export const status = () => ({ gpu: true, renderer: info.renderer, error: info.error, benchmarkMs: info.benchmarkMs });

