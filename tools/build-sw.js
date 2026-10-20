// Genera web/sw-files.json: lista de archivos de la interfaz y de los motores, con una versión (hash) que renueva la caché.
//   node tools/build-sw.js
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const web = path.join(__dirname, '..', 'web');
const walk = (d, out = []) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const rel = (p) => path.relative(web, p).split(path.sep).join('/');
const all = walk(web).map((p) => ({ p, r: rel(p) })).filter((x) => !x.r.startsWith('_lab/') && !['sw.js', 'sw-files.json'].includes(x.r));
const shell = all.filter((x) => !x.r.startsWith('vendor/')).map((x) => x.r).sort();
const vendor = all.filter((x) => x.r.startsWith('vendor/')).map((x) => x.r).sort();
const hash = crypto.createHash('sha1');
for (const r of shell) hash.update(r).update(fs.readFileSync(path.join(web, r)));
const version = hash.digest('hex').slice(0, 10);
fs.writeFileSync(path.join(web, 'sw-files.json'), JSON.stringify({ version, shell: ['./', ...shell], vendor }, null, 1));
console.log(`sw-files.json: versión ${version} · ${shell.length} archivos de interfaz · ${vendor.length} de motores`);
