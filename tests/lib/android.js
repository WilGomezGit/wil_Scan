// Conexión a la app WilScan instalada en Android (BlueStacks / emulador) a través del depurador del WebView.
// Requiere el APK de depuración (WebView depurable) y adb. Devuelve la misma API que lib/chrome.js.
const { execFileSync } = require('child_process');
const fs = require('fs'), http = require('http');
const WebSocket = require('ws');

const ADB = process.env.ADB || 'C:/Program Files/BlueStacks_nxt/HD-Adb.exe';
const DEV = process.env.ANDROID_SERIAL || '127.0.0.1:5555';
const PKG = 'com.wg.wilscan';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, ['-s', DEV, ...a], { encoding: 'utf8', windowsHide: true, timeout: 120000 });

async function connect({ restart = false, port = 9555 } = {}) {
  if (restart) { adb('shell', 'am', 'force-stop', PKG); await sleep(800); }
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  let pid = '';
  for (let i = 0; i < 40 && !pid; i++) { await sleep(300); pid = adb('shell', 'pidof', PKG).trim(); }
  let sock = '';
  for (let i = 0; i < 40 && !sock; i++) { await sleep(300); const m = /webview_devtools_remote_(\d+)/.exec(adb('shell', 'cat', '/proc/net/unix')); if (m) sock = m[0]; }
  if (!sock) throw new Error('El WebView de la app no expone el depurador (¿APK de depuración?)');
  try { adb('forward', '--remove', `tcp:${port}`); } catch { /* no había */ }
  adb('forward', `tcp:${port}`, `localabstract:${sock}`);
  const getJson = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));
  let tgt = null;
  for (let i = 0; i < 40 && !tgt; i++) { await sleep(300); try { tgt = (await getJson('/json')).find((t) => t.type === 'page'); } catch { /* aún no */ } }
  if (!tgt) throw new Error('No se encontró la página de la app');
  const ws = new WebSocket(tgt.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let id = 0; const pend = new Map(); const logs = [];
  ws.on('message', (m) => {
    const j = JSON.parse(String(m));
    if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); }
    else if (j.method === 'Runtime.exceptionThrown') { const d = j.params.exceptionDetails; logs.push('EXC ' + (((d.exception && (d.exception.description || d.exception.value)) || d.text) + ' @' + (d.url || '') + ':' + d.lineNumber).slice(0, 400)); }
    else if (j.method === 'Runtime.consoleAPICalled' && /error/.test(j.params.type)) logs.push('console.error ' + j.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error('CDP: ' + r.error.message);
    if (r.result.exceptionDetails) { const d = r.result.exceptionDetails; throw new Error((d.exception && d.exception.description) || d.text); }
    return r.result.result.value;
  };
  const until = async (fn, ms = 10000, step = 200) => { const t = Date.now(); while (Date.now() - t < ms) { let v; try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(step); } return null; };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); return file; };
  // archivos: se copian al dispositivo y se entregan al <input type=file> con su ruta en Android
  const setFiles = async (selector, paths) => {
    const remote = [];
    for (const p of paths) { const dst = '/sdcard/Download/wilscan-test-' + require('path').basename(p); adb('push', p, dst); remote.push(dst); }
    await send('DOM.enable');
    const doc = await send('DOM.getDocument', { depth: 1 });
    const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
    if (!q.result || !q.result.nodeId) throw new Error('No existe ' + selector);
    const r = await send('DOM.setFileInputFiles', { files: remote, nodeId: q.result.nodeId });
    if (r.error) throw new Error('setFileInputFiles: ' + r.error.message);
  };
  await send('Page.enable'); await send('Runtime.enable');
  const close = async () => { try { ws.close(); } catch { /* ya cerrado */ } };
  return { ev, send, until, shot, close, logs, sleep, setFiles, adb };
}
module.exports = { connect, sleep, adb };
