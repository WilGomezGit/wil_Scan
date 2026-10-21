// Filtros de documento con OpenCV: quitar sombras, mejorar, grises, blanco y negro, color vivo, nítido, nota a lápiz y pizarra, más brillo y contraste.
import { cvRun, canvasFrom, imageOf, canvasOf } from './cv.js';

export const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'auto', label: 'Mejorado' },
  { id: 'sombras', label: 'Sin sombras' },
  { id: 'color', label: 'Color vivo' },
  { id: 'gris', label: 'Grises' },
  { id: 'bn', label: 'Blanco y negro' },
  { id: 'nitido', label: 'Nítido' },
  { id: 'nota', label: 'Nota a lápiz' },
  { id: 'pizarra', label: 'Pizarra' },
];

// opts: { filter, bright (-50..50), contrast (-50..50) }  →  lienzo nuevo
export async function applyFilter(src, { filter = 'auto', bright = 0, contrast = 0 } = {}) {
  if (filter === 'original' && !bright && !contrast) { const c = canvasOf(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }   // nada que calcular
  return canvasFrom(await cvRun('filter', [imageOf(src), { filter, bright, contrast }]));
}
