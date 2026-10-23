// A feature of a collection ("liveserve"): every commit, in every repository,
// whose message, scope, branch or file paths name it, so its work plays as
// its own movie with a report of everything that changed.
//
// Names match whole words in any case with separators ignored: "liveserve"
// matches "Live Serve", "live-serve", "live_serve" and "LiveServe" (also inside
// a camelCase name like "LiveServeClient"), but not "liveserver".

import { C, isoOfDay } from './timeline.js';
import { scopeOf, cleanTitle } from './classify.js';
import { findPullRequests } from './groups.js';
import { periodReport } from './period.js';

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;
const MERGE_PR = /^Merge pull request #\d+ from (\S+)/i;
const MERGE_BRANCH = /^Merge (?:remote-tracking )?branch '([^']+)'/i;
const isMergeSubject = (s) => /^Merge (pull request|branch|remote-tracking)/i.test(s);
const escape = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAlnum = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isUpper = (ch) => !!ch && ch !== ch.toLowerCase() && ch === ch.toUpperCase();
const isLowerOrDigit = (ch) => !!ch && (/\p{N}/u.test(ch) || (ch !== ch.toUpperCase() && ch === ch.toLowerCase()));

/**
 * Check a feature's name. Throws a plain-language Error.
 * @returns {{ name: string, id: string, label: string }}
 */
export function checkFeature(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 40 || !NAME.test(n)) throw new Error(`"${n}" can't be a feature name. Use 2 to 40 letters or digits (spaces, - and _ are fine), like liveserve.`);
  const id = n.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return { name: n, id, label: n };
}

/**
 * A test for one feature name: true when `text` names it as a whole word.
 * @param {string} name
 * @returns {(text: string) => boolean}
 */
export function featureMatcher(name) {
  const letters = [...String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')];
  if (!letters.length) return () => false;
  const re = new RegExp(letters.map(escape).join('[-_ ]?'), 'giu');
  // a word starts after a non-letter or at a camelCase hump, and ends the same way
  const startsWord = (s, i) => !isAlnum(s[i - 1]) || (isLowerOrDigit(s[i - 1]) && isUpper(s[i]));
  const endsWord = (s, j) => !isAlnum(s[j]) || (isLowerOrDigit(s[j - 1]) && isUpper(s[j]));
  return (text) => {
    const s = String(text || '');
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      if (startsWord(s, m.index) && endsWord(s, m.index + m[0].length)) return true;
      re.lastIndex = m.index + 1;
    }
    return false;
  };
}

/** The branch a merge commit's subject names, or null. */
export function branchOf(subject) {
  const s = String(subject || '');
  const pr = MERGE_PR.exec(s);
  if (pr) return pr[1].includes('/') ? pr[1].slice(pr[1].indexOf('/') + 1) : pr[1];
  const br = MERGE_BRANCH.exec(s);
  return br ? br[1].replace(/^origin\//, '') : null;
}

/**
 * How one history commit names a feature: any of 'text', 'scope', 'path', 'branch'.
 * @param {import('./types.js').HistoryCommit} c
 * @param {(text: string) => boolean} match  From featureMatcher().
 * @returns {string[]}
 */
export function featureSignals(c, match) {
  const subject = String(c.message || '').split('\n')[0].trim();
  const out = [];
  const merge = isMergeSubject(subject);
  // a merge's own subject is its branch; a conventional prefix is its scope
  const words = merge ? '' : subject.replace(/^\w+(?:\([^)]*\))?!?:\s*/, '');
  if (match(words) || match(c.body) || match(c.mergeTitle)) out.push('text');
  const sc = merge ? null : scopeOf(subject);
  if (sc && match(sc)) out.push('scope');
  if ((c.paths || []).some((p) => match(p))) out.push('path');
  const br = merge ? branchOf(subject) : null;
  if (br && match(br)) out.push('branch');
  return out;
}

const keyOf = (repo, sha) => `${repo ?? 0}:${sha}`;

/**
 * The commits of a history that belong to a feature. A merge that names it
 * (by branch or pull request title) brings its pull request's commits along,
 * marked 'via-merge'.
 * @param {import('./types.js').History} history
 * @param {string} name
 * @returns {{ history: import('./types.js').History, signals: Record<string, string[]> }}
 *   `signals` is keyed by "<repo index>:<sha>".
 */
export function cutFeature(history, name) {
  const match = featureMatcher(name);
  const signals = new Map();
  for (const c of history.commits) {
    const s = featureSignals(c, match);
    if (s.length) signals.set(keyOf(c.repo, c.sha), s);
  }
  const byKey = new Set(history.commits.map((c) => keyOf(c.repo, c.sha)));
  const bySha = new Map(history.commits.map((c) => [c.sha, c]));
  for (const [sha, members] of findPullRequests(history.commits)) {
    const m = bySha.get(sha);
    const s = m && signals.get(keyOf(m.repo, sha));
    if (!s || !(s.includes('branch') || s.includes('text'))) continue;
    for (const ms of members) {
      const k = keyOf(m.repo, ms);
      if (!byKey.has(k)) continue;
      const have = signals.get(k) || [];
      if (!have.includes('via-merge')) signals.set(k, [...have, 'via-merge']);
    }
  }
  const keep = history.commits.filter((c) => signals.has(keyOf(c.repo, c.sha)));
  const shas = new Set(keep.map((c) => c.sha));
  const out = { ...history, commits: keep, totalCommits: keep.length, truncated: false, feature: name };
  if (history.tags) out.tags = history.tags.filter((t) => shas.has(t.sha));
  return { history: out, signals: Object.fromEntries(signals) };
}

/**
 * What changed for a feature, from its episode: the period report's sections
 * over the feature's dates, plus every matching commit with how it matched.
 * @param {any} ep  An episode built from cutFeature().
 * @param {{ name: string, collection: string, signals: Record<string, string[]> }} o
 */
export function featureReport(ep, { name, collection, signals }) {
  const tl = ep.timeline;
  const cs = tl.commits;
  const from = isoOfDay(tl, cs[0][C.day]), to = isoOfDay(tl, cs[cs.length - 1][C.day]);
  const rep = periodReport(ep, { from, to, collection });
  const repos = tl.repos || [{ name: ep.summary.repo, url: ep.summary.repoUrl }];
  // the timeline keeps short shas
  const L = cs[0][C.sha].length;
  const how = new Map(Object.entries(signals).map(([k, v]) => { const at = k.indexOf(':'); return [`${k.slice(0, at)}:${k.slice(at + 1, at + 1 + L)}`, v]; }));
  const changes = [];
  cs.forEach((c) => {
    const r = tl.repos ? c[C.repo] ?? 0 : 0, url = repos[r].url;
    changes.push({
      repo: repos[r].name, title: cleanTitle(c[C.s]) || c[C.s], who: tl.people[c[C.who]].name, d: isoOfDay(tl, c[C.day]),
      kind: c[C.kind], files: c[C.files], sha: c[C.sha], url: url ? `${url}/commit/${c[C.sha]}` : null,
      signals: how.get(keyOf(tl.repos ? r : null, c[C.sha])) || [],
    });
  });
  changes.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  return { ...rep, kind: 'feature', name, label: name, changes };
}
