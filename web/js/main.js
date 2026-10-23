// WilScan · punto de entrada: pestañas, flujo de escaneo e importación, y registro del modo sin conexión.
import { h, icon, $, $$, toast, withBusy, stamp, safeName, closeTopLayer, disableHistoryLayers } from './lib/dom.js';
import { loadSettings } from './lib/settings.js';
import { purgeOrphanPages } from './core/db.js';
import { initLibrary, refreshDocs } from './ui/library.js';
import { initTools } from './ui/tools.js';
import { initSettings } from './ui/settings-view.js';
import { openScanner } from './ui/scan.js';
import { openEditor } from './ui/editor.js';
import { newDoc, importPdf } from './core/docs.js';
import { detectQuad } from './core/detect.js';
import { canvasOf, loadCV, loadGL, timer, logError } from './core/cv.js';
import { scaled, blobToCanvas } from './core/pages.js';
import { isNative } from './core/share.js';

let view = 'docs';
function show(v) {
  view = v;
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === 'v-' + v));
  $$('[data-tab]').forEach((el) => { const on = el.dataset.tab === v; el.classList.toggle('on', on); el.setAttribute('aria-current', on ? 'page' : 'false'); });
  window.scrollTo(0, 0);
  if (v === 'docs') refreshDocs();
}

async function openDoc(id) { await openEditor(id, { onClose: () => refreshDocs() }); }

function startScan() {
  openScanner({
    onDone: async (items) => {
      const { doc } = await withBusy('Guardando el documento…', (b) => newDoc('Escaneo ' + stamp(), items, { onProgress: (f) => b.update('Procesando páginas…', f) }));
      show('docs'); await openDoc(doc.id);
    },
  });
}

// Importar imágenes o PDF desde el dispositivo
const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, attrs: { 'aria-label': 'Importar archivos' } });
async function importFiles(files) {
  const list = [...files];
  const imgs = list.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|bmp)$/i.test(f.name)), pdfs = list.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!imgs.length && !pdfs.length) { toast('Elige imágenes (JPG, PNG, WebP) o archivos PDF.', 'error'); return; }
  let last = null;
  try {
    if (imgs.length) last = (await withBusy('Importando imágenes…', async (b) => {
      let done = 0;
      const items = imgs.map((file) => ({ draft: true, make: async () => {
        const t = timer('Importar');
        const big = await blobToCanvas(file, 3000); t.step('decodificar');   // ya reducida al decodificar
        const quad = await detectQuad(big).catch(() => null); t.step('bordes'); t.end();
        b.update(`Imagen ${++done} de ${imgs.length}`, done / imgs.length);
        return { canvas: big, quad, draft: true };
      } }));
      return newDoc(imgs.length === 1 ? safeName(imgs[0].name.replace(/\.[^.]+$/, '')) : 'Importado ' + stamp(), items);
    })).doc;
    for (const p of pdfs) last = await withBusy('Importando PDF…', (b) => importPdf(p, { onProgress: (f) => b.update(null, f) }));
  } catch (e) { toast(e.message || 'No se pudo importar', 'error', 6000); }
  fileIn.value = '';
  await refreshDocs();
  if (last && imgs.length + pdfs.length === 1) openDoc(last.id);
  else if (last) toast('Archivos importados', 'ok');
}
fileIn.addEventListener('change', () => importFiles(fileIn.files));

window.addEventListener('error', (e) => logError(e.message || 'error'));
window.addEventListener('unhandledrejection', (e) => logError('promesa: ' + ((e.reason && e.reason.message) || e.reason)));

async function boot() {
  if (isNative()) disableHistoryLayers();
  await loadSettings();
  purgeOrphanPages().catch(() => {});   // páginas de una importación que se cortó (cierre forzado) y nunca llegaron a tener documento
  initLibrary({ onOpen: openDoc, onScan: startScan, onImport: () => fileIn.click() });
  initTools({ onOpenDoc: async (id) => { show('docs'); await openDoc(id); } });
  initSettings();
  document.body.append(fileIn);
  $$('[data-tab]').forEach((el) => el.addEventListener('click', () => show(el.dataset.tab)));
  $$('[data-scan]').forEach((el) => el.addEventListener('click', startScan));
  $('#btnImport').addEventListener('click', () => fileIn.click());
  show('docs');
  if (!isNative() && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // arrastrar y soltar archivos sobre la pantalla de documentos
  window.addEventListener('dragover', (e) => { if (view === 'docs') e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (view === 'docs' && e.dataTransfer && e.dataTransfer.files.length && !document.querySelector('.backdrop, .ed, .scan')) { e.preventDefault(); importFiles(e.dataTransfer.files); } });
  // Botón «Atrás» de Android: cierra la pantalla o la hoja de encima; en Herramientas/Ajustes vuelve a Documentos; solo en Documentos sale de la app
  const NativeApp = isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (NativeApp && NativeApp.addListener) NativeApp.addListener('backButton', () => { if (closeTopLayer()) return; if (view !== 'docs') show('docs'); else NativeApp.exitApp(); });
  window.WilScan = { show, openDoc, startScan, importFiles };
  document.documentElement.dataset.ready = '1';
  // el motor de la GPU arranca en milisegundos y atiende los filtros y las páginas; OpenCV (13 MB) solo hace falta para detectar los bordes
  // del papel, así que se prepara cuando el usuario va a escanear o importar (no antes: ahorra memoria y batería)
  loadGL();
  const warmCV = () => loadCV().catch(() => {});
  $$('[data-scan]').forEach((el) => el.addEventListener('pointerdown', warmCV, { passive: true }));
  $('#btnImport').addEventListener('pointerdown', warmCV, { passive: true });
  setTimeout(warmCV, 4000);                // y, de todos modos, un poco después de abrir la app, cuando ya no compite con nada
}
boot().catch((e) => { console.error(e); toast('No se pudo iniciar la aplicación: ' + (e.message || e), 'error', 8000); });
