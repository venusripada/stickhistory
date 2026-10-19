// Turns commit messages, pull request labels and file paths into fight roles.

export const ENEMY_TYPES = ['gremlin', 'beetle', 'crawler', 'wraith', 'moth', 'bomb'];

const CC_RE = /^(\w+)(?:\(([^)]*)\))?!?:\s*/;

/** Conventional-commit prefix ("fix", "feat"…) or "". */
export function prefixOf(subject) {
  const m = subject.match(CC_RE);
  return m ? m[1].toLowerCase() : '';
}

/** Conventional-commit scope ("tui" in "fix(tui): …") or null. */
export function scopeOf(subject) {
  const m = subject.match(CC_RE);
  return m && m[2] ? m[2].toLowerCase().trim() || null : null;
}

const lower = (labels) => (labels || []).map((l) => String(l).toLowerCase());
const anyLabel = (labels, re) => labels.some((l) => re.test(l));

/**
 * What kind of commit this is.
 * @param {string} subject
 * @param {string[]} [labels]  Labels from the pull request and its linked issues.
 * @returns {'revert'|'fix'|'feat'|'refactor'|'other'}
 */
export function kindOf(subject, labels = []) {
  const s = subject.toLowerCase();
  const L = lower(labels);
  if (/^revert\b/i.test(subject)) return 'revert';
  const p = prefixOf(subject);
  if (['fix', 'hotfix', 'bugfix'].includes(p)) return 'fix';
  if (['feat', 'feature'].includes(p)) return 'feat';
  if (p === 'refactor') return 'refactor';
  if (anyLabel(L, /^(bug|type:\s*bug|kind\/bug|regression|crash)$/)) return 'fix';
  if (/\b(fix|fixes|fixed|bug|bugs|crash|broken|hotfix)\b/.test(s)) return 'fix';
  if (anyLabel(L, /^(enhancement|feature|type:\s*feature|kind\/feature)$/)) return 'feat';
  if (/^(add|support|implement|introduce)\b/.test(s)) return 'feat';
  if (/^refactor\b/.test(s)) return 'refactor';
  return 'other';
}

const MONO_ROOTS = new Set(['packages', 'apps', 'crates', 'libs', 'services', 'modules', 'plugins', 'src', 'internal', 'cmd', 'pkg']);

/** The part of the codebase a set of paths mostly lives in ("packages/tui", "src/server", "docs"). */
export function areaOf(paths) {
  if (!paths || !paths.length) return '';
  const counts = new Map();
  for (const p of paths) {
    const parts = p.split('/');
    const key = MONO_ROOTS.has(parts[0]) && parts.length > 2 ? parts.slice(0, 2).join('/') : parts.length > 1 ? parts[0] : '(root)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = '', n = 0;
  for (const [k, v] of counts) if (v > n || (v === n && k < best)) { best = k; n = v; }
  return best;
}

/**
 * Which enemy a fix becomes. Labels win over message keywords, which win over paths.
 * @returns {'gremlin'|'beetle'|'crawler'|'wraith'|'moth'|'bomb'}
 */
export function enemyTypeOf(subject, area = '', labels = [], scope = null) {
  const L = lower(labels);
  if (anyLabel(L, /crash|panic|hang|freeze|deadlock/)) return 'bomb';
  if (anyLabel(L, /windows|win32|wsl/)) return 'wraith';
  if (anyLabel(L, /perf|performance|memory|leak|speed/)) return 'beetle';
  if (anyLabel(L, /^(ui|ux|design|css|frontend|web|desktop|app)$|\bui\b/)) return 'moth';
  if (anyLabel(L, /\btui\b|terminal/)) return 'gremlin';
  const t = subject.toLowerCase();
  if (/\bcrash|\bpanic|\bhang(s|ing)?\b|\bfreez|\bstuck\b|\bdeadlock|\binfinite\b|\bloop\b|\bsegfault/.test(t)) return 'bomb';
  if (/windows|win32|\bwsl\b|\bpaths?\b/.test(t)) return 'wraith';
  if (/\bperf\b|performance|\bslow|memory|\bleak|\blag\b|\bcache\b|timeout/.test(t)) return 'beetle';
  if (/scroll|layout|align|flicker|theme|icon|dialog|button|colou?r|style|spacing|font|render|css|tooltip|modal|sidebar/.test(t)) return 'moth';
  const sc = scope || '';
  const ar = (area || '').toLowerCase();
  if (/(^|\/)(app|ui|desktop|web|frontend|client|console|site|www)\b/.test(ar) || /^(app|ui|desktop|web|frontend)$/.test(sc)) return 'moth';
  if (/tui|terminal|cli/.test(ar) || /^(tui|terminal)$/.test(sc) || /\btui\b/.test(t)) return 'gremlin';
  return 'crawler';
}

/** Strip a subject down to the human part ("fix(tui): Fix cursor jump (#12)" -> "cursor jump"). */
export function cleanTitle(subject) {
  return subject
    .replace(/\s*\(#\d+\)\s*$/, '')
    .replace(/(?<=\S)[\s.,;:]+(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:[\w.-]+\/[\w.-]+)?#\d+\b.*$/i, '')
    .replace(CC_RE, '')
    .replace(/^(fix|fixed|fixes)\s+/i, '')
    .trim();
}

export function clip(s, n = 78) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/** PR number from a squash-merge subject ("… (#1234)") or a merge commit ("Merge pull request #1234 …"). */
export function prFromSubject(subject) {
  const m = subject.match(/\(#(\d+)\)\s*$/) || subject.match(/^Merge pull request #(\d+)/i);
  return m ? Number(m[1]) : null;
}

/**
 * How good a fix is as a duel opponent. Prefers substantial fixes with a
 * linked issue or PR and a descriptive title; pushes chores (deps, docs,
 * lint, translations) down.
 */
export function fixScore(c) {
  const t = c.message.toLowerCase();
  let sc = Math.min(c.files ?? 3, 40);
  if (c.issues && c.issues.length) sc += 15;
  if (c.prNumber) sc += 8;
  if (c.scope) sc += 4;
  if (/crash|hang|broken|error|leak|missing|flicker|stuck|freez|race|wrong|fail|lost|blank|duplicate|overflow|infinite|regression|not /.test(t)) sc += 8;
  if (cleanTitle(c.message).length < 14) sc -= 20;
  if (/\b(deps?|dependenc\w*|bump|lockfile|lock|translations?|locale|i18n|docs?|typo|lint|format|generated?|ci)\b/.test(t)) sc -= 25;
  return sc;
}

const CLEANUP_RE = /\b(refactor(s|ed|ing)?|remov(e|es|ed|ing)|delet(e|es|ed|ing)|drop(s|ped|ping)?|migrat(e|es|ed|ing|ion)|consolidat(e|es|ed|ing|ion)|renam(e|es|ed|ing)|restructur(e|es|ed|ing)|reorgani[sz](e|es|ed|ing)|clean(ed|s|ing)?[ -]?up|cleanup|deprecat(e|ed|ion)|dead code|unused|simplif(y|ies|ied)|extract(s|ed|ing)?|split(s|ting)?|mov(e|es|ed|ing) .+ (to|into)|upgrad(e|es|ed|ing))\b/i;
const NOT_CLEANUP_RE = /^(docs?|i18n|wip|chore\(deps?\)|build\(deps?\)|release)\b|\b(deps?|dependenc(y|ies)|bump(s|ed)?|lockfile|translations?|i18n|wip)\b/i;

/**
 * Whether a commit pays off tech debt: a refactor, removal, migration,
 * consolidation, rename, restructure or similar cleanup. Features, fixes,
 * merges, docs, translations, work in progress and dependency bumps never do.
 */
export function isCleanup(subject, kind) {
  if (kind === 'fix' || kind === 'feat' || kind === 'merge' || kind === 'revert') return false;
  const s = String(subject || '');
  if (NOT_CLEANUP_RE.test(s)) return false;
  return kind === 'refactor' || CLEANUP_RE.test(s);
}
