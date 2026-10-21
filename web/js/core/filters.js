// Filtros de documento con OpenCV: quitar sombras, mejorar, grises, blanco y negro y color vivo, más brillo y contraste.
import { cvRun, canvasFrom, imageOf } from './cv.js';

export const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'auto', label: 'Mejorado' },
  { id: 'sombras', label: 'Sin sombras' },
  { id: 'color', label: 'Color vivo' },
  { id: 'gris', label: 'Grises' },
  { id: 'bn', label: 'Blanco y negro' },
];

// opts: { filter, bright (-50..50), contrast (-50..50) }  →  lienzo nuevo
export async function applyFilter(src, { filter = 'auto', bright = 0, contrast = 0 } = {}) {
  return canvasFrom(await cvRun('filter', [imageOf(src), { filter, bright, contrast }]));
}
