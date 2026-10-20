// Works out who is who: merges author aliases into one person, spots bots,
// and picks a short display name.

const BOT_NAME_RE = /\[bot\]$|^github[- ]?actions?$|^dependabot|^renovate|^semantic-release|^greenkeeper|^snyk-bot|^mergify|^copilot$|-bot$|^bot$/i;
const BOT_EMAIL_RE = /^(action@github\.com|noreply@github\.com|.*\[bot\]@users\.noreply\.github\.com)$/i;
const NOREPLY_RE = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i;

/** GitHub login hidden in a noreply email ("123+octocat@users.noreply.github.com" -> "octocat"). */
export function loginFromEmail(email) {
  const m = (email || '').match(NOREPLY_RE);
  return m ? m[1].toLowerCase() : null;
}

export function isBot(author, repoName) {
  const name = author.name || '', email = author.email || '', login = author.login || '';
  if (author.bot === true || BOT_NAME_RE.test(name) || BOT_NAME_RE.test(login) || BOT_EMAIL_RE.test(email)) return true;
  // Release automation often commits as the project itself ("opencode <opencode@…>").
  if (repoName && name.toLowerCase() === repoName.toLowerCase()) return true;
  return false;
}

class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r); this.p.set(x, r); return r; }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(rb < ra ? ra : rb, rb < ra ? rb : ra); }
}

/**
 * Resolve every commit author to a person.
 *
 * With GitHub logins available the login is the identity. Without them
 * (local git logs) authors that share an email, a name or a noreply login
 * are merged. `aliases` lets a caller merge the rest by hand:
 * `{ "Dax": ["Dax Raad", "mail@thdxr.com", "thdxr"] }`.
 *
 * @param {{author:{name:string|null,email:string|null,login:string|null,avatarUrl?:string|null}}[]} commits
 * `separate` lists full names that must not be merged just because they match
 * (people who share a name); they still merge by email or login.
 *
 * @param {{ aliases?: Record<string,string[]>, separate?: string[], repoName?: string, preferLogin?: boolean }} [opts]
 * @returns {{ personOf: (commit:any)=>{ key:string, name:string, login:string|null, avatarUrl:string|null, bot:boolean, names:string[], emails:string[] } }}
 */
export function resolveIdentities(commits, opts = {}) {
  const { aliases = {}, repoName = '', preferLogin = true } = opts;
  const separate = new Set((opts.separate || []).map((n) => String(n).toLowerCase().trim()));
  const uf = new UnionFind();
  const aliasOf = new Map();
  for (const [canon, list] of Object.entries(aliases)) {
    for (const a of [canon, ...list]) aliasOf.set(String(a).toLowerCase(), canon);
  }
  const keysOf = (a) => {
    const ks = [];
    const login = (a.login || loginFromEmail(a.email) || '').toLowerCase();
    if (login) ks.push('l:' + login);
    if (a.email && !BOT_EMAIL_RE.test(a.email)) ks.push('e:' + a.email.toLowerCase());
    if (a.name && !separate.has(a.name.toLowerCase().trim())) ks.push('n:' + a.name.toLowerCase().trim());
    if (!ks.length && a.name) ks.push('s:' + a.name.toLowerCase().trim() + '|' + String(a.email || '').toLowerCase());
    for (const v of [a.name, a.email, a.login, login]) {
      const c = v && aliasOf.get(String(v).toLowerCase());
      if (c) ks.push('a:' + c.toLowerCase());
    }
    return ks.length ? ks : ['n:unknown'];
  };
  for (const c of commits) {
    const ks = keysOf(c.author);
    for (let i = 1; i < ks.length; i++) uf.union(ks[0], ks[i]);
  }
  // Gather facts per cluster.
  const info = new Map();
  for (const c of commits) {
    const a = c.author;
    const root = uf.find(keysOf(a)[0]);
    let r = info.get(root);
    if (!r) { r = { names: new Map(), logins: new Map(), emails: new Set(), avatar: null, alias: null, bot: 0, total: 0 }; info.set(root, r); }
    if (a.email) r.emails.add(a.email);
    r.total++;
    if (a.name) r.names.set(a.name, (r.names.get(a.name) || 0) + 1);
    const login = a.login || loginFromEmail(a.email);
    if (login) r.logins.set(login, (r.logins.get(login) || 0) + 1);
    if (a.avatarUrl && !r.avatar) r.avatar = a.avatarUrl;
    for (const v of [a.name, a.email, a.login]) { const ca = v && aliasOf.get(String(v).toLowerCase()); if (ca) r.alias = ca; }
    if (isBot(a, repoName)) r.bot++;
  }
  const top = (m) => { let best = null, n = -1; for (const [k, v] of m) if (v > n || (v === n && k < best)) { best = k; n = v; } return best; };
  const people = new Map();
  for (const [root, r] of info) {
    const login = top(r.logins);
    const fullName = top(r.names) || login || 'unknown';
    people.set(root, { key: root, fullName, login, avatarUrl: r.avatar, alias: r.alias, bot: r.bot > r.total / 2, name: '', names: [...r.names.keys()].sort(), emails: [...r.emails].sort() });
  }
  // Display names: an alias wins; then the GitHub login when we have real logins
  // (API mode); otherwise the first name, unless two humans share it.
  const firstCount = new Map();
  for (const p of people.values()) if (!p.bot && !p.alias) { const f = p.fullName.split(/\s+/)[0]; firstCount.set(f, (firstCount.get(f) || 0) + 1); }
  const used = new Map();
  for (const p of people.values()) {
    let name;
    if (p.alias) name = p.alias;
    else if (preferLogin && p.login && commits.some((c) => c.author.login)) name = p.login;
    else { const f = p.fullName.split(/\s+/)[0]; name = firstCount.get(f) === 1 ? f : p.fullName; }
    if (p.bot) name = p.login || p.fullName;
    // Keep names unique so colors and lookups never collide.
    const n = used.get(name) || 0; used.set(name, n + 1);
    p.name = n ? `${name} (${n + 1})` : name;
  }
  const cache = new WeakMap();
  return {
    personOf(commit) {
      let p = cache.get(commit);
      if (!p) { p = people.get(uf.find(keysOf(commit.author)[0])); cache.set(commit, p); }
      return p;
    },
    people: [...people.values()],
  };
}
