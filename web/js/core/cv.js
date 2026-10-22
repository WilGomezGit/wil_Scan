// Motor de imagen (OpenCV.js, ≈13 MB). Corre en un Worker para no congelar la pantalla; solo se descarga cuando hace falta.
// Si el Worker no puede arrancar, se carga en el hilo principal como antes (más lento, pero funciona).
let engine = null;

// Diagnóstico de velocidad (se muestra en Ajustes): qué motor se está usando y cuánto tarda cada paso
export const perf = { engine: 'sin cargar', log: [] };
export function timer(label) {
  const t0 = performance.now(), steps = [];
  return { step(name) { steps.push(name + ' ' + Math.round(performance.now() - t0)); }, end() { perf.log.unshift(`${label}: ${Math.round(performance.now() - t0)} ms (${steps.join(' · ')})`); perf.log.length = Math.min(perf.log.length, 12); } };
}

// Si Android cierra un motor (p. ej. por falta de memoria) no avisa: su tarea nunca terminaría y todo lo que va detrás
// quedaría esperando (el círculo de carga no se iría). Cada tarea tiene un tiempo máximo según lo que suele tardar;
// si se pasa, ese motor se descarta y la tarea se repite en otro.
const slowest = {};
const limitFor = (op, args) => {
  const px = args.reduce((n, a) => n + (a && a.width ? a.width * a.height : 0), 0) / 1e6;
  return slowest[op] ? Math.max(4000, slowest[op] * 4, px * 1500) : Math.max(15000, px * 4000);   // la 1.ª vez, margen amplio
};
const retryable = (msg) => Object.assign(new Error(msg), { retry: true });

function workerEngine() {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') return reject(new Error('sin Worker'));
    const tw = performance.now();
    const w = new Worker(new URL('./cv-worker.js', import.meta.url)); w.__h = null;
    const pending = new Map();
    let seq = 0, ready = false;
    const failAll = (err) => { for (const p of pending.values()) p.reject(err); pending.clear(); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.ready) { ready = true; perf.engine = `Worker (segundo plano) · listo en ${Math.round(performance.now() - tw)} ms` + (m.ms ? ` (leer ${m.ms.leer} · iniciar ${m.ms.iniciar})` : ''); const h = w.__h = { dead: false, last: performance.now(), busy: () => pending.size, stop: (why = 'motor cerrado') => { if (h.dead) return; h.dead = true; w.terminate(); failAll(retryable(why)); }, run: (op, args, transfer) => new Promise((res, rej) => { if (h.dead) return rej(retryable('motor cerrado')); h.last = performance.now(); const id = ++seq; const t = setTimeout(() => { if (pending.has(id)) h.stop('el motor de imagen dejó de responder'); }, limitFor(op, args)); pending.set(id, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); }, op, t0: performance.now() }); w.postMessage({ id, op, args }, transfer || []); }) }; resolve(h); return; }
      if (m.fatal) { w.terminate(); return reject(new Error(m.fatal)); }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ms != null) { slowest[p.op] = Math.max(slowest[p.op] || 0, m.ms); perf.ops = perf.ops || []; perf.ops.unshift(`${p.op}: ${m.ms} ms en el motor · ${Math.round(performance.now() - p.t0)} ms en total`); perf.ops.length = Math.min(perf.ops.length, 20); }
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.res);
    };
    w.onerror = (e) => { const err = new Error(e.message || 'error del motor de imagen'); if (!ready) { w.terminate(); reject(err); } else { if (w.__h) w.__h.stop(err.message); else failAll(err); } };
  });
}

function localEngine() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/opencv/opencv.js', import.meta.url).href;
    s.async = true;
    s.onload = async () => {
      try {
        let m = window.cv;
        if (m && typeof m.then === 'function') m = await m;                      // la versión 5 entrega una promesa
        if (!m.Mat) await new Promise((r) => { m.onRuntimeInitialized = r; });   // versiones anteriores
        const ops = await import('./cv-ops.js');
        perf.engine = 'Hilo principal (el Worker no arrancó)';
        resolve({ run: async (op, args) => ops[op](m, ...args) });
      } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error('No se pudo cargar el motor de imagen. Comprueba tu conexión y vuelve a intentarlo.'));
    document.head.appendChild(s);
  });
}

// Prepara el motor (idempotente). Se puede llamar con antelación para "calentarlo".
export function loadCV() {
  if (!engine) engine = workerEngine().catch(() => localEngine()).catch((e) => { engine = null; throw e; });
  return engine.then(() => true);
}

// ---- varios núcleos ----
// Cada Worker usa un núcleo. Se abren más solo si hay trabajo esperando (aplicar un filtro a todas las páginas, importar varias fotos)
// y el teléfono tiene núcleos y memoria de sobra; los extra se cierran tras 45 s sin uso para liberar memoria.
export function cvLanes() {
  const cores = navigator.hardwareConcurrency || 2, mem = navigator.deviceMemory || 4;
  // cada motor ocupa bastante memoria; con poca, Android los cierra sin avisar: como mucho 2 y solo con memoria de sobra
  let n = cores >= 6 && mem >= 6 ? 2 : 1;
  try { const o = +localStorage.getItem('wilscan-lanes'); if (o >= 1 && o <= 4) n = o; } catch { /* sin almacenamiento */ }
  return n;
}
const extra = [];
let spawning = false, failedSpawn = false;
setInterval(() => {
  for (let i = extra.length - 1; i >= 0; i--) { const w = extra[i]; if (w.dead || (w.busy() === 0 && performance.now() - w.last > 45000)) { w.stop(); extra.splice(i, 1); perf.lanes = 1 + extra.length; } }
}, 15000);
function pick(first) {
  if (!first.busy) return first;                                   // motor en el hilo principal: sin grupo
  const all = [first, ...extra].filter((w) => !w.dead);
  if (!all.length) return first;
  const best = all.reduce((a, b) => (b.busy() < a.busy() ? b : a));
  if (best.busy() > 0 && all.length < cvLanes() && !spawning && !failedSpawn) {
    spawning = true;
    workerEngine().then((w) => { extra.push(w); perf.lanes = 1 + extra.length; }).catch(() => { failedSpawn = true; }).finally(() => { spawning = false; });
  }
  return best;
}

// Ejecuta una operación de cv-ops.js con imágenes { data, width, height }.
let lastUse = 0;
export const cvIdleFor = (ms) => performance.now() - lastUse > ms;

// Las imágenes se copian al motor (no se transfieren) para poder repetir la tarea si ese motor se cae.
export async function cvRun(op, args) {
  for (let attempt = 0; ; attempt++) {
    lastUse = performance.now();
    await loadCV();
    const eng = await engine;
    if (eng.dead && !extra.some((w) => !w.dead)) { engine = null; continue; }     // el motor principal se cayó: se abre otro
    try { return await pick(eng).run(op, args); }
    catch (e) {
      if (!e.retry || attempt >= 2) throw e;
      perf.restarts = (perf.restarts || 0) + 1;
      if (eng.dead) engine = null;
    } finally { lastUse = performance.now(); }
  }
}

export const imageOf = (canvas) => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);

// Lienzos en memoria normal (no en la tarjeta gráfica): leer sus píxeles para el motor no obliga a copiarlos desde la GPU,
// que en móviles podía bloquear la pantalla decenas de segundos.
export function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); c.getContext('2d', { willReadFrequently: true }); return c; }

// Pinta una imagen devuelta por el motor en un lienzo nuevo
export function canvasFrom(img) {
  const c = canvasOf(img.width, img.height);
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}
