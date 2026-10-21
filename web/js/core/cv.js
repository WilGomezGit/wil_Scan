// Motor de imagen (OpenCV.js, ≈13 MB). Corre en un Worker para no congelar la pantalla; solo se descarga cuando hace falta.
// Si el Worker no puede arrancar, se carga en el hilo principal como antes (más lento, pero funciona).
let engine = null;

// Diagnóstico de velocidad (se muestra en Ajustes): qué motor se está usando y cuánto tarda cada paso
export const perf = { engine: 'sin cargar', log: [] };
export function timer(label) {
  const t0 = performance.now(), steps = [];
  return { step(name) { steps.push(name + ' ' + Math.round(performance.now() - t0)); }, end() { perf.log.unshift(`${label}: ${Math.round(performance.now() - t0)} ms (${steps.join(' · ')})`); perf.log.length = Math.min(perf.log.length, 12); } };
}

function workerEngine() {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') return reject(new Error('sin Worker'));
    const w = new Worker(new URL('./cv-worker.js', import.meta.url));
    const pending = new Map();
    let seq = 0, ready = false;
    const failAll = (err) => { for (const p of pending.values()) p.reject(err); pending.clear(); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.ready) { ready = true; perf.engine = 'Worker (segundo plano)'; resolve({ run: (op, args, transfer) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); w.postMessage({ id, op, args }, transfer || []); }) }); return; }
      if (m.fatal) { w.terminate(); return reject(new Error(m.fatal)); }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.res);
    };
    w.onerror = (e) => { const err = new Error(e.message || 'error del motor de imagen'); if (!ready) { w.terminate(); reject(err); } else failAll(err); };
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

// Ejecuta una operación de cv-ops.js. Las imágenes ({ data, width, height }) se transfieren sin copiar.
let lastUse = 0;
export const cvIdleFor = (ms) => performance.now() - lastUse > ms;

export async function cvRun(op, args) {
  lastUse = performance.now();
  await loadCV();
  const eng = await engine;
  try { return await eng.run(op, args, args.filter((a) => a && a.data && a.data.buffer).map((a) => a.data.buffer)); }
  finally { lastUse = performance.now(); }
}

export const imageOf = (canvas) => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);

export function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

// Pinta una imagen devuelta por el motor en un lienzo nuevo
export function canvasFrom(img) {
  const c = canvasOf(img.width, img.height);
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}
