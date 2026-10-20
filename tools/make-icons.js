// Genera los iconos PNG de la PWA y de Android a partir de web/assets/logo.svg (usa Chrome, sin dependencias).
//   node tools/make-icons.js
const fs = require('fs'), path = require('path');
const { launch } = require('../tests/lib/chrome');
const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'web', 'assets', 'logo.svg'), 'utf8');

(async () => {
  const c = await launch({ url: 'about:blank', width: 700, height: 700 });
  const render = (size, { maskable = false } = {}) => c.ev(`new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const k = document.createElement('canvas'); k.width = k.height = ${size}; const x = k.getContext('2d');
      ${maskable ? `x.fillStyle = '#0b0b12'; x.fillRect(0, 0, ${size}, ${size}); const s = ${size} * 0.66, o = (${size} - s) / 2; x.drawImage(img, o, o, s, s);` : `x.drawImage(img, 0, 0, ${size}, ${size});`}
      res(k.toDataURL('image/png')); };
    img.onerror = () => rej(new Error('SVG no válido'));
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(${JSON.stringify(svg)})));
  })`).then((d) => Buffer.from(d.split(',')[1], 'base64'));
  const out = path.join(root, 'web', 'assets');
  fs.writeFileSync(path.join(out, 'icon-192.png'), await render(192));
  fs.writeFileSync(path.join(out, 'icon-512.png'), await render(512));
  fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), await render(512, { maskable: true }));
  // iconos para el proyecto de Android (se copian después al crearlo)
  const res = path.join(root, 'tools', 'android-icons'); fs.mkdirSync(res, { recursive: true });
  for (const [dir, px] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) fs.writeFileSync(path.join(res, `ic_launcher-${dir}.png`), await render(px));
  for (const [dir, px] of [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]]) fs.writeFileSync(path.join(res, `ic_foreground-${dir}.png`), await render(px, { maskable: true }));
  await c.close();
  console.log('iconos generados');
})().catch((e) => { console.error(e); process.exit(1); });
