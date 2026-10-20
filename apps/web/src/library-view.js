// How the library is shown: quick search, status filter, sorting and pages.
// Display only; what a story is and what state it's in comes from the server.

export const PAGE_SIZE = 60;

export const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'building', label: 'Building or waiting' },
  { key: 'failed', label: 'Failed' },
  { key: 'small', label: 'Too small to play' },
  { key: 'unbuilt', label: 'Not built yet' },
];

export const SORTS = [
  { key: 'name', label: 'Name A–Z' },
  { key: 'commits', label: 'Most commits' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'active', label: 'Most recent activity' },
];

/** ready | building | failed | small | unbuilt */
export function statusOf(st) {
  if (st.status === 'small') return 'small';
  if (['queued', 'cloning', 'building', 'fetching'].includes(st.status)) return 'building';
  if (st.status === 'error' || st.status === 'not-set-up') return 'failed';
  return st.hasEpisode ? 'ready' : 'unbuilt';
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true });
const SORTERS = {
  name: byName,
  commits: (a, b) => (b.commits || 0) - (a.commits || 0) || byName(a, b),
  updated: (a, b) => String(b.fetchedAt || '').localeCompare(String(a.fetchedAt || '')) || byName(a, b),
  active: (a, b) => String(b.last || '').localeCompare(String(a.last || '')) || byName(a, b),
};

/**
 * @param {any[]} stories
 * @param {{ q?: string, status?: string, sort?: string }} [o]
 */
export function filterStories(stories, o = {}) {
  const words = String(o.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const status = o.status && o.status !== 'all' ? o.status : null;
  return stories
    .filter((s) => !status || statusOf(s) === status)
    .filter((s) => {
      if (!words.length) return true;
      const hay = `${s.name} ${s.slug} ${s.webUrl || ''} ${s.url || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort(SORTERS[o.sort] || SORTERS.name);
}

/** One page of a list, with the page number kept in range. */
export function paginate(list, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const from = (p - 1) * size, to = Math.min(list.length, from + size);
  return { page: p, pages, from, to, items: list.slice(from, to) };
}

/** Library view state from the address (#/?q=…&status=…&sort=…&page.<collection>=N). */
export function parseLibraryState(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#\/?\??/, ''));
  const pages = {};
  for (const [k, v] of q) if (k.startsWith('page.') && Number(v) > 1) pages[k.slice(5)] = Number(v);
  const status = STATUSES.some((s) => s.key === q.get('status')) ? q.get('status') : 'all';
  const sort = SORTS.some((s) => s.key === q.get('sort')) ? q.get('sort') : 'name';
  return { q: q.get('q') || '', status, sort, pages };
}

/** The address for a library view state; defaults are left out. */
export function libraryStateHash(state) {
  const q = new URLSearchParams();
  if (state.q) q.set('q', state.q);
  if (state.status && state.status !== 'all') q.set('status', state.status);
  if (state.sort && state.sort !== 'name') q.set('sort', state.sort);
  for (const [k, v] of Object.entries(state.pages || {})) if (v > 1) q.set(`page.${k}`, String(v));
  const s = q.toString();
  return s ? `#/?${s}` : '#/';
}
