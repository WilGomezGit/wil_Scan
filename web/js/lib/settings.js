// Ajustes del usuario (se guardan en el dispositivo).
import { kvGet, kvSet } from '../core/db.js';

export const DEFAULTS = {
  ocrLang: 'spa+eng',      // spa | eng | spa+eng
  pdfSize: 'a4',           // a4 | letter | fit
  pdfMargin: true,
  quality: 'high',         // normal | high | max
  searchablePdf: true,     // PDF con texto buscable (usa OCR)
  reviewCrop: true,        // tras cada foto, mostrar el recorte para confirmarlo o repetir
  autoCapture: false,      // dispara solo cuando el documento está quieto y encuadrado
  filter: 'auto',          // filtro por defecto de las fotos nuevas
  haptics: true,
};
export const QUALITY = { normal: 0.78, high: 0.9, max: 0.96 };

let cache = null;
export async function loadSettings() { cache = { ...DEFAULTS, ...(await kvGet('settings', {})) }; return cache; }
export const getSettings = () => cache || { ...DEFAULTS };
export async function setSettings(patch) { cache = { ...getSettings(), ...patch }; await kvSet('settings', cache); return cache; }
export const getSignature = () => kvGet('signature', null);
export const setSignature = (dataUrl) => kvSet('signature', dataUrl);
