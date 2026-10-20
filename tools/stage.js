// Prepara la carpeta www/ (la web sin archivos de prueba) para empaquetarla en Android y para publicarla.
//   node tools/stage.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = path.join(root, 'web'), dst = path.join(root, 'www');
require('./build-sw.js');
fs.rmSync(dst, { recursive: true, force: true });
const copy = (a, b) => { fs.mkdirSync(b, { recursive: true }); for (const n of fs.readdirSync(a)) { if (n === '_lab') continue; const s = path.join(a, n), d = path.join(b, n); fs.statSync(s).isDirectory() ? copy(s, d) : fs.copyFileSync(s, d); } };
copy(src, dst);
console.log('www/ listo');
