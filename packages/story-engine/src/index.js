// @commit-wars/story-engine
// History in, Episode out. Pure and deterministic: the same history and
// options always give the same episode (apart from `generatedAt`).

import { kindOf, scopeOf, areaOf, enemyTypeOf, cleanTitle, clip, prFromSubject, fixScore, isCleanup, ENEMY_TYPES } from './classify.js';
import { resolveIdentities } from './identity.js';
import { splitChapters, releaseWeight } from './chapters.js';
import { dayOfIso } from './timeline.js';
export { combineHistories } from './collection.js';
export { findPullRequests } from './groups.js';
export { cutHistory, quarterOf, quartersOf, periodLabel, checkPeriod, periodReport } from './period.js';
import { buildGroups } from './groups.js';

export { parseGitLog, closingIssues, GIT_LOG_COMMAND, GIT_LOG_FORMAT } from './git-log.js';
export { validateEpisode } from './validate.js';
export { kindOf, scopeOf, areaOf, enemyTypeOf, cleanTitle, fixScore, isCleanup, ENEMY_TYPES } from './classify.js';
export { resolveIdentities, isBot } from './identity.js';
export { splitChapters, chapterCount, releaseWeight } from './chapters.js';
export { C as TL, secondsPerDay, isoOfDay, dayOfIso, commitRange, weekBuckets, totalsAt, activeAt, chapterAt, fixOf, commitUrl, peopleSummary } from './timeline.js';

export const SCHEMA_VERSION = 2;
export const ENGINE_VERSION = '0.4.0';
const ROSTER_SIZE = 24;

const CREATURE = { gremlin: 'Gremlins', beetle: 'Beetles', crawler: 'Crawlers', wraith: 'Wraiths', moth: 'Moths', bomb: 'Bombs' };
const ROMAN = ['', '', ' II', ' III', ' IV', ' V', ' VI'];
const fmt = (n) => Number(n).toLocaleString('en-US');

function countBy(list, f) {
  const m = new Map();
  for (const x of list) { const k = f(x); if (k != null && k !== '') m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
function spread(arr, n) {
  if (arr.length <= n) return arr.slice();
  const out = [], st = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * st)]);
  return out;
}
const ACRONYMS = new Set(['tui', 'ui', 'ux', 'cli', 'api', 'sdk', 'mcp', 'lsp', 'acp', 'ci', 'ai', 'llm', 'db', 'css', 'dom', 'ssr', 'jsx', 'io', 'gpu', 'vm', 'k8s', 'ios', 'npm', 'ssh', 'tls', 'http', 'json', 'yaml', 'sql', 'orm', 'pwa']);
const scopeLabel = (sc) => (ACRONYMS.has(sc) ? sc.toUpperCase() : sc.split(/[-_/ ]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' '));

/**
 * Build an episode from a history.
 *
 * @param {import('./types.js').History} history
 * @param {object} [opts]
 * @param {Record<string,string[]>} [opts.aliases]  Merge authors by hand: { "Dax": ["Dax Raad", "mail@thdxr.com"] }.
 * @param {string[]} [opts.separate]     Full names not to merge just because they match.
 * @param {boolean} [opts.identities]    List each person's names and emails in timeline.people (collections).
 * @param {number} [opts.chapters]        Force a chapter count (default grows with history size, 3–9).
 * @param {string[]} [opts.titles]        Override chapter titles by position.
 * @param {number} [opts.maxFixFiles=120] Fixes touching more files than this are treated as mass edits and never fought.
 * @param {number} [opts.heroesPerChapter=4]
 * @param {string} [opts.generatedAt]
 * @param {number} [opts.minCommits=10]  Fewer commits than this is too short to play (a period's report can ask for less).
 * @returns {object} Episode (see episode.schema.json)
 */
export function buildEpisode(history, opts = {}) {
  const { aliases = {}, titles = [], maxFixFiles = 120, heroesPerChapter = 4 } = opts;
  if (!history || !Array.isArray(history.commits)) throw new TypeError('buildEpisode needs a history with a commits array.');
  const repoName = history.repo?.name || 'repo';

  // ---- normalize ----
  const tagMap = new Map();
  for (const t of history.tags || []) { if (!tagMap.has(t.sha)) tagMap.set(t.sha, []); tagMap.get(t.sha).push(t.name); }
  const raw = history.commits;
  const newestFirst = raw.length > 1 && String(raw[0].date) > String(raw[raw.length - 1].date);
  const commits = raw.map((c, idx) => {
    const message = String(c.message || '').split('\n')[0].trim();
    const pr = c.pr || null;
    const issues = (pr && pr.issues && pr.issues.length ? pr.issues : c.issues) || [];
    const labels = [...((pr && pr.labels) || []), ...issues.flatMap((i) => i.labels || [])];
    const paths = c.paths || null;
    const scope = scopeOf(message);
    const area = areaOf(paths);
    const merge = (c.parents || 1) > 1 || /^Merge (pull request|branch|remote-tracking)/i.test(message);
    const kind = merge ? 'merge' : kindOf(message, labels);
    return {
      sha: c.sha, d: String(c.date).slice(0, 10), message, author: c.author || {}, files: c.files ?? null, paths,
      prNumber: pr ? pr.number : prFromSubject(message), issues, labels, scope, area, kind, repo: c.repo ?? null,
      type: enemyTypeOf(message, area, labels, scope),
      tags: [...(c.tags || []), ...(tagMap.get(c.sha) || [])],
      order: newestFirst ? -idx : idx,
    };
  }).filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.d));
  const minCommits = opts.minCommits ?? 10;
  if (commits.length < Math.max(1, minCommits)) throw new Error(`Only ${commits.length} commits found. A replay needs at least ${Math.max(1, minCommits)}.`);
  commits.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.order - b.order));

  const ids = resolveIdentities(commits, { aliases, separate: opts.separate, repoName, preferLogin: !['git-log', 'collection'].includes(history.source) });
  for (const c of commits) { const p = ids.personOf(c); c.who = p.name; c.bot = p.bot; c.person = p; }

  const isFixCandidate = (c) => c.kind === 'fix' && !c.bot && (c.files == null || (c.files > 0 && c.files <= maxFixFiles));
  const fixRec = (c) => ({
    sha: c.sha,
    pr: c.prNumber ?? null,
    issues: c.issues.slice(0, 3).map((i) => ({ number: i.number, title: i.title == null ? null : clip(i.title, 90) })),
    t: clip(c.issues.length && c.issues[0].title ? c.issues[0].title : cleanTitle(c.message) || c.message, 64),
    s: clip(c.message, 90),
    sc: c.scope,
    d: c.d,
    files: c.files,
    area: c.area,
    type: c.type,
  });
  const scoreView = (c) => ({ message: c.message, files: c.files, issues: c.issues, prNumber: c.prNumber, scope: c.scope });
  const scoreSort = (a, b) => fixScore(scoreView(b)) - fixScore(scoreView(a)) || (a.d < b.d ? -1 : a.d > b.d ? 1 : a.sha < b.sha ? -1 : 1);

  // ---- chapters ----
  const parts = splitChapters(commits, { chapters: opts.chapters });
  const usedHeroes = new Set();
  const usedTitles = new Map();
  const chapters = parts.map((part, k) => {
    const cc = commits.slice(part.start, part.end);
    const humans = cc.filter((c) => !c.bot);
    const pool = humans.length ? humans : cc;
    const top = countBy(pool, (c) => c.who).slice(0, heroesPerChapter).map((x) => x[0]);
    const heroFor = (name) => {
      const mine = pool.filter((c) => c.who === name);
      const fx = mine.filter(isFixCandidate).sort(scoreSort);
      const duel = fx[0] || null;
      const rest = mine.filter((c) => isFixCandidate(c) && c !== duel);
      return { name, commits: mine.length, fixes: mine.filter((c) => c.kind === 'fix').length, duel: duel ? fixRec(duel) : null, mob: spread(rest, 16).map(fixRec) };
    };
    const heroes = top.map(heroFor);

    const feats = pool.filter((c) => c.kind === 'feat' && top.includes(c.who))
      .sort((a, b) => (b.files ?? 0) - (a.files ?? 0) || fixScore(scoreView(b)) - fixScore(scoreView(a)) || (a.sha < b.sha ? -1 : 1));
    const powerups = [], seen = new Set();
    for (const c of feats) { if (seen.has(c.message)) continue; seen.add(c.message); powerups.push({ sha: c.sha, who: c.who, s: clip(c.message), d: c.d, files: c.files }); if (powerups.length === 2) break; }

    const rv = pool.find((c) => c.kind === 'revert' && top.includes(c.who));
    // Tech Debt: the chapter's biggest real cleanup (a refactor, removal, migration…), at least 10 files.
    // Chapters without one get no boss.
    let bossC = pool.filter((c) => isCleanup(c.message, c.kind) && (c.files ?? 0) >= 10)
      .sort((a, b) => b.files - a.files || (a.sha < b.sha ? -1 : 1))[0];
    if (!bossC && cc.every((c) => c.files == null)) bossC = pool.filter((c) => c.kind === 'refactor').sort(scoreSort)[0];
    let boss = null;
    if (bossC) {
      boss = { sha: bossC.sha, who: bossC.who, s: clip(bossC.message), d: bossC.d, files: bossC.files ?? null };
      if (!top.includes(bossC.who)) {
        if (heroes.length >= heroesPerChapter) heroes[heroes.length - 1] = heroFor(bossC.who); else heroes.push(heroFor(bossC.who));
      }
    }
    heroes.forEach((h) => usedHeroes.add(h.name));

    const fixC = cc.filter((c) => c.kind === 'fix');
    const scopes = countBy(fixC, (c) => c.scope);
    const sc = scopes.length && scopes[0][1] >= 5 ? scopes[0][0] : null;
    const typeTop = countBy(fixC.filter((c) => !sc || c.scope === sc), (c) => c.type)[0];
    const kinds = new Map(countBy(cc, (c) => c.kind));
    const relW = part.release ? releaseWeight(part.release) : 0;
    let title;
    if (titles[k]) title = titles[k];
    else if (k === 0) title = 'Origins';
    else if (k === parts.length - 1) title = 'The Fight Goes On';
    else if (relW === 3) title = `Road to ${part.release}`;
    else if (sc) title = `The ${scopeLabel(sc)} ${CREATURE[typeTop ? typeTop[0] : 'crawler']}`;
    else if (relW === 2) title = `The ${part.release} Run`;
    else title = `Chapter ${k + 1}`;
    const tn = (usedTitles.get(title) || 0) + 1; usedTitles.set(title, tn);
    if (tn > 1) title += ROMAN[Math.min(tn, ROMAN.length - 1)] || ` ${tn}`;
    const sub = sc
      ? `${fmt(scopes[0][1])} ${scopeLabel(sc)} fixes among ${fmt(fixC.length)}`
      : `${fmt(fixC.length)} fix commits to fight`;
    const relC = part.release ? cc.find((c) => c.tags.includes(part.release)) : null;
    return {
      title, sub, first: cc[0].d, last: cc[cc.length - 1].d, commits: cc.length,
      fixes: kinds.get('fix') || 0, feats: kinds.get('feat') || 0, reverts: kinds.get('revert') || 0, refactors: kinds.get('refactor') || 0,
      enemyScope: sc, heroes, powerups,
      revert: rv ? { sha: rv.sha, who: rv.who, s: clip(rv.message, 90), d: rv.d } : null,
      boss,
      release: relC ? { tag: part.release, d: relC.d } : null,
    };
  });

  // ---- roster ----
  const humansAll = commits.filter((c) => !c.bot);
  const byWho = new Map();
  for (const c of humansAll) {
    let r = byWho.get(c.who);
    if (!r) { r = { name: c.who, login: c.person.login || null, avatarUrl: c.person.avatarUrl || null, commits: 0, fixes: 0, first: c.d, list: [], all: [] }; byWho.set(c.who, r); }
    r.commits++; r.all.push(c);
    if (c.kind === 'fix') r.fixes++;
    if (isFixCandidate(c)) r.list.push(c);
  }
  const busiest = [...byWho.values()].sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1)).slice(0, ROSTER_SIZE).map((r) => r.name);
  const roster = [...new Set([...usedHeroes, ...busiest])].map((n) => byWho.get(n)).filter(Boolean)
    .sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1))
    .map((r) => ({
      name: r.name, login: r.login, avatarUrl: r.avatarUrl, commits: r.commits, fixes: r.fixes, first: r.first,
      areas: countBy(r.all.filter((c) => c.area), (c) => c.area).slice(0, 3).map((x) => x[0]),
      gauntlet: r.list.slice().sort(scoreSort).slice(0, 8).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).map(fixRec),
    }));

  // ---- timeline: every commit, for the movie ----
  const tlBase = { start: commits[0].d };
  const peopleMap = new Map();
  for (const c of commits) {
    let p = peopleMap.get(c.who);
    if (!p) {
      p = { name: c.who, login: c.person.login || null, avatarUrl: c.person.avatarUrl || null, bot: !!c.bot, commits: 0 };
      if (opts.identities) { p.names = c.person.names; p.emails = c.person.emails; }
      peopleMap.set(c.who, p);
    }
    p.commits++;
  }
  const people = [...peopleMap.values()].sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1));
  const whoIdx = new Map(people.map((p, i) => [p.name, i]));
  const releases = [], seenTags = new Set();
  for (const c of commits) for (const tag of c.tags) {
    if (seenTags.has(tag)) continue; seenTags.add(tag);
    releases.push({ tag, day: dayOfIso(tlBase, c.d), weight: releaseWeight(tag) });
  }
  const multi = Array.isArray(history.repos) && history.repos.length > 0;
  const timeline = {
    start: tlBase.start,
    end: commits[commits.length - 1].d,
    days: dayOfIso(tlBase, commits[commits.length - 1].d) + 1,
    people,
    commits: commits.map((c) => [
      dayOfIso(tlBase, c.d), whoIdx.get(c.who), c.kind, c.files, c.kind === 'fix' ? c.type : null,
      String(c.sha).slice(0, 12), clip(c.message, 100), c.prNumber ?? null, c.issues.length ? c.issues.map((i) => i.number) : null,
      ...(multi ? [c.repo ?? 0] : []),
    ]),
    releases,
  };
  if (multi) timeline.repos = history.repos.map((r) => ({ name: r.name, url: r.url ?? null }));
  // bosses that spawn their work: big feature pull requests, Tech Debt, releases
  timeline.groups = buildGroups({ raw, commits, parts, chapters, tl: timeline, releases });

  // ---- summary ----
  const count = (f) => commits.filter(f).length;
  const firstH = humansAll[0] || commits[0];
  const lastH = humansAll[humansAll.length - 1] || commits[commits.length - 1];
  const issuesLinked = new Set(commits.filter((c) => c.kind === 'fix').flatMap((c) => c.issues.map((i) => i.number))).size;
  const repoLabel = history.repo?.owner ? `${history.repo.owner}/${repoName}` : repoName;
  const src = history.source;
  const noteParts = [
    `Built from ${fmt(commits.length)} commits${history.truncated ? ` (the newest ${fmt(commits.length)} of ${history.totalCommits ? fmt(history.totalCommits) : 'more'})` : ''}, ${commits[0].d} to ${commits[commits.length - 1].d}.`,
    'Every enemy is a real fix commit by the developer fighting it' + (issuesLinked ? `; ${fmt(issuesLinked)} of them are linked to the issue they closed.` : '.'),
    src === 'github-rest' ? 'Fetched without a GitHub token, so file counts and pull request links are missing; add a token for the full version.' : '',
    'Fix, feature, refactor and revert labels come from commit prefixes, keywords and pull request labels, so a few will be off.',
  ].filter(Boolean);
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: { name: '@commit-wars/story-engine', version: ENGINE_VERSION },
    generatedAt: opts.generatedAt || new Date().toISOString(),
    source: { kind: src, truncated: !!history.truncated, commitLimit: history.commitLimit ?? null, totalCommits: history.totalCommits ?? null },
    summary: {
      repo: repoLabel,
      repoUrl: history.repo?.url || null,
      branch: history.repo?.defaultBranch || null,
      commits: commits.length,
      humans: byWho.size,
      fixes: count((c) => c.kind === 'fix'),
      feats: count((c) => c.kind === 'feat'),
      reverts: count((c) => c.kind === 'revert'),
      refactors: count((c) => c.kind === 'refactor'),
      botCommits: count((c) => c.bot),
      tags: count((c) => c.tags.length > 0),
      issuesLinked,
      first: { who: firstH.who, s: clip(firstH.message, 60), d: firstH.d },
      latest: { who: lastH.who, s: clip(lastH.message), d: lastH.d },
      note: noteParts.join(' '),
    },
    chapters,
    roster,
    timeline,
  };
}
