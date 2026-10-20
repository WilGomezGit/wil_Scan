// Genera imágenes y videos de prueba: una "foto" de una factura en perspectiva sobre una mesa, y el video falso para la cámara de Chrome.
//   node tests/make-fixtures.js
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { launch } = require('./lib/chrome');
const out = path.join(__dirname, 'fixtures'); fs.mkdirSync(out, { recursive: true });
const FFMPEG = process.env.FFMPEG || 'C:/Users/wilGo/capturo/node_modules/ffmpeg-static/ffmpeg.exe';

const PAGE = (rot) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1280px;height:960px;overflow:hidden;background:#3b2f27;font-family:Arial,Helvetica,sans-serif}
.desk{position:absolute;inset:0;background:radial-gradient(900px 700px at 30% 20%,#5a4638,#2a211b)}
.paper{position:absolute;left:330px;top:90px;width:620px;height:790px;background:#fbfbf6;color:#111;padding:48px 54px;box-sizing:border-box;
 transform:perspective(1400px) ${rot};box-shadow:0 30px 60px rgba(0,0,0,.6);}
.paper::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,rgba(0,0,0,.28),rgba(0,0,0,0) 45%);pointer-events:none}
h1{font-size:34px;margin:0 0 6px}h2{font-size:19px;font-weight:normal;margin:0 0 26px;color:#333}
p{font-size:18px;line-height:1.55;margin:0 0 12px}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:18px}
td,th{border-bottom:1px solid #999;padding:7px 4px;text-align:left}td:last-child,th:last-child{text-align:right}.tot{font-size:24px;font-weight:bold;margin-top:26px;text-align:right}
</style><div class="desk"></div><div class="paper">
<h1>FACTURA 2026-0042</h1><h2>Cliente: Wilmar Gómez · Bogotá</h2>
<p>Este documento es una prueba de escaneo para comprobar el reconocimiento de texto y la corrección de perspectiva.</p>
<table><tr><th>Concepto</th><th>Cantidad</th><th>Importe</th></tr>
<tr><td>Licencia WilScan</td><td>2</td><td>300,00</td></tr><tr><td>Soporte técnico</td><td>5</td><td>750,00</td></tr><tr><td>Cámara virtual</td><td>1</td><td>200,00</td></tr></table>
<div class="tot">Total a pagar: 1.250,00 EUR</div>
<p style="margin-top:30px">Gracias por su confianza. Pago a 30 días.</p></div>`;

(async () => {
  const c = await launch({ url: 'about:blank', width: 1280, height: 1060 });
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  const shots = { 'factura-persp': 'rotateY(-14deg) rotateX(8deg) rotateZ(-3deg)', 'factura-recta': 'rotateZ(0deg)', 'factura-giro': 'rotateY(10deg) rotateX(-6deg) rotateZ(7deg)' };
  for (const [name, rot] of Object.entries(shots)) {
    await c.ev(`document.open(); document.write(${JSON.stringify(PAGE(rot))}); document.close(); true`);
    await c.sleep(500);
    await c.shot(path.join(out, name + '.png'));
    console.log('  ' + name + '.png');
  }
  // foto torcida SIN bordes de papel visibles: el texto llena toda la imagen y está girado 6°
  const FULL = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:960px;overflow:hidden;background:#f4f2ea;font-family:Arial,Helvetica,sans-serif}.t{position:absolute;left:-200px;top:-200px;width:1700px;height:1400px;padding:260px 300px;box-sizing:border-box;transform:rotate(6deg);transform-origin:50% 50%;color:#1a1a1a;font-size:26px;line-height:1.7}h1{font-size:46px;margin:0 0 14px}p{margin:0 0 14px}</style><div class="t"><h1>CONTRATO DE ARRENDAMIENTO 118</h1><p>En Bogotá, a veinte de octubre de 2026, el arrendador Wilmar Gómez entrega en alquiler el local comercial ubicado en la carrera séptima.</p><p>El canon mensual es de 1.250.000 pesos, pagaderos dentro de los primeros cinco días de cada mes por transferencia bancaria.</p><p>El arrendatario se compromete a conservar el inmueble en buen estado y a devolverlo al finalizar el contrato.</p><p>Las partes firman en señal de conformidad en dos ejemplares del mismo tenor y a un solo efecto.</p></div>`;
  await c.ev(`document.open(); document.write(${JSON.stringify(FULL)}); document.close(); true`);
  await c.sleep(500);
  await c.shot(path.join(out, 'texto-torcido.png'));
  console.log('  texto-torcido.png');
  await c.close();
  // video falso para la cámara: la factura en perspectiva, 2 s a 5 fps (y4m)
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-loop', '1', '-i', path.join(out, 'factura-persp.png'), '-t', '2', '-r', '5', '-pix_fmt', 'yuv420p', path.join(out, 'camara.y4m')]);
  console.log(r.status === 0 ? '  camara.y4m' : 'ffmpeg falló: ' + r.stderr);
})().catch((e) => { console.error(e); process.exit(1); });
