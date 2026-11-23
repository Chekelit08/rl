// Almacenamiento local de repeticiones y clips (IndexedDB). Si no está disponible, queda en memoria.

import { bytesToInt16, gunzip, gzip, int16ToBytes, type ReplayKind, type ReplayMeta } from './format.ts';

const DB_NAME = 'turbogol';
const DB_VERSION = 1;
const MAX_AUTO = { partido: 10, clip: 40 } as const; // las no guardadas a mano rotan

interface DataRecord { id: string; bytes: Uint8Array; gz: boolean }

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memMeta = new Map<string, ReplayMeta>();
const memData = new Map<string, DataRecord>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result: T | undefined;
    const req = fn(t);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function listReplays(kind?: ReplayKind): Promise<ReplayMeta[]> {
  const db = await openDb();
  let all: ReplayMeta[];
  if (!db) all = [...memMeta.values()];
  else {
    try { all = ((await tx<ReplayMeta[]>(db, ['meta'], 'readonly', (t) => t.objectStore('meta').getAll())) ?? []); } catch { all = [...memMeta.values()]; }
  }
  return all.filter((m) => !kind || m.kind === kind).sort((a, b) => b.date - a.date);
}

export async function saveReplay(meta: ReplayMeta, frames: Int16Array): Promise<void> {
  const z = await gzip(int16ToBytes(frames));
  const rec: DataRecord = { id: meta.id, bytes: z.data, gz: z.compressed };
  const db = await openDb();
  if (!db) { memMeta.set(meta.id, meta); memData.set(meta.id, rec); }
  else {
    try {
      await tx(db, ['meta', 'data'], 'readwrite', (t) => { t.objectStore('meta').put(meta); t.objectStore('data').put(rec); });
    } catch {
      memMeta.set(meta.id, meta); memData.set(meta.id, rec);
    }
  }
  await prune(meta.kind);
}

export async function loadReplay(id: string): Promise<{ meta: ReplayMeta; frames: Int16Array } | null> {
  const db = await openDb();
  let meta: ReplayMeta | undefined, rec: DataRecord | undefined;
  if (db) {
    try {
      meta = await tx<ReplayMeta>(db, ['meta'], 'readonly', (t) => t.objectStore('meta').get(id));
      rec = await tx<DataRecord>(db, ['data'], 'readonly', (t) => t.objectStore('data').get(id));
    } catch { /* usar memoria */ }
  }
  meta ??= memMeta.get(id);
  rec ??= memData.get(id);
  if (!meta || !rec) return null;
  const raw = await gunzip(rec.bytes, rec.gz);
  return { meta, frames: bytesToInt16(raw) };
}

export async function updateMeta(meta: ReplayMeta): Promise<void> {
  const db = await openDb();
  if (!db) { memMeta.set(meta.id, meta); return; }
  try { await tx(db, ['meta'], 'readwrite', (t) => { t.objectStore('meta').put(meta); }); } catch { memMeta.set(meta.id, meta); }
}

export async function deleteReplay(id: string): Promise<void> {
  memMeta.delete(id);
  memData.delete(id);
  const db = await openDb();
  if (!db) return;
  try { await tx(db, ['meta', 'data'], 'readwrite', (t) => { t.objectStore('meta').delete(id); t.objectStore('data').delete(id); }); } catch { /* ignorar */ }
}

/** Borra las grabaciones automáticas más viejas (las guardadas a mano se conservan). */
async function prune(kind: ReplayKind) {
  const list = (await listReplays(kind)).filter((m) => !m.saved);
  const max = MAX_AUTO[kind];
  for (const m of list.slice(max)) await deleteReplay(m.id);
}
