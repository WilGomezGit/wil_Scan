// Pantalla «Ajustes»: escaneo, texto, PDF, instalación, almacenamiento y datos de la app.
import { h, icon, $, toast, confirmBox, fmtSize } from '../lib/dom.js';
import { getSettings, setSettings } from '../lib/settings.js';
import { FILTERS } from '../core/filters.js';
import { LANGS } from '../core/ocr.js';
import { usage, wipeAll, persist } from '../core/db.js';
import { isNative } from '../core/share.js';
import { perf, loadCV, cvLanes } from '../core/cv.js';

export const APP_VERSION = '1.0.4';
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; const b = $('#btnInstall'); if (b) b.hidden = false; });
window.addEventListener('appinstalled', () => { installEvent = null; const b = $('#btnInstall'); if (b) b.hidden = true; toast('WilScan instalada', 'ok'); });

const sel = (label, opts, key, fmt) => {
  const s = h('select', { attrs: { 'aria-label': label } }, opts.map(([v, t]) => h('option', { value: v, text: t })));
  s.value = getSettings()[key];
  s.addEventListener('change', async () => { await setSettings({ [key]: fmt ? fmt(s.value) : s.value }); });
  return h('label', { class: 'field' }, h('span', { text: label }), s);
};
const chk = (label, key, hint) => {
  const i = h('input', { type: 'checkbox', checked: !!getSettings()[key] });
  i.addEventListener('change', async () => { await setSettings({ [key]: i.checked }); });
  return h('div', {}, h('label', { class: 'check' }, i, h('span', { text: label })), hint ? h('p', { class: 'hint tight', text: hint }) : null);
};

export function initSettings() {
  const root = $('#v-settings');
  const storage = h('p', { class: 'hint', text: 'Calculando…' });
  const swState = h('p', { class: 'hint', text: '' });
  const diag = h('div', { class: 'hint' });
  const drawDiag = () => {
    const lines = [...perf.log, ...(perf.ops || []).slice(0, 6)];
    diag.textContent = '';
    diag.append(h('p', { class: 'tight', text: (perf.gpu || 'GPU: sin iniciar') + (perf.gpuFallos ? ` · caídas a OpenCV: ${perf.gpuFallos}` : '') }), h('p', { class: 'tight', text: 'Motor de bordes (OpenCV): ' + perf.engine + (perf.restarts ? ` · reinicios: ${perf.restarts}` : '') }),
      ...(lines.length ? lines.map((l) => h('p', { class: 'tight', text: l })) : [h('p', { class: 'tight', text: 'Aún no hay medidas: gira o filtra una página y pulsa Actualizar.' })]));
  };
  // Informe para pegar en un mensaje: el motor que se usa, cuánto tarda cada tarea, errores recientes y datos del teléfono
  const report = () => [
    `WilScan ${APP_VERSION} · ${new Date().toLocaleString()}`,
    `Teléfono: ${navigator.userAgent}`,
    `Núcleos: ${navigator.hardwareConcurrency || '?'} · Memoria: ${navigator.deviceMemory || '?'} GB · Pantalla: ${screen.width}x${screen.height} @${window.devicePixelRatio} · Motores en paralelo: ${cvLanes()}`,
    perf.gpu || 'GPU: sin iniciar', 'OpenCV: ' + perf.engine, `Reinicios de motor: ${perf.restarts || 0} · caídas de GPU a OpenCV: ${perf.gpuFallos || 0}${perf.gpuError ? ' (' + perf.gpuError + ')' : ''}`,
    '', 'Últimas tareas:', ...(perf.log || []), ...(perf.ops || []), '', 'Errores recientes:', ...(perf.errors.length ? perf.errors : ['(ninguno)']),
    '', 'Ajustes: ' + JSON.stringify(getSettings()),
  ].join('\n');
  const copyReport = async () => { drawDiag(); const t = report(); try { await navigator.clipboard.writeText(t); toast('Informe copiado: pégalo en un mensaje', 'ok'); } catch { const a = h('textarea', { value: t, attrs: { 'aria-label': 'Informe' } }); a.style.cssText = 'width:100%;height:140px'; diag.append(a); a.select(); toast('Copia el informe de la caja', 'info'); } };
  drawDiag(); document.addEventListener('click', (e) => { if (e.target.closest('[data-tab="settings"]')) setTimeout(drawDiag, 50); });
  root.append(
    h('div', { class: 'view-head' }, h('h1', { text: 'Ajustes' })),
    h('div', { class: 'set-cols' },
      h('div', {},
        h('div', { class: 'section-title', text: 'Escaneo' }),
        h('div', { class: 'card pad' }, sel('Filtro para las fotos nuevas', FILTERS.map((f) => [f.id, f.label]), 'filter'), chk('Revisar el recorte después de cada foto', 'reviewCrop', 'Ajusta las esquinas y confirma, o repite la foto. Con el disparo automático no se muestra.'), chk('Disparo automático al detectar el documento', 'autoCapture', 'Hace la foto solo cuando el documento está quieto y bien encuadrado.'), chk('Vibrar al hacer una foto', 'haptics')),
        h('div', { class: 'section-title', text: 'Texto (OCR)' }),
        h('div', { class: 'card pad' }, sel('Idioma de los documentos', LANGS.map((l) => [l.id, l.label]), 'ocrLang'), h('p', { class: 'hint', text: 'El reconocimiento de texto funciona sin conexión; los idiomas van incluidos en la app.' })),
        h('div', { class: 'section-title', text: 'PDF' }),
        h('div', { class: 'card pad' }, sel('Tamaño de página', [['auto', 'Automático (según la foto)'], ['a4', 'A4'], ['letter', 'Carta (Letter)'], ['fit', 'Ajustado a la imagen']], 'pdfSize'), sel('Calidad de imagen', [['normal', 'Normal (archivo más ligero)'], ['high', 'Alta'], ['max', 'Máxima']], 'quality'), chk('Dejar márgenes', 'pdfMargin'), chk('PDF buscable por defecto', 'searchablePdf', 'Reconoce el texto para poder buscarlo y copiarlo dentro del PDF. Tarda más al exportar.'))),
      h('div', {},
        h('div', { class: 'section-title', text: 'Aplicación' }),
        h('div', { class: 'card pad' },
          h('button', { id: 'btnInstall', class: 'btn primary block', attrs: { type: 'button' }, hidden: true, on: { click: async () => { if (installEvent) { installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; $('#btnInstall').hidden = true; } } } }, icon('download', 's'), 'Instalar WilScan en este dispositivo'),
          swState, h('div', { class: 'label', text: 'Almacenamiento' }), storage,
          h('div', { class: 'btn-row set-actions' }, h('button', { class: 'btn danger', attrs: { type: 'button' }, on: { click: async () => { if (await confirmBox({ title: '¿Borrar todos los datos?', text: 'Se eliminarán todos los documentos, la firma y los ajustes de este dispositivo. No se puede deshacer.', ok: 'Borrar todo', danger: true })) { await wipeAll(); toast('Datos borrados', 'ok'); setTimeout(() => location.reload(), 700); } } } }, icon('trash', 's'), 'Borrar todos los datos'))),
        h('div', { class: 'section-title', text: 'Diagnóstico de velocidad' }),
        h('div', { class: 'card pad' }, diag, h('div', { class: 'btn-row' }, h('button', { class: 'btn small', attrs: { type: 'button' }, on: { click: () => { loadCV().catch(() => {}).then(drawDiag); } } }, 'Actualizar'), h('button', { class: 'btn small', attrs: { type: 'button' }, on: { click: copyReport } }, icon('copy', 's'), 'Copiar informe'))),
        h('div', { class: 'section-title', text: 'Acerca de' }),
        h('div', { class: 'card pad about' },
          h('div', { class: 'about-head' }, h('img', { src: new URL('../../assets/logo.svg', import.meta.url).href, alt: 'WG', width: 44, height: 44 }), h('div', {}, h('b', { text: 'WilScan' }), h('small', { text: ` versión ${APP_VERSION}` }), h('p', { class: 'hint tight', text: 'Una creación de WG — Wilmar Gómez' }))),
          h('p', { class: 'hint', text: 'Escanea documentos con la cámara, reconoce su texto y trabaja con PDF sin subir nada a ningún servidor.' }),
          h('p', { class: 'hint' }, 'Usa OpenCV.js, Tesseract.js, pdf-lib y PDF.js (código abierto). ', h('a', { href: new URL('../../vendor/LICENCIAS.txt', import.meta.url).href, target: '_blank', rel: 'noopener', text: 'Ver licencias' })))))
  );
  usage().then((u) => { storage.textContent = u.quota ? `${fmtSize(u.used)} usados de ${fmtSize(u.quota)} disponibles.` : 'No disponible en este navegador.'; });
  persist();
  if (isNative()) swState.textContent = 'App de Android: todo funciona sin conexión.';
  else if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(() => { swState.textContent = 'Lista para usar sin conexión.'; }).catch(() => {});
}
