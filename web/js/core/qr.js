// Lector de códigos QR (jsQR, Apache-2.0) sin conexión: prueba varios tamaños y la imagen invertida.
let libP = null;
function loadJsQr() {
  if (libP) return libP;
  libP = new Promise((resolve, reject) => {
    if (window.jsQR) return resolve(window.jsQR);
    const s = document.createElement('script');
    s.src = new URL('../../vendor/jsqr/jsQR.js', import.meta.url).href;
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => { libP = null; reject(new Error('No se pudo cargar el lector de códigos QR.')); };
    document.head.appendChild(s);
  });
  return libP;
}

// canvas → texto del código, o null si no hay ninguno
export async function readQr(canvas) {
  const jsQR = await loadJsQr();
  for (const side of [1200, 800, 1800, 500]) {
    const k = Math.min(1, side / Math.max(canvas.width, canvas.height)), w = Math.max(1, Math.round(canvas.width * k)), h = Math.max(1, Math.round(canvas.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(canvas, 0, 0, w, h);
    const r = jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (r && r.data) return r.data;
  }
  return null;
}
