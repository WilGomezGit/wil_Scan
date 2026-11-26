// Ajustes del usuario (se guardan en el dispositivo).
import { kvGet, kvSet } from '../core/db.js';

export const DEFAULTS = {
  ocrLang: 'spa+eng',      // spa | eng | spa+eng
  pdfSize: 'auto',         // auto | a4 | letter | fit
  pdfMargin: true,
  quality: 'high',         // normal | high | max
  searchablePdf: false,    // PDF con texto buscable (usa OCR): solo si se pide, porque leer el texto tarda
  reviewCrop: true,        // tras cada foto, mostrar el recorte para confirmarlo o repetir
  autoCapture: true,       // dispara solo cuando el documento está quieto y encuadrado
  filter: 'auto',          // filtro por defecto de las fotos nuevas
  haptics: true,
};
export const QUALITY = { normal: 0.78, high: 0.9, max: 0.96 };

let cache = null;
export async function loadSettings() {
  const saved = await kvGet('settings', {});
  // 1.0.6: el disparo automático pasa a venir activado (como en los escáneres conocidos); se activa una vez también a quien ya tenía ajustes guardados
  if (saved && !saved.v6) { saved.autoCapture = true; saved.v6 = true; }
  // 1.0.8: exportar ya no lee el texto si no se pide (antes «PDF buscable» venía activado y cada PDF esperaba al OCR)
  if (saved && !saved.v8) { saved.searchablePdf = false; saved.v8 = true; }
  cache = { ...DEFAULTS, ...saved }; return cache;
}
export const getSettings = () => cache || { ...DEFAULTS };
export async function setSettings(patch) { cache = { ...getSettings(), ...patch }; await kvSet('settings', cache); return cache; }
export const getSignature = () => kvGet('signature', null);
export const setSignature = (dataUrl) => kvSet('signature', dataUrl);
