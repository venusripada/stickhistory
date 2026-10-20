// A period's report: totals, developers, stories, features, releases and
// fixes. Display only; every number comes from the server's report.json
// (periodReport in the story engine). Sorting a table only reorders rows.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}, ${y}`; };
const fmtN = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${fmtN(n)} ${n === 1 ? one : many}`;
const FIXES_SHOWN = 200;

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};
const linkOr = (url, text) => (url ? el('a', { href: url, target: '_blank', rel: 'noopener', text }) : el('span', { text }));

/** A table whose headers sort it. cols: [{ label, get, num?, cell? }] */
function sortable(caption, cols, rows, initial = 1) {
  let by = initial, desc = true;
  const table = el('table', { class: 'rep-table' }, el('caption', { class: 'sr', text: caption }));
  const thead = el('thead'), tbody = el('tbody');
  table.append(thead, tbody);
  const draw = () => {
    thead.textContent = ''; tbody.textContent = '';
    thead.append(el('tr', {}, cols.map((c, i) => el('th', { scope: 'col', class: c.num ? 'num' : null, 'aria-sort': i === by ? (desc ? 'descending' : 'ascending') : null },
      el('button', { type: 'button', text: c.label, onclick: () => { desc = by === i ? !desc : !!c.num; by = i; draw(); } })))));
    const get = cols[by].get;
    const sorted = rows.slice().sort((a, b) => { const x = get(a), y = get(b); const r = x < y ? -1 : x > y ? 1 : 0; return desc ? -r : r; });
    for (const r of sorted) tbody.append(el('tr', {}, cols.map((c, i) => el(i ? 'td' : 'th', { class: c.num ? 'num' : null, scope: i ? null : 'row' }, c.cell ? c.cell(r) : String(c.get(r) ?? '')))));
  };
  draw();
  return el('div', { class: 'rep-scroll' }, table);
}

/**
 * @param {HTMLElement} root
 * @param {any} rep  report.json
 * @param {{ movieHref?: string|null, devHref?: (name: string) => string|null, downloadHref?: string|null, homeHref?: string|null, note?: string }} o
 */
export function renderReport(root, rep, o = {}) {
  root.textContent = '';
  const add = (...kids) => root.append(...kids.filter((k) => k != null && k !== false));
  const t = rep.totals;
  const dates = rep.label.startsWith('Q') ? `${fmtDate(rep.from)} – ${fmtDate(rep.to)}` : '';
  add(
    el('nav', { class: 'crumbs', 'aria-label': 'Where you are' },
      o.homeHref ? [el('a', { href: o.homeHref, text: 'Library' }), el('span', { 'aria-hidden': 'true', text: '/' })] : null,
      el('span', { text: rep.collection }), el('span', { 'aria-hidden': 'true', text: '/' }), el('strong', { text: `${rep.label} report` })),
    el('div', { class: 'panel-head' },
      el('h2', { id: 'repH', text: `${rep.collection} · ${rep.label}` }),
      dates ? el('span', { class: 'eyebrow', text: dates } ) : null),
    el('div', { class: 'actions rep-actions' },
      o.movieHref ? el('a', { class: 'btn small primary', href: o.movieHref, text: 'Play the movie' }) : el('span', { class: 'st-status', text: 'Too few commits in this period for a movie.' }),
      o.downloadHref ? el('a', { class: 'btn small', href: o.downloadHref, download: '', text: 'Download for sharing' }) : null),
    o.note ? el('p', { class: 'st-status', text: o.note }) : null,
    el('dl', { class: 'rep-totals' }, [
      ['Commits', t.commits], ['Developers', t.developers], ['Stories', t.stories], ['Fixes', t.fixes],
      ['Features', t.feats], ['Feature pull requests', t.featurePullRequests], ['Releases', t.releases], ['Issues closed', t.issuesClosed],
    ].map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: fmtN(v) })))),
  );

  const section = (id, title, sub, ...body) => el('section', { class: 'rep-sec', 'aria-labelledby': id }, el('div', { class: 'panel-head' }, el('h3', { id, text: title }), sub ? el('span', { class: 'eyebrow', text: sub }) : null), ...body);

  root.append(section('repDevs', 'Developers', `${plural(rep.developers.length, 'developer')} · tap a column to sort`,
    rep.developers.length ? sortable('Developers in this period', [
      { label: 'Developer', get: (d) => d.name.toLowerCase(), cell: (d) => { const h = o.devHref && o.devHref(d.name); return h ? el('a', { href: h, title: `Watch ${d.name} in this period`, text: d.name }) : d.name; } },
      { label: 'Commits', get: (d) => d.commits, num: true, cell: (d) => fmtN(d.commits) },
      { label: 'Fixes', get: (d) => d.fixes, num: true, cell: (d) => fmtN(d.fixes) },
      { label: 'Features', get: (d) => d.feats, num: true, cell: (d) => fmtN(d.feats) },
      { label: 'Stories', get: (d) => d.repos.length, num: true, cell: (d) => el('span', { title: d.repos.map((r) => `${r.name}: ${fmtN(r.commits)}`).join('\n'), text: fmtN(d.repos.length) }) },
      { label: 'Where', get: (d) => (d.repos[0] ? d.repos[0].name.toLowerCase() : ''), cell: (d) => d.repos.map((r) => `${r.name} ${fmtN(r.commits)}`).join(' · ') },
      { label: 'First', get: (d) => d.first, cell: (d) => fmtDate(d.first) },
      { label: 'Last', get: (d) => d.last, cell: (d) => fmtDate(d.last) },
    ], rep.developers) : el('p', { class: 'col-empty', text: 'Only bots committed in this period.' })));

  root.append(section('repStories', 'Stories', plural(rep.stories.length, 'story', 'stories') + ' with commits',
    sortable('Stories in this period', [
      { label: 'Story', get: (s) => s.name.toLowerCase(), cell: (s) => linkOr(s.url, s.name) },
      { label: 'Commits', get: (s) => s.commits, num: true, cell: (s) => fmtN(s.commits) },
      { label: 'Fixes', get: (s) => s.fixes, num: true, cell: (s) => fmtN(s.fixes) },
      { label: 'Features', get: (s) => s.feats, num: true, cell: (s) => fmtN(s.feats) },
      { label: 'Developers', get: (s) => s.developers, num: true, cell: (s) => fmtN(s.developers) },
      { label: 'Releases', get: (s) => s.releases.length, num: true, cell: (s) => s.releases.join(', ') },
    ], rep.stories)));

  const item = (x, extra) => el('li', { class: x.big ? 'big' : null },
    x.big ? el('span', { class: 'tag', text: 'Pull request' }) : null,
    linkOr(x.url, x.title),
    el('span', { class: 'meta', text: [x.who, x.repo, fmtDate(x.d), x.big ? plural(x.commits, 'commit') : null, x.pr ? `#${x.pr}` : null, extra].filter(Boolean).join(' · ') }));
  root.append(section('repFeats', 'Features', t.featurePullRequests ? `${plural(t.featurePullRequests, 'feature pull request')} first, then ${plural(rep.features.length - t.featurePullRequests, 'feature commit')}` : plural(rep.features.length, 'feature commit'),
    rep.features.length ? el('ol', { class: 'rep-list' }, rep.features.map((f) => item(f))) : el('p', { class: 'col-empty', text: 'No features in this period.' })));

  root.append(section('repRel', 'Releases', plural(rep.releases.length, 'release'),
    rep.releases.length ? el('ol', { class: 'rep-list' }, rep.releases.map((r) => el('li', {}, el('strong', { text: r.tag }), el('span', { class: 'meta', text: [r.repo, fmtDate(r.d)].filter(Boolean).join(' · ') })))) : el('p', { class: 'col-empty', text: 'No releases were tagged in this period.' })));

  const fixList = el('ol', { class: 'rep-list' });
  const showFixes = (n) => { fixList.textContent = ''; for (const f of rep.fixes.slice(0, n)) fixList.append(item(f, f.issues.length ? `closes ${f.issues.map((i) => `#${i}`).join(', ')}` : null)); };
  showFixes(FIXES_SHOWN);
  const more = rep.fixes.length > FIXES_SHOWN ? el('button', { class: 'btn small', type: 'button', text: `Show all ${fmtN(rep.fixes.length)} fixes`, onclick: (e) => { showFixes(rep.fixes.length); e.target.remove(); } }) : null;
  root.append(section('repFixes', 'Fixes', `${plural(rep.fixes.length, 'fix', 'fixes')}, newest first`,
    rep.fixes.length ? el('details', { class: 'rep-more' }, el('summary', { text: `Show the ${plural(rep.fixes.length, 'fix', 'fixes')}` }), fixList, more) : el('p', { class: 'col-empty', text: 'No fixes in this period.' })));
}
