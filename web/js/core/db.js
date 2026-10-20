// Almacenamiento local (IndexedDB): documentos, páginas con sus imágenes, y ajustes. Nada sale del dispositivo.
const NAME = 'wilscan', VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('docs', { keyPath: 'id' });
      const pages = db.createObjectStore('pages', { keyPath: 'id' });
      pages.createIndex('docId', 'docId');
      db.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error || new Error('No se pudo abrir el almacenamiento local.')); };
  });
  return dbp;
}

const run = async (store, mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), st = Array.isArray(store) ? null : tx.objectStore(store);
    let out;
    try { out = fn(st, tx); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(out && out.result !== undefined && out instanceof IDBRequest ? out.result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Operación cancelada'));
  });
};
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ---- documentos ----
export async function listDocs() {
  const db = await open();
  const docs = await req(db.transaction('docs').objectStore('docs').getAll());
  return docs.sort((a, b) => b.updated - a.updated);
}
export async function getDoc(id) { const db = await open(); return req(db.transaction('docs').objectStore('docs').get(id)); }
export const saveDoc = (doc) => run('docs', 'readwrite', (s) => s.put({ ...doc, updated: Date.now() }));
export async function deleteDoc(id) {
  const db = await open();
  const tx = db.transaction(['docs', 'pages'], 'readwrite');
  tx.objectStore('docs').delete(id);
  const idx = tx.objectStore('pages').index('docId');
  const keys = await req(idx.getAllKeys(IDBKeyRange.only(id)));
  for (const k of keys) tx.objectStore('pages').delete(k);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

// ---- páginas ----
export async function getPage(id) { const db = await open(); return req(db.transaction('pages').objectStore('pages').get(id)); }
export const savePage = (page) => run('pages', 'readwrite', (s) => s.put(page));
export const deletePage = (id) => run('pages', 'readwrite', (s) => s.delete(id));
export async function getPages(ids) {
  const db = await open();
  const st = db.transaction('pages').objectStore('pages');
  const all = await Promise.all(ids.map((id) => req(st.get(id))));
  return all.filter(Boolean);
}

// ---- ajustes ----
export async function kvGet(key, def = null) { const db = await open(); const v = await req(db.transaction('kv').objectStore('kv').get(key)); return v === undefined ? def : v; }
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));

export async function usage() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return { used: 0, quota: 0 }; }
}
export async function wipeAll() {
  const db = await open();
  const tx = db.transaction(['docs', 'pages', 'kv'], 'readwrite');
  for (const n of ['docs', 'pages', 'kv']) tx.objectStore(n).clear();
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export function persist() { try { return navigator.storage && navigator.storage.persist ? navigator.storage.persist() : Promise.resolve(false); } catch { return Promise.resolve(false); } }
