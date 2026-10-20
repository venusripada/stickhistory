// "Add a GitHub organization": list an org's repositories (the server asks
// gh), tick the ones to add, and add them to a collection in one go.

import { api } from './api.js';

const fmtN = (n) => Number(n).toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pushed = (iso) => { if (!iso) return 'never pushed'; const [y, m] = iso.slice(0, 7).split('-'); return `pushed ${MON[+m - 1]} ${y}`; };
const size = (kb) => (kb == null ? '' : kb >= 1024 ? `${fmtN(Math.round(kb / 1024))} MB` : `${fmtN(kb)} KB`);

/**
 * @param {{ form: HTMLFormElement, input: HTMLInputElement, list: HTMLElement,
 *           collection: () => Promise<{ slug: string, name: string }|null>, onError: (m: string) => void, onAdded: () => void }} o
 */
export function createOrgUI({ form, input, list, collection, onError, onAdded }) {
  let repos = [], owner = '', target = null;
  const checks = new Map(); // repo name -> checkbox

  function render() {
    list.textContent = '';
    if (!repos.length) return;
    const addable = repos.filter((r) => !r.inCollection);
    const head = document.createElement('div'); head.className = 'org-head';
    const count = document.createElement('span'); count.className = 'st-status';
    const all = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Select all' });
    const none = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'None' });
    const add = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small primary', id: 'bAddOrg' });
    const update = () => {
      const n = [...checks.values()].filter((c) => c.checked).length;
      add.textContent = `Add ${fmtN(n)} ${n === 1 ? 'repo' : 'repos'} to ${target.name}`;
      add.disabled = !n;
      count.textContent = `${fmtN(repos.length)} repos in ${owner}${repos.length - addable.length ? ` · ${fmtN(repos.length - addable.length)} already in ${target.name}` : ''}`;
    };
    all.addEventListener('click', () => { for (const c of checks.values()) if (!c.disabled) c.checked = true; update(); });
    none.addEventListener('click', () => { for (const c of checks.values()) c.checked = false; update(); });
    add.addEventListener('click', async () => {
      const pick = repos.filter((r) => checks.get(r.name) && checks.get(r.name).checked).map((r) => ({ url: r.url, name: r.name, webUrl: r.webUrl }));
      add.disabled = true;
      try {
        const r = await api.addStories(target.slug, pick);
        repos = []; render(); input.value = '';
        onError('');
        onAdded(r);
      } catch (e) { onError(e.message); add.disabled = false; }
    });
    head.append(count, all, none, add);
    const ul = document.createElement('ul'); ul.className = 'org-list';
    checks.clear();
    for (const r of repos) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !r.inCollection && !r.archived && !r.fork, disabled: r.inCollection });
      cb.addEventListener('change', update);
      checks.set(r.name, cb);
      const name = document.createElement('strong'); name.textContent = r.name;
      const meta = document.createElement('span'); meta.className = 'st-status';
      meta.textContent = [pushed(r.pushedAt), size(r.sizeKb), r.private && 'private', r.fork && 'fork', r.archived && 'archived', r.inCollection && `already in ${target.name}`].filter(Boolean).join(' · ');
      label.append(cb, ' ', name, ' ', meta);
      li.append(label);
      if (r.description) { const d = document.createElement('p'); d.className = 'org-desc'; d.textContent = r.description; li.append(d); }
      ul.append(li);
    }
    list.append(head, ul);
    update();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    onError('');
    owner = input.value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/.*$/, '');
    if (!owner) { onError('Type a GitHub organization or user name.'); input.focus(); return; }
    try {
      target = await collection();
      if (!target) return;
      list.textContent = 'Listing repositories…';
      repos = (await api.orgRepos(owner, target.slug)).repos;
      if (!repos.length) { list.textContent = `${owner} has no repositories you can see.`; return; }
      render();
    } catch (err) { list.textContent = ''; onError(err.message); }
  });
}
