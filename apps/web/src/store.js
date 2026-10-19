// Browser storage that never throws (private windows, blocked storage, full
// quota). Small settings live in localStorage; built episodes (a few MB each)
// live in IndexedDB, newest 8 kept, with an in-memory fallback.

export const storage = {
  get(key, where = 'local') { try { return (where === 'session' ? sessionStorage : localStorage).getItem(key); } catch { return null; } },
  set(key, value, where = 'local') { try { (where === 'session' ? sessionStorage : localStorage).setItem(key, value); return true; } catch { return false; } },
  del(key, where = 'local') { try { (where === 'session' ? sessionStorage : localStorage).removeItem(key); } catch { /* ignore */ } },
};

const MAX_ENTRIES = 8;
const memory = new Map();
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open('commit-wars', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('episodes', { keyPath: 'key' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbp;
}
function run(mode, fn) {
  return db().then((d) => new Promise((resolve) => {
    if (!d) { resolve(undefined); return; }
    try {
      const tx = d.transaction('episodes', mode);
      const out = fn(tx.objectStore('episodes'));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : true);
      tx.onerror = tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  }));
}

/** @returns {Promise<{ savedAt: string, episode: object } | null>} */
export async function cacheGet(key) {
  const row = (await run('readonly', (s) => s.get(key))) || memory.get(key);
  return row ? { savedAt: row.savedAt, episode: row.episode } : null;
}

export async function cacheSet(key, value) {
  const row = { key, savedAt: value.savedAt, episode: value.episode };
  const ok = await run('readwrite', (s) => s.put(row));
  if (!ok) { memory.set(key, row); return false; }
  const all = (await run('readonly', (s) => s.getAll())) || [];
  const old = all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)).slice(MAX_ENTRIES);
  if (old.length) await run('readwrite', (s) => { old.forEach((r) => s.delete(r.key)); });
  return true;
}

/** Episodes used to be cached in localStorage; drop those (they are an older format anyway). */
export function dropLegacyCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('cw:ep:') || k === 'cw:cache-index') localStorage.removeItem(k);
  } catch { /* storage blocked */ }
}
