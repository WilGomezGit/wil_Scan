// Pantalla de arranque de Android: fondo oscuro con el logo WG. node tools/make-splash.js
const fs = require('fs'), path = require('path');
const { launch } = require('../tests/lib/chrome');
const svg = fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'logo.svg'), 'utf8');
const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
(async () => {
  const c = await launch({ url: 'about:blank', width: 800, height: 800 });
  const render = (w, h) => c.ev(`new Promise((res)=>{const i=new Image(); i.onload=()=>{const k=document.createElement('canvas'); k.width=${w}; k.height=${h}; const x=k.getContext('2d'); x.fillStyle='#0b0b12'; x.fillRect(0,0,${w},${h}); const s=Math.min(${w},${h})*0.34; x.drawImage(i,(${w}-s)/2,(${h}-s)/2,s,s); res(k.toDataURL('image/png'))}; i.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(${JSON.stringify(svg)})));})`).then((d) => Buffer.from(d.split(',')[1], 'base64'));
  const sizes = { 'drawable': [480, 320], 'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280] };
  for (const [d, [w, h]] of Object.entries(sizes)) { const dir = path.join(res, d); if (fs.existsSync(path.join(dir, 'splash.png'))) fs.writeFileSync(path.join(dir, 'splash.png'), await render(w, h)); }
  await c.close(); console.log('splash listo');
})();
