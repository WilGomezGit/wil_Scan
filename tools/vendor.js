// Copia las librerías de terceros desde node_modules a web/vendor/ (la web no usa bundler: carga archivos separados).
//   npm install && node tools/vendor.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.join(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = (p) => path.join(root, 'web', 'vendor', p);
const copy = (from, to) => { fs.mkdirSync(path.dirname(out(to)), { recursive: true }); fs.copyFileSync(nm(from), out(to)); console.log('  ' + to + '  ' + (fs.statSync(out(to)).size / 1048576).toFixed(2) + ' MB'); };

// OpenCV.js (Apache-2.0): detección de bordes, perspectiva y filtros
copy('@techstark/opencv-js/dist/opencv.js', 'opencv/opencv.js');
// pdf-lib (MIT): crear y editar PDF
copy('pdf-lib/dist/pdf-lib.min.js', 'pdf-lib/pdf-lib.min.js');
// pdf.js (Apache-2.0): leer y dibujar PDF
copy('pdfjs-dist/build/pdf.min.mjs', 'pdfjs/pdf.min.js');
copy('pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.js');
// Tesseract.js (Apache-2.0): OCR sin conexión (núcleo con wasm incrustado: tres variantes según la CPU)
copy('tesseract.js/dist/tesseract.min.js', 'tesseract/tesseract.min.js');
copy('tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js');
for (const v of ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']) copy(`tesseract.js-core/${v}.wasm.js`, `tesseract/core/${v}.wasm.js`);
// Datos de idioma (Apache-2.0). Tesseract espera .traineddata.gz
for (const l of ['spa', 'eng']) copy(`@tesseract.js-data/${l}/4.0.0/${l}.traineddata.gz`, `tesseract/lang/${l}.traineddata.gz`);

// avisos de licencia
const lic = [['@techstark/opencv-js', 'OpenCV.js · Apache-2.0'], ['pdf-lib', 'pdf-lib · MIT'], ['pdfjs-dist', 'PDF.js · Apache-2.0'], ['tesseract.js', 'Tesseract.js · Apache-2.0'], ['tesseract.js-core', 'Tesseract core · Apache-2.0'], ['@tesseract.js-data/spa', 'Datos de idioma (spa, eng) · Apache-2.0']];
const lines = ['WilScan usa estas librerías de código abierto, incluidas sin modificar:', ''];
for (const [pkg, name] of lic) { const j = JSON.parse(fs.readFileSync(nm(pkg + '/package.json'), 'utf8')); lines.push(`- ${name} — ${pkg}@${j.version}${j.homepage ? ' — ' + j.homepage : ''}`); }
lines.push('', 'Los textos completos de las licencias están en cada paquete de npm (carpeta node_modules/<paquete>/LICENSE).');
fs.writeFileSync(out('LICENCIAS.txt'), lines.join('\n') + '\n');
console.log('listo');
