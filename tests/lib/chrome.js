// Chrome real manejado por CDP (perfil temporal propio; no toca el del usuario). Sirve a las pruebas de WilScan.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const WebSocket = require('ws');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch({ url = 'about:blank', fakeVideo = null, mobile = false, width = 1000, height = 800, extraFlags = [], downloadDir = null } = {}) {
  const port = 9500 + Math.floor(Math.random() * 400);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'wilscan-chrome-'));
  const flags = [`--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--lang=es',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
    `--window-size=${width},${height}`, '--window-position=30,30', ...extraFlags];
  // las descargas de las pruebas SIEMPRE van a una carpeta propia: se fija en las preferencias del perfil antes de arrancar
  const dl = downloadDir || path.join(prof, 'descargas');
  fs.mkdirSync(dl, { recursive: true }); fs.mkdirSync(path.join(prof, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(prof, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: dl, prompt_for_download: false, directory_upgrade: true }, savefile: { default_directory: dl } }));
  if (fakeVideo) flags.push(`--use-file-for-fake-video-capture=${fakeVideo}`);
  const proc = spawn(CHROME, [...flags, 'about:blank'], { stdio: 'ignore' });
  const getJson = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));
  let tgt = null;
  for (let i = 0; i < 60 && !tgt; i++) { await sleep(400); try { tgt = (await getJson('/json')).find((t) => t.type === 'page'); } catch { /* arrancando */ } }
  if (!tgt) throw new Error('Chrome no arrancó');
  const ws = new WebSocket(tgt.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.on('message', (m) => {
    const j = JSON.parse(String(m));
    if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); }
    else if (j.method === 'Runtime.exceptionThrown') { const d = j.params.exceptionDetails; logs.push('EXC ' + (((d.exception && (d.exception.description || d.exception.value)) || d.text) + ' @' + (d.url || '') + ':' + d.lineNumber).slice(0, 400)); }
    else if (j.method === 'Runtime.consoleAPICalled' && /error/.test(j.params.type)) logs.push('console.error ' + j.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300));
    else if (j.method === 'Inspector.targetCrashed') logs.push('CRASH: la pestaña se cayó');
    else if (j.method === 'Page.frameNavigated' && !j.params.frame.parentId && global.__navLog) logs.push('NAV ' + j.params.frame.url);
    else if (j.method === 'Log.entryAdded' && j.params.entry.level === 'error') logs.push('log ' + j.params.entry.text.slice(0, 200) + ' ' + (j.params.entry.url || ''));
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error('CDP: ' + r.error.message + (logs.length ? ' · ' + logs.slice(-3).join(' · ') : ''));
    if (r.result.exceptionDetails) { const d = r.result.exceptionDetails; throw new Error((d.exception && d.exception.description) || d.text); }
    return r.result.result.value;
  };
  const until = async (fn, ms = 10000, step = 200) => { const t = Date.now(); while (Date.now() - t < ms) { let v; try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(step); } return null; };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); return file; };
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Page.bringToFront');
  // las descargas de las pruebas van a una carpeta propia (nunca a las descargas reales del usuario)
  if (downloadDir) {
    fs.mkdirSync(downloadDir, { recursive: true });
    const ver = await getJson('/json/version');
    const bws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((r) => bws.on('open', r));
    bws.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'allow', downloadPath: downloadDir } }));
    await sleep(300); bws.close();
  }
  const setFiles = async (selector, paths) => {
    await send('DOM.enable');
    const doc = await send('DOM.getDocument', { depth: 1 });
    const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
    if (!q.result.nodeId) throw new Error('No existe ' + selector);
    await send('DOM.setFileInputFiles', { files: paths, nodeId: q.result.nodeId });
  };
  if (mobile) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  }
  const goto = async (u) => { await send('Page.navigate', { url: u }); await until(() => ev(`document.readyState==='complete'`), 20000, 150); };
  if (url !== 'about:blank') await goto(url);
  const close = async () => {
    try { ws.close(); } catch { /* ya cerrado */ }
    try { proc.kill(); } catch { /* ya cerrado */ }
    await sleep(600);
    if (process.platform === 'win32') spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'wilscan-chrome-' -and $_.CommandLine -match '${port}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { windowsHide: true });
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* en uso: no crítico */ }
  };
  return { ev, send, until, shot, mouse, touch, goto, close, logs, sleep, setFiles };
}
module.exports = { launch, sleep };
