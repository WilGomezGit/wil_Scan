// Crear PDF a partir de páginas escaneadas (imagen + capa de texto invisible si hay OCR, para poder buscar y copiar).
let libP = null;

export function loadPdfLib() {
  if (libP) return libP;
  libP = new Promise((resolve, reject) => {
    if (window.PDFLib) return resolve(window.PDFLib);
    const s = document.createElement('script');
    s.src = new URL('../../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => resolve(window.PDFLib);
    s.onerror = () => { libP = null; reject(new Error('No se pudo cargar el creador de PDF.')); };
    document.head.appendChild(s);
  });
  return libP;
}

export const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

// pages: [{ blob (JPEG), w, h, words? [{text,x0,y0,x1,y1}] }]  →  Uint8Array
// opts: { size: 'auto'|'a4'|'letter'|'fit', margin (pt), title, author }
// Papel que mejor encaja con la proporción de la foto: A4, Carta o, si no se parece a ninguno (recibo, tarjeta…), ajustado a la imagen
export function pickPaper(w, h) {
  const r = Math.max(w, h) / Math.min(w, h), a4 = Math.abs(r - 1.4142) / 1.4142, lt = Math.abs(r - 1.2941) / 1.2941;
  if (Math.min(a4, lt) > 0.08) return 'fit';
  return a4 <= lt ? 'a4' : 'letter';
}

export async function buildPdf(pages, { size: sizeOpt = 'auto', margin = 0, title = '', author = 'WilScan' } = {}) {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  pdf.setTitle(title || 'Documento'); pdf.setAuthor(author); pdf.setCreator('WilScan · WG'); pdf.setProducer('WilScan');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const p of pages) {
    const size = sizeOpt === 'auto' ? pickPaper(p.w, p.h) : sizeOpt;
    const img = await pdf.embedJpg(new Uint8Array(await p.blob.arrayBuffer()));
    let pw, ph;
    if (size === 'fit') { const k = 842 / Math.max(p.w, p.h); pw = p.w * k; ph = p.h * k; }
    else { [pw, ph] = PAGE_SIZES[size] || PAGE_SIZES.a4; if (p.w > p.h * 1.1) [pw, ph] = [ph, pw]; }
    const page = pdf.addPage([pw, ph]);
    const m = size === 'fit' ? 0 : margin, aw = pw - 2 * m, ah = ph - 2 * m;
    const k = Math.min(aw / p.w, ah / p.h), dw = p.w * k, dh = p.h * k, ox = (pw - dw) / 2, oy = (ph - dh) / 2;
    page.drawImage(img, { x: ox, y: oy, width: dw, height: dh });
    for (const w of p.words || []) {
      const h = Math.max(4, (w.y1 - w.y0) * k * 0.9);
      let text = w.text;
      try { font.encodeText(text); } catch { text = text.replace(/[^\x20-\xff]/g, ''); if (!text) continue; try { font.encodeText(text); } catch { continue; } }
      page.drawText(text, { x: ox + w.x0 * k, y: oy + dh - w.y1 * k + h * 0.2, size: h, font, opacity: 0 });   // texto invisible sobre la imagen
    }
  }
  return pdf.save();
}
