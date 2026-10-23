// Worker de la GPU: dibuja y filtra las páginas con WebGL2 (gl-ops.js). No carga OpenCV, así que arranca en milisegundos y no
// compite con él. Si el teléfono no soporta WebGL2 en un Worker, avisa (caps.render = false) y se usa el motor de OpenCV.
let ops = null;

// Las tareas se hacen de una en una, en el orden en que llegan
let chain = Promise.resolve();
self.onmessage = (e) => { chain = chain.then(() => run(e.data)); };

async function run({ id, op, args }) {
  self.postMessage({ started: id });
  try {
    const t0 = performance.now();
    const res = await ops[op](...args);
    self.postMessage({ id, res, ms: Math.round(performance.now() - t0) });
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
}

(async () => {
  try {
    const t0 = performance.now();
    ops = await import('./gl-ops.js');
    const mode = new URLSearchParams(self.location.search).get('gpu') || 'auto';     // auto | force | off
    const ok = await ops.init(mode);
    self.postMessage({ ready: true, caps: { render: ok, gpu: ops.status() }, ms: { leer: 0, iniciar: Math.round(performance.now() - t0) } });
  } catch (err) { self.postMessage({ fatal: String((err && err.message) || err) }); }
})();
