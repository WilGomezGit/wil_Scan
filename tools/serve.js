// Servidor estático mínimo para WilScan (sin dependencias). Uso: node tools/serve.js [puerto] [carpeta]
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[3] || path.join(__dirname, '..', 'web'));
const port = +process.argv[2] || 5180;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.gz': 'application/octet-stream' };

function createServer() {
  return http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
    let f = path.join(root, p);
    if (!f.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); return res.end('No encontrado'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
}
if (require.main === module) createServer().listen(port, '127.0.0.1', () => console.log(`WilScan en http://localhost:${port}`));
module.exports = { createServer };
