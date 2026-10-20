// Carga perezosa de OpenCV.js (≈13 MB): solo se descarga cuando hace falta (escáner, filtros, recorte).
let promise = null;

export function loadCV() {
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/opencv/opencv.js', import.meta.url).href;
    s.async = true;
    s.onload = async () => {
      try {
        let m = window.cv;
        if (m && typeof m.then === 'function') m = await m;                      // la versión 5 entrega una promesa
        if (!m.Mat) await new Promise((r) => { m.onRuntimeInitialized = r; });  // versiones anteriores
        resolve(m);
      } catch (e) { promise = null; reject(e); }
    };
    s.onerror = () => { promise = null; reject(new Error('No se pudo cargar el motor de imagen. Comprueba tu conexión y vuelve a intentarlo.')); };
    document.head.appendChild(s);
  });
  return promise;
}

// Libera varias matrices de OpenCV (la memoria de wasm no la recoge el recolector de basura)
export const free = (...mats) => { for (const m of mats) { try { if (m && !m.isDeleted()) m.delete(); } catch { /* ya liberada */ } } };

export function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
