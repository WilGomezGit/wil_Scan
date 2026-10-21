// Genera los iconos PNG de la PWA y de Android a partir de web/assets/icon.svg (usa Chrome, sin dependencias).
//   node tools/make-icons.js
// icon.svg: WG arriba y franja «WIL SCANNER» abajo; el fondo y la franja se salen del cuadro para servir de capa adaptable en Android.
const fs = require('fs'), path = require('path');
const { launch } = require('../tests/lib/chrome');
const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'web', 'assets', 'icon.svg'), 'utf8');
// mismo dibujo con más margen alrededor (para las zonas seguras de los iconos adaptables y "maskable")
const withView = (pad) => svg.replace('viewBox="0 0 512 512"', `viewBox="${-pad} ${-pad} ${512 + 2 * pad} ${512 + 2 * pad}"`);

(async () => {
  const c = await launch({ url: 'about:blank', width: 700, height: 700 });
  // shape: 'square' (sin recorte), 'rounded' (esquinas redondeadas), 'circle'
  const render = (size, { pad = 0, shape = 'rounded' } = {}) => c.ev(`new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const s = ${size}, k = document.createElement('canvas'); k.width = k.height = s; const x = k.getContext('2d');
      x.beginPath();
      if (${JSON.stringify(shape)} === 'rounded') x.roundRect(0, 0, s, s, s * 0.22);
      else if (${JSON.stringify(shape)} === 'circle') x.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
      else x.rect(0, 0, s, s);
      x.clip(); x.drawImage(img, 0, 0, s, s);
      res(k.toDataURL('image/png')); };
    img.onerror = () => rej(new Error('SVG no válido'));
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(${JSON.stringify(pad ? withView(pad) : svg)})));
  })`).then((d) => Buffer.from(d.split(',')[1], 'base64'));
  const out = path.join(root, 'web', 'assets');
  fs.writeFileSync(path.join(out, 'icon-192.png'), await render(192));
  fs.writeFileSync(path.join(out, 'icon-512.png'), await render(512));
  fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), await render(512, { pad: 64, shape: 'square' }));   // zona segura: círculo del 80 %
  // Android: icono clásico, redondo y capa delantera del icono adaptable (108 dp, de los que se ven los 72 centrales)
  const keep = path.join(root, 'tools', 'android-icons'); fs.mkdirSync(keep, { recursive: true });
  const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
  for (const [dir, px, fg] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
    const files = { 'ic_launcher.png': await render(px), 'ic_launcher_round.png': await render(px, { shape: 'circle' }), 'ic_launcher_foreground.png': await render(fg, { pad: 128, shape: 'square' }) };
    for (const [name, buf] of Object.entries(files)) {
      fs.writeFileSync(path.join(keep, name.replace('.png', `-${dir}.png`)), buf);
      if (fs.existsSync(path.join(res, `mipmap-${dir}`))) fs.writeFileSync(path.join(res, `mipmap-${dir}`, name), buf);
    }
  }
  await c.close();
  console.log('iconos generados');
})().catch((e) => { console.error(e); process.exit(1); });
