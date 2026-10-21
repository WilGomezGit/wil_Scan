// Reparto de trabajo: ejecuta tareas asíncronas con un máximo de tareas a la vez (para aprovechar varios núcleos sin saturar el teléfono).
export function limiter(max) {
  let running = 0; const queue = [];
  const next = () => { while (running < max() && queue.length) { const { fn, res, rej } = queue.shift(); running++; Promise.resolve().then(fn).then(res, rej).finally(() => { running--; next(); }); } };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

// Como Array.map pero asíncrono y con límite; conserva el orden del resultado
export async function mapLimit(items, max, fn) {
  const out = new Array(items.length); let i = 0, failed = null;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(max, items.length)) }, async () => {
    while (i < items.length && !failed) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { failed = failed || e; } }
  }));
  if (failed) throw failed;
  return out;
}
