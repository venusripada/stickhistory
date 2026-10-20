// Browser storage that never throws (private windows, blocked storage, full
// quota). Only small settings live here; episodes come from the library server.

export const storage = {
  get(key, where = 'local') { try { return (where === 'session' ? sessionStorage : localStorage).getItem(key); } catch { return null; } },
  set(key, value, where = 'local') { try { (where === 'session' ? sessionStorage : localStorage).setItem(key, value); return true; } catch { return false; } },
  del(key, where = 'local') { try { (where === 'session' ? sessionStorage : localStorage).removeItem(key); } catch { /* ignore */ } },
};

/** Episodes and the GitHub token used to be kept in the browser; the library server holds episodes now. */
export function dropLegacyCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('cw:ep:') || ['cw:cache-index', 'cw:token', 'cw:limit'].includes(k)) localStorage.removeItem(k);
    sessionStorage.removeItem('cw:token');
  } catch { /* storage blocked */ }
  try { indexedDB.deleteDatabase('commit-wars'); } catch { /* not available */ }
}
