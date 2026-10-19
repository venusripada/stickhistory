// The library view: collections, their story cards, and the forms that
// manage them. All changes go through the server; this module only draws
// what the server says and shows job progress as it streams in.

import { api } from './api.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (d) => { if (!d) return ''; const [y, m] = d.split('-'); return `${MON[+m - 1]} ${y}`; };
const fmtN = (n) => Number(n).toLocaleString('en-US');
export const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
};
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};
const STATUS = { queued: 'Waiting to build', cloning: 'Cloning', building: 'Building', fetching: 'Fetching' };

/**
 * @param {{ root: HTMLElement, select: HTMLSelectElement, onError: (msg: string) => void, onServer?: (up: boolean) => void }} o
 */
export function createLibraryUI({ root, select, onError, onServer }) {
  let collections = [];
  const jobs = new Map(); // storyId -> latest job
  const open = new Map(); // panel open per card/collection key: 'rename' | 'delete'
  const fail = (e) => onError(e && e.message ? e.message : String(e));
  const act = async (fn) => { try { onError(''); await fn(); await refresh(); } catch (e) { fail(e); } };

  function storyStatus(st) {
    const job = jobs.get(st.id);
    if (job && (job.state === 'queued' || job.state === 'running')) {
      const bar = el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.round((job.frac || 0) * 100)}%` }));
      return el('p', { class: 'st-status busy', role: 'status' }, el('span', { text: job.state === 'queued' ? 'Waiting for the job ahead' : job.message || STATUS[job.phase] || 'Working…' }), bar);
    }
    if (!st.setUp) return el('p', { class: 'st-status err', text: st.error });
    if (st.status === 'error') return el('p', { class: 'st-status err', role: 'alert', text: st.error || 'The last build failed.' });
    if (STATUS[st.status]) return el('p', { class: 'st-status busy', text: `${STATUS[st.status]}…` });
    const note = job && job.state === 'done' && job.changed === false ? 'Already up to date · ' : '';
    return el('p', { class: 'st-status', text: `${note}Updated ${ago(st.fetchedAt)}` });
  }

  function storyCard(col, st) {
    const key = `s:${col.slug}/${st.slug}`;
    const href = `#/s/${encodeURIComponent(col.slug)}/${encodeURIComponent(st.slug)}`;
    const playable = st.hasEpisode;
    const card = el('article', { class: 'story-card', 'data-story': st.id || st.slug });
    card.append(
      el('h4', {}, playable ? el('a', { href, text: st.name }) : el('span', { text: st.name })),
      el('p', { class: 'st-src', text: st.webUrl || st.url || 'added by hand' }),
      st.commits ? el('p', { class: 'st-stats', text: `${fmtN(st.commits)} commits · ${fmtMonth(st.first)} – ${fmtMonth(st.last)}${st.issuesLinked ? ` · ${fmtN(st.issuesLinked)} issues` : ''}` }) : null,
      storyStatus(st),
    );
    const panel = open.get(key);
    if (panel === 'rename') {
      const input = el('input', { type: 'text', value: st.name, 'aria-label': `New name for ${st.name}` });
      const save = () => act(() => api.editStory(col.slug, st.slug, { name: input.value }).then(() => open.delete(key)));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { open.delete(key); render(); } });
      card.append(el('div', { class: 'inline' }, input, el('button', { class: 'btn small', type: 'button', text: 'Save', onclick: save }), el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: () => { open.delete(key); render(); } })));
      setTimeout(() => input.focus(), 0);
    } else if (panel === 'delete') {
      card.append(el('div', { class: 'confirm', role: 'group', 'aria-label': 'Confirm delete' },
        el('p', { text: `Delete "${st.name}"? Its clone and built story are removed from the library folder.` }),
        el('button', { class: 'btn small danger', type: 'button', text: 'Delete', onclick: () => act(() => api.deleteStory(col.slug, st.slug).then(() => open.delete(key))) }),
        el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: () => { open.delete(key); render(); } })));
    } else {
      const others = collections.filter((c) => c.slug !== col.slug);
      const move = others.length ? el('select', { class: 'move', 'aria-label': `Move ${st.name} to another collection`, onchange: (e) => { const to = e.target.value; if (to) act(() => api.editStory(col.slug, st.slug, { collection: to })); } },
        el('option', { value: '', text: 'Move to…' }), others.map((c) => el('option', { value: c.slug, text: c.name }))) : null;
      card.append(el('div', { class: 'actions' },
        playable ? el('a', { class: 'btn small primary', href, text: 'Play' }) : null,
        st.setUp ? el('button', { class: 'btn small', type: 'button', text: 'Update', onclick: () => act(() => api.updateStory(col.slug, st.slug)) }) : null,
        st.setUp ? el('button', { class: 'btn small', type: 'button', text: 'Rename', onclick: () => { open.set(key, 'rename'); render(); } }) : null,
        st.setUp ? move : null,
        st.setUp ? el('button', { class: 'btn small', type: 'button', text: 'Delete', onclick: () => { open.set(key, 'delete'); render(); } }) : null));
    }
    return card;
  }

  function collectionSection(col) {
    const key = `c:${col.slug}`;
    const head = el('div', { class: 'col-head' });
    const panel = open.get(key);
    if (panel === 'rename') {
      const input = el('input', { type: 'text', value: col.name, 'aria-label': `New name for ${col.name}` });
      const save = () => act(() => api.updateCollection(col.slug, { name: input.value }).then(() => open.delete(key)));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { open.delete(key); render(); } });
      head.append(el('div', { class: 'inline' }, input, el('button', { class: 'btn small', type: 'button', text: 'Save', onclick: save }), el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: () => { open.delete(key); render(); } })));
      setTimeout(() => input.focus(), 0);
    } else {
      head.append(el('h3', { text: col.name }), el('span', { class: 'eyebrow', text: `${col.stories.length} ${col.stories.length === 1 ? 'story' : 'stories'}` }));
      head.append(el('div', { class: 'actions' },
        col.stories.length ? el('button', { class: 'btn small', type: 'button', text: 'Update all', onclick: () => act(() => api.updateCollectionStories(col.slug)) }) : null,
        el('button', { class: 'btn small', type: 'button', text: 'Rename', onclick: () => { open.set(key, 'rename'); render(); } }),
        el('button', { class: 'btn small', type: 'button', text: 'Delete', onclick: () => { open.set(key, 'delete'); render(); } })));
    }
    const sec = el('section', { class: 'collection', 'data-collection': col.slug, 'aria-label': col.name }, head);
    if (col.description) sec.append(el('p', { class: 'col-desc', text: col.description }));
    if (panel === 'delete') {
      sec.append(el('div', { class: 'confirm', role: 'group', 'aria-label': 'Confirm delete' },
        el('p', { text: col.stories.length ? `Delete "${col.name}" and its ${col.stories.length} ${col.stories.length === 1 ? 'story' : 'stories'}? Their clones and built stories are removed from the library folder.` : `Delete the empty collection "${col.name}"?` }),
        el('button', { class: 'btn small danger', type: 'button', text: 'Delete', onclick: () => act(() => api.deleteCollection(col.slug, col.slug).then(() => open.delete(key))) }),
        el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: () => { open.delete(key); render(); } })));
    }
    sec.append(col.stories.length ? el('div', { class: 'stories' }, col.stories.map((st) => storyCard(col, st))) : el('p', { class: 'col-empty', text: 'No stories yet. Paste a repository link above and pick this collection.' }));
    return sec;
  }

  function render() {
    root.textContent = '';
    if (!collections.length) root.append(el('p', { class: 'col-empty', text: 'Your library is empty. Create a collection, then paste a repository link to add its first story.' }));
    for (const col of collections) root.append(collectionSection(col));
    const keep = select.value;
    select.textContent = '';
    for (const c of collections) select.append(el('option', { value: c.slug, text: c.name }));
    select.append(el('option', { value: '__new', text: 'New collection…' }));
    if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  }

  let pending = null;
  async function refresh() {
    try { collections = (await api.library()).collections; render(); onServer && onServer(true); }
    catch (e) { if (e.status === 0) { onServer && onServer(false); render(); } else fail(e); }
  }

  return {
    refresh,
    /** Coalesce bursts of "library changed" events. */
    refreshSoon() { clearTimeout(pending); pending = setTimeout(refresh, 120); },
    onJob(job) {
      jobs.set(job.storyId, job);
      const card = root.querySelector(`[data-story="${CSS.escape(job.storyId)}"]`);
      const col = card && collections.find((c) => c.slug === card.closest('[data-collection]').dataset.collection);
      const st = col && col.stories.find((s) => s.id === job.storyId);
      if (card && st) card.querySelector('.st-status').replaceWith(storyStatus(st));
      if (job.state === 'done' || job.state === 'error') this.refreshSoon();
    },
    get collections() { return collections; },
    find(c, s) { const col = collections.find((x) => x.slug === c); return col ? { col, story: col.stories.find((x) => x.slug === s) || null } : null; },
  };
}
