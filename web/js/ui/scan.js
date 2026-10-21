// Escáner: cámara a pantalla completa con detección de bordes en vivo, disparo manual o automático, lotes y documento de identidad.
import { h, icon, toast, confirmBox, menuSheet, pushLayer, withBusy } from '../lib/dom.js';
import { Camera } from '../core/camera.js';
import { detectQuad } from '../core/detect.js';
import { loadCV, canvasOf } from '../core/cv.js';
import { warpQuad } from '../core/warp.js';
import { scaled } from '../core/pages.js';
import { composeIdSheet, startPage, recropPage } from '../core/docs.js';
import { uid } from '../core/db.js';
import { openCropper } from './crop.js';
import { getSettings, setSettings } from '../lib/settings.js';

const MAX = 3000;                          // lado máximo que se guarda de cada foto
const delta = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

// opts: { title?, onDone(items, { mode }) , onCancel() }
export function openScanner({ onDone, onCancel = () => {}, startMode = 'doc' } = {}) {
  let mode = startMode, items = [], retake = -1, queue = Promise.resolve(), idFront = null, cam = null, quad = null, history = [], steadySince = 0, firedFor = 0, running = true, detecting = false, shooting = false, finished = false;
  const st = getSettings();
  let auto = !!st.autoCapture;

  const video = h('video', { class: 'scan-video', attrs: { playsinline: true, muted: true, autoplay: true } });
  const overlay = h('canvas', { class: 'scan-overlay' });
  const flashFx = h('div', { class: 'scan-flash' });
  const hint = h('div', { class: 'scan-hint', attrs: { 'aria-live': 'polite' } });
  const thumb = h('button', { class: 'scan-done', attrs: { type: 'button', 'aria-label': 'Terminar y revisar' } });
  const shutter = h('button', { class: 'scan-shutter', attrs: { type: 'button', 'aria-label': 'Hacer foto' } }, h('i'));
  const galleryIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, attrs: { 'aria-label': 'Importar imágenes' } });
  const galleryBtn = h('button', { class: 'icon-btn solid', attrs: { type: 'button', 'aria-label': 'Importar de la galería' } }, icon('image'));
  const flashBtn = h('button', { class: 'icon-btn solid', attrs: { type: 'button', 'aria-label': 'Linterna' }, hidden: true }, icon('flash'));
  const flipBtn = h('button', { class: 'icon-btn solid', attrs: { type: 'button', 'aria-label': 'Cambiar de cámara' } }, icon('flip'));
  const closeBtn = h('button', { class: 'icon-btn solid', attrs: { type: 'button', 'aria-label': 'Cerrar el escáner' } }, icon('close'));
  const autoBtn = h('button', { class: 'chip scan-chip' + (auto ? ' on' : ''), attrs: { type: 'button', 'aria-pressed': String(auto) }, text: 'Auto' });
  const modeSeg = h('div', { class: 'scan-modes', attrs: { role: 'tablist' } });
  const strip = h('div', { class: 'scan-strip', hidden: true, attrs: { role: 'list', 'data-scroll': true } });
  const msg = h('div', { class: 'scan-msg', hidden: true });
  const root = h('div', { class: 'scan', attrs: { role: 'dialog', 'aria-label': 'Escáner de documentos' } },
    video, overlay, flashFx,
    h('div', { class: 'scan-top' }, closeBtn, h('div', { class: 'grow' }), autoBtn, flashBtn, flipBtn),
    hint, msg,
    h('div', { class: 'scan-bottom' }, strip, h('div', { class: 'scan-modes-wrap' }, modeSeg), h('div', { class: 'scan-controls' }, galleryBtn, shutter, thumb), galleryIn));
  document.body.append(root);

  const drawModes = () => {
    modeSeg.textContent = '';
    for (const [id, label, ic] of [['doc', 'Documento', 'file'], ['id', 'Identificación', 'idcard']]) {
      modeSeg.append(h('button', { class: 'scan-mode' + (id === mode ? ' on' : ''), attrs: { type: 'button', role: 'tab', 'aria-selected': String(id === mode) }, on: { click: () => { if (mode !== id) { mode = id; idFront = null; drawModes(); setHint(); } } } }, icon(ic, 's'), label));
    }
  };
  const setHint = (text) => {
    hint.textContent = text || (mode === 'id' ? (idFront ? 'Ahora el REVERSO del documento' : 'Encuadra el ANVERSO del documento') : items.length ? 'Encuadra la siguiente página' : 'Encuadra el documento');
    hint.hidden = false;
  };
  const drawThumb = () => {
    thumb.textContent = ''; thumb.classList.remove('half');
    thumb.disabled = !items.length;
    if (items.length) {
      const last = items[items.length - 1], c = canvasOf(96, 96 * last.thumb.height / last.thumb.width); c.getContext('2d').drawImage(last.thumb, 0, 0, c.width, c.height);
      thumb.append(c, h('span', { class: 'scan-count', text: String(items.length) }), h('span', { class: 'scan-ok' }, icon('check', 's')));
    }
  };

  // ---- páginas escaneadas: se van procesando en segundo plano mientras se sigue fotografiando ----
  function makeItem(canvas, quad) {
    const it = { id: uid(), canvas, quad, ready: false, dead: false };
    it.thumb = canvasOf(110, 110 * canvas.height / canvas.width); it.thumb.getContext('2d').drawImage(canvas, 0, 0, it.thumb.width, it.thumb.height);
    process(it);
    return it;
  }
  function process(it) {
    it.ready = false;
    // de una en una: así no se acumulan fotos grandes en memoria
    it.page = queue = queue.then(() => (it.dead ? null : startPage(it))).then((p) => { it.ready = !!p; if (p && !it.dead) it.canvas = null; drawStrip(); return p; }).catch(() => { drawStrip(); return null; });
  }
  function drawStrip() {
    strip.textContent = ''; strip.hidden = !items.length;
    items.forEach((it, i) => {
      strip.append(h('button', { class: 'scan-th' + (it.ready ? ' ok' : ' wait') + (i === retake ? ' retake' : ''), attrs: { type: 'button', role: 'listitem', 'aria-label': `Página ${i + 1}` + (it.ready ? '' : ' (procesando)') }, on: { click: () => itemMenu(i) } },
        it.thumb, h('span', { class: 'n', text: String(i + 1) }), h('span', { class: 'st' }, it.ready ? icon('check', 's') : h('i', { class: 'scan-spin' }))));
    });
    strip.scrollLeft = strip.scrollWidth;
    drawThumb();
  }
  function itemMenu(i) {
    const it = items[i]; if (!it) return;
    menuSheet(`Página ${i + 1}`, [
      { icon: 'crop', label: 'Recortar', run: () => recropItem(it) },
      { icon: 'scan', label: 'Repetir esta foto', run: () => { retake = i; drawStrip(); setHint(`Haz de nuevo la foto de la página ${i + 1}`); } },
      { icon: 'trash', label: 'Eliminar', danger: true, run: () => { it.dead = true; items = items.filter((x) => x !== it); retake = -1; drawStrip(); setHint(); } },
    ]);
  }
  async function recropItem(it) {
    const page = await withBusy('Abriendo…', () => it.page);
    const target = page || { canvas: it.canvas, quad: it.quad };
    const q = await openCropper(target, { title: 'Recortar la página', ok: 'Aplicar' });
    if (q === undefined) return;
    it.quad = q; it.ready = false; drawStrip();
    if (page) it.page = queue = queue.then(() => recropPage(page, q)).then((p) => { it.ready = true; drawStrip(); return p; }).catch(() => null);
    else process(it);
  }

  // ---- cámara ----
  const showError = (title, text) => {
    msg.hidden = false; msg.textContent = '';
    msg.append(h('h3', { text: title }), h('p', { text }), h('div', { class: 'btn-row center' },
      h('button', { class: 'btn primary', attrs: { type: 'button' }, on: { click: () => galleryIn.click() } }, icon('image', 's'), 'Importar imágenes'),
      h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => { msg.hidden = true; startCamera(); } } }, 'Reintentar')));
    hint.hidden = true;
  };
  async function startCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('sin cámara'), { name: 'NotSupportedError' });
      cam = cam || new Camera(video);
      const info = await cam.start(cam.facing);
      flashBtn.hidden = !info.torch;
      video.classList.toggle('mirror', cam.facing === 'user');
      msg.hidden = true; setHint();
      loadCV().catch(() => {});                           // calienta el motor de imagen mientras se encuadra
      loop();
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const none = e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError' || e.name === 'NotSupportedError');
      showError(denied ? 'Permiso de cámara denegado' : none ? 'No se encontró ninguna cámara' : 'No se pudo abrir la cámara',
        denied ? 'Permite el acceso a la cámara en los ajustes del navegador o de la app. También puedes importar fotos de tu galería.' : none ? 'Puedes importar fotos o capturas que ya tengas guardadas.' : 'Otra aplicación puede estar usándola. Ciérrala e inténtalo de nuevo.');
    }
  }

  // ---- detección en vivo ----
  const sizeOverlay = () => { const r = root.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); const w = Math.round(r.width * d), hh = Math.round(r.height * d); if (overlay.width !== w || overlay.height !== hh) { overlay.width = w; overlay.height = hh; } return { d, r }; };
  function videoRect() {
    const r = root.getBoundingClientRect(), vw = video.videoWidth || 1, vh = video.videoHeight || 1, k = Math.min(r.width / vw, r.height / vh);
    return { x: (r.width - vw * k) / 2, y: (r.height - vh * k) / 2, w: vw * k, h: vh * k };
  }
  function paint() {
    const { d } = sizeOverlay(), x = overlay.getContext('2d');
    x.clearRect(0, 0, overlay.width, overlay.height);
    if (!quad) return;
    const v = videoRect(), pts = quad.map(([qx, qy]) => [(v.x + qx * v.w) * d, (v.y + qy * v.h) * d]);
    const ok = steadySince && performance.now() - steadySince > 500;
    x.lineWidth = 4 * d; x.lineJoin = 'round';
    x.fillStyle = ok ? 'rgba(31, 224, 138, .22)' : 'rgba(0, 240, 255, .18)'; x.strokeStyle = ok ? '#1fe08a' : '#00f0ff';
    x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill(); x.stroke();
    for (const [px, py] of pts) { x.beginPath(); x.arc(px, py, 7 * d, 0, 6.3); x.fillStyle = '#fff'; x.fill(); }
  }
  async function loop() {
    if (!running) return;
    if (!detecting && !shooting && video.videoWidth && document.visibilityState === 'visible') {
      detecting = true;
      try {
        const q = await detectQuad(video, { maxSide: 420 });
        quad = q;
        if (q) {
          history.push(q); if (history.length > 4) history.shift();
          const steady = history.length >= 3 && history.slice(1).every((h2, i) => delta(h2, history[i]) < 0.02);
          if (steady) { if (!steadySince) steadySince = performance.now(); } else steadySince = 0;
          if (auto && steadySince && performance.now() - steadySince > 1100 && !shooting && performance.now() - firedFor > 2500) { firedFor = performance.now(); setHint('Documento detectado'); capture(true); }
          else if (!steadySince && history.length) hint.textContent = mode === 'id' ? (idFront ? 'Ahora el REVERSO del documento' : 'Encuadra el ANVERSO del documento') : 'Mantén quieto el documento';
          else if (steadySince && !auto) hint.textContent = 'Listo: pulsa el botón para escanear';
        } else { history = []; steadySince = 0; setHint(); }
      } catch (e) { quad = null; }
      detecting = false;
      paint();
    }
    setTimeout(loop, 160);
  }

  // ---- capturar / importar ----
  const buzz = () => { try { if (getSettings().haptics && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(25); } catch { /* sin vibración */ } };
  async function addCanvas(c, { review = false } = {}) {
    const big = scaled(c, MAX);
    let q = null;
    try { q = await detectQuad(big, { maxSide: 520 }); } catch { /* sin detección: se usa la imagen entera */ }
    if (review) {                                          // como en CamScanner: ajustar las esquinas y confirmar, o repetir la foto
      const r = await openCropper({ canvas: big, quad: q }, { title: 'Revisa el recorte', hint: 'Ajusta las esquinas o confirma', ok: 'Confirmar', cancel: 'Repetir' });
      if (r === undefined) { setHint('Foto descartada: haz otra'); return; }
      q = r;
    }
    if (mode === 'id') {
      const flat = await warpQuad(big, q);
      if (!idFront) { idFront = flat; setHint('Ahora el REVERSO del documento'); drawThumb2(flat); return; }
      const sheet = composeIdSheet(idFront, flat); idFront = null;
      add(makeItem(sheet, null)); setHint('Documento de identidad listo');
    } else add(makeItem(big, q));
    drawStrip(); setHint();
  }
  function add(it) { if (retake >= 0 && items[retake]) { items[retake].dead = true; items[retake] = it; retake = -1; } else items.push(it); }
  function drawThumb2(c) { thumb.textContent = ''; thumb.disabled = false; thumb.classList.add('half'); const t = canvasOf(96, 96 * c.height / c.width); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); thumb.append(t, h('span', { class: 'scan-count', text: '1/2' })); }
  async function capture(fromAuto = false) {
    if (shooting || !cam || !cam.stream) return;
    shooting = true; shutter.disabled = true;
    try {
      flashFx.classList.remove('go'); void flashFx.offsetWidth; flashFx.classList.add('go'); buzz();
      const c = await cam.capture();
      await addCanvas(c, { review: !fromAuto && mode === 'doc' && !!getSettings().reviewCrop });
      history = []; steadySince = 0; quad = null; paint();
    } catch (e) { toast('No se pudo hacer la foto. Inténtalo otra vez.', 'error'); }
    shooting = false; shutter.disabled = false;
  }
  async function importFiles(files) {
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|bmp)$/i.test(f.name));
    if (!list.length) { toast('Elige imágenes (JPG, PNG o WebP).', 'error'); return; }
    shooting = true;
    for (const f of list) {
      try {
        const bmp = await createImageBitmap(f);
        const c = canvasOf(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
        await addCanvas(c);
      } catch { toast(`No se pudo abrir «${f.name}».`, 'error'); }
    }
    shooting = false; galleryIn.value = '';
    if (!cam || !cam.stream) finish();                    // sin cámara: tras importar se pasa directamente a revisar
  }

  // ---- cierre ----
  function teardown() { running = false; if (cam) cam.stop(); root.remove(); document.removeEventListener('visibilitychange', onVis); }
  function finish() {
    if (finished) return; finished = true;
    const result = items.slice();
    popLayer();                                          // cierra y quita la capa de historial
    if (result.length) onDone(result, { mode }); else onCancel();
  }
  let popLayer = pushLayer(() => { if (!finished) { finished = true; const result = items.slice(); teardown(); if (result.length) onDone(result, { mode }); else onCancel(); } else teardown(); });
  const onVis = () => { if (document.visibilityState === 'hidden' && cam) cam.stop(); else if (document.visibilityState === 'visible' && running && cam && !cam.stream) startCamera(); };
  document.addEventListener('visibilitychange', onVis);

  closeBtn.addEventListener('click', async () => {
    if (items.length && !(await confirmBox({ title: '¿Salir sin guardar?', text: `Tienes ${items.length} ${items.length === 1 ? 'página escaneada' : 'páginas escaneadas'}. Si sales ahora se descartarán.`, ok: 'Salir y descartar', danger: true }))) return;
    items.forEach((i) => { i.dead = true; }); items = []; finish();
  });
  thumb.addEventListener('click', () => { if (items.length) finish(); });
  shutter.addEventListener('click', () => capture(false));
  galleryBtn.addEventListener('click', () => galleryIn.click());
  galleryIn.addEventListener('change', () => importFiles(galleryIn.files));
  flipBtn.addEventListener('click', async () => { if (cam) { cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; await startCamera(); } });
  flashBtn.addEventListener('click', async () => { const on = !cam.torchOn; if (await cam.setTorch(on)) flashBtn.classList.toggle('on', on); });
  autoBtn.addEventListener('click', async () => { auto = !auto; autoBtn.classList.toggle('on', auto); autoBtn.setAttribute('aria-pressed', String(auto)); await setSettings({ autoCapture: auto }); toast(auto ? 'Disparo automático activado' : 'Disparo automático desactivado'); });
  window.addEventListener('resize', paint);
  drawModes(); drawThumb(); setHint('Abriendo la cámara…');
  startCamera();
  return { addCanvas, items: () => items };
}
