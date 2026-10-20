// Guardar y compartir archivos: en Android (app) con la hoja de compartir del sistema; en el navegador, compartir o descargar.
export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

function toBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  return 'downloaded';
}

// files: [{ blob, name }]. mode: 'share' (hoja de compartir) | 'save' (descargar / guardar en archivos)
// Devuelve 'shared' | 'downloaded' | 'cancelled'
export async function deliver(files, { mode = 'share', title = '' } = {}) {
  if (isNative()) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    const uris = [];
    for (const f of files) {
      const path = `wilscan/${Date.now()}-${f.name}`;
      const r = await Filesystem.writeFile({ path, data: await toBase64(f.blob), directory: 'CACHE', recursive: true });
      uris.push(r.uri);
    }
    try { await Share.share({ title: title || files[0].name, files: uris, dialogTitle: mode === 'save' ? 'Guardar en…' : 'Compartir' }); return 'shared'; }
    catch (e) { if (/cancel/i.test(String(e && e.message))) return 'cancelled'; throw e; }
  }
  const objs = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
  if (mode === 'share' && navigator.canShare && navigator.canShare({ files: objs })) {
    try { await navigator.share({ files: objs, title: title || files[0].name }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  for (const f of files) { download(f.blob, f.name); await new Promise((r) => setTimeout(r, 250)); }
  return 'downloaded';
}
