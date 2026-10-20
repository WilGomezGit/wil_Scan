// Service worker de WilScan: guarda la aplicación para usarla sin conexión.
// - La interfaz (HTML, CSS, JS, iconos) se precarga al instalar y se actualiza cuando hay red.
// - Los motores pesados (OpenCV, OCR, PDF; carpeta vendor/) se guardan la primera vez que se usan, o todos a la vez desde Ajustes.
const scope = self.registration.scope;
let files = null;
const filesP = () => files || (files = fetch(new URL('sw-files.json', scope), { cache: 'no-store' }).then((r) => r.json()));
const shellName = (v) => 'wilscan-shell-' + v;
const VENDOR = 'wilscan-vendor-v1';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const f = await filesP();
    const c = await caches.open(shellName(f.version));
    await c.addAll(f.shell.map((p) => new Request(new URL(p, scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const f = await filesP();
    for (const k of await caches.keys()) if (k.startsWith('wilscan-shell-') && k !== shellName(f.version)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.href.startsWith(scope)) return;
  const isVendor = url.pathname.includes('/vendor/');
  e.respondWith((async () => {
    if (isVendor) {
      const c = await caches.open(VENDOR);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req);
      if (res.ok) { const f = await filesP(); (await caches.open(shellName(f.version))).put(req, res.clone()); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await caches.match(new URL('index.html', scope).href); if (idx) return idx; }
      throw err;
    }
  })());
});

// Desde Ajustes: descargar todos los motores para usar la app sin conexión
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'precache-vendor') return;
  e.waitUntil((async () => {
    const f = await filesP(), c = await caches.open(VENDOR);
    let done = 0;
    for (const p of f.vendor) {
      const u = new URL(p, scope);
      if (!(await c.match(u))) { try { const r = await fetch(u); if (r.ok) await c.put(u, r); } catch { /* sin red: se reintenta luego */ } }
      done++;
      const all = await self.clients.matchAll();
      all.forEach((cl) => cl.postMessage({ type: 'precache-progress', done, total: f.vendor.length }));
    }
    (await self.clients.matchAll()).forEach((cl) => cl.postMessage({ type: 'precache-done' }));
  })());
});
