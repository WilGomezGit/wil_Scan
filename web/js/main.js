// WilScan · punto de entrada: pestañas, flujo de escaneo e importación, y registro del modo sin conexión.
import { h, icon, $, $$, toast, withBusy, stamp, safeName } from './lib/dom.js';
import { loadSettings } from './lib/settings.js';
import { initLibrary, refreshDocs } from './ui/library.js';
import { initTools } from './ui/tools.js';
import { initSettings } from './ui/settings-view.js';
import { openScanner } from './ui/scan.js';
import { openEditor } from './ui/editor.js';
import { newDoc, importPdf } from './core/docs.js';
import { detectQuad } from './core/detect.js';
import { canvasOf, loadCV, timer } from './core/cv.js';
import { scaled } from './core/pages.js';
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
      const items = [];
      for (let i = 0; i < imgs.length; i++) {
        b.update(`Imagen ${i + 1} de ${imgs.length}`, i / imgs.length);
        const t = timer('Importar');
        const bmp = await createImageBitmap(imgs[i]); t.step('decodificar'); const c = canvasOf(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
        const big = scaled(c, 3000); t.step('reducir'); items.push({ canvas: big, quad: await detectQuad(big).catch(() => null), draft: true }); t.step('bordes'); t.end();
      }
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

async function boot() {
  await loadSettings();
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
  window.WilScan = { show, openDoc, startScan, importFiles };
  document.documentElement.dataset.ready = '1';
  // el motor de imagen (13 MB) se prepara en segundo plano para que el primer escaneo o filtro no espere
  setTimeout(() => loadCV().catch(() => {}), 600);
}
boot().catch((e) => { console.error(e); toast('No se pudo iniciar la aplicación: ' + (e.message || e), 'error', 8000); });
