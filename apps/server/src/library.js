// The library on disk. The folders are the database:
//
//   <root>/<collection>/collection.json
//   <root>/<collection>/<story>/story.json, repo.git/, history.json, episode.json
//
// Every read walks the tree, so folders copied, renamed or removed by hand
// show up on the next request. JSON writes go to a temp file and are renamed
// into place, so a crash never leaves half a file.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class LibraryError extends Error {
  constructor(status, message) { super(message); this.name = 'LibraryError'; this.status = status; }
}

/** "My Cool Repo!" -> "my-cool-repo" */
export function slugify(name, fallback = 'item') {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || fallback;
}

/** A folder name from a URL path segment: one level, nothing hidden, no traversal. */
const safeSegment = (seg) => typeof seg === 'string' && seg.length > 0 && seg.length <= 200 && !seg.startsWith('.') && !/[\\/\0]/.test(seg);

function readJson(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const subdirs = (p) => (isDir(p) ? readdirSync(p).filter((n) => !n.startsWith('.') && isDir(join(p, n))).sort() : []);
const checkName = (name, what) => {
  const n = String(name ?? '').trim();
  if (!n) throw new LibraryError(400, `Give the ${what} a name.`);
  if (n.length > 80) throw new LibraryError(400, `Keep the ${what} name under 80 characters.`);
  return n;
};

/** Story fields the API returns (story.json minus nothing secret; it holds no secrets). */
const STORY_FIELDS = ['id', 'name', 'url', 'webUrl', 'branch', 'aliases', 'titles', 'createdAt', 'fetchedAt', 'builtAt', 'head', 'commits', 'first', 'last', 'issuesLinked', 'status', 'error'];

export function createLibrary(root) {
  mkdirSync(root, { recursive: true });
  const cDir = (c) => { if (!safeSegment(c)) throw new LibraryError(404, 'That collection doesn\'t exist.'); return join(root, c); };
  const sDir = (c, s) => { if (!safeSegment(s)) throw new LibraryError(404, 'That story doesn\'t exist.'); return join(cDir(c), s); };
  const needCollection = (c) => { const d = cDir(c); if (!isDir(d)) throw new LibraryError(404, `There's no collection "${c}". It may have been renamed or deleted; reload the library.`); return d; };
  const needStory = (c, s) => { needCollection(c); const d = sDir(c, s); if (!isDir(d)) throw new LibraryError(404, `There's no story "${s}" in "${c}". It may have been moved or deleted; reload the library.`); return d; };
  const uniqueSlug = (parent, base) => { let s = base, k = 2; while (existsSync(join(parent, s))) s = `${base}-${k++}`; return s; };

  function storySummary(c, s) {
    const dir = join(root, c, s);
    const j = readJson(join(dir, 'story.json'));
    if (!j) return { slug: s, collection: c, name: s, setUp: false, status: 'not-set-up', error: 'This folder has no story.json, so it was added by hand. Add the story again from the library to set it up.' };
    const out = { slug: s, collection: c, setUp: true };
    for (const k of STORY_FIELDS) out[k] = j[k] ?? null;
    out.hasEpisode = existsSync(join(dir, 'episode.json'));
    return out;
  }
  function collectionInfo(c) {
    const dir = join(root, c);
    const j = readJson(join(dir, 'collection.json')) || {};
    const present = subdirs(dir);
    const order = (j.order || []).filter((s) => present.includes(s));
    const rest = present.filter((s) => !order.includes(s));
    return {
      slug: c, name: j.name || c, description: j.description || '', createdAt: j.createdAt || null, setUp: !!j.name,
      stories: [...order, ...rest].map((s) => storySummary(c, s)),
    };
  }

  const lib = {
    root,
    list() {
      return subdirs(root).map(collectionInfo).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.name.localeCompare(b.name));
    },
    collection(c) { needCollection(c); return collectionInfo(c); },
    createCollection({ name, description = '' } = {}) {
      const n = checkName(name, 'collection');
      const slug = uniqueSlug(root, slugify(n, 'collection'));
      mkdirSync(join(root, slug));
      writeJson(join(root, slug, 'collection.json'), { name: n, description: String(description).slice(0, 500), order: [], createdAt: new Date().toISOString() });
      return collectionInfo(slug);
    },
    updateCollection(c, patch = {}) {
      let dir = needCollection(c);
      const j = readJson(join(dir, 'collection.json')) || { name: c, order: [], createdAt: new Date().toISOString() };
      if (patch.description != null) j.description = String(patch.description).slice(0, 500);
      if (Array.isArray(patch.order)) j.order = patch.order.filter((s) => typeof s === 'string');
      if (patch.name != null) {
        j.name = checkName(patch.name, 'collection');
        const want = slugify(j.name, 'collection');
        if (want !== c) { const slug = uniqueSlug(root, want); renameSync(dir, join(root, slug)); c = slug; dir = join(root, slug); }
      }
      writeJson(join(dir, 'collection.json'), j);
      return collectionInfo(c);
    },
    deleteCollection(c, { confirm } = {}) {
      const dir = needCollection(c);
      if (subdirs(dir).length && confirm !== c) throw new LibraryError(409, `"${c}" still has stories. Delete them first, or confirm deleting the whole collection.`);
      rmSync(dir, { recursive: true, force: true });
    },

    story(c, s) { needStory(c, s); return storySummary(c, s); },
    storyDir(c, s) { return needStory(c, s); },
    /** Find a story by id wherever it is now (it may have been renamed or moved since a job was queued). */
    findById(id) {
      for (const c of subdirs(root)) for (const s of subdirs(join(root, c))) {
        const j = readJson(join(root, c, s, 'story.json'));
        if (j && j.id === id) return { c, s, dir: join(root, c, s), story: j };
      }
      return null;
    },
    readStoryJson(c, s) { return readJson(join(needStory(c, s), 'story.json')); },
    writeStoryJson(c, s, value) { writeJson(join(needStory(c, s), 'story.json'), value); },
    createStory(c, { name, url, webUrl = null, branch = null } = {}) {
      const dir = needCollection(c);
      const n = checkName(name, 'story');
      const slug = uniqueSlug(dir, slugify(n, 'story'));
      mkdirSync(join(dir, slug));
      const story = { id: randomUUID(), name: n, url, webUrl, branch: branch || null, aliases: {}, titles: [], createdAt: new Date().toISOString(), fetchedAt: null, builtAt: null, head: null, commits: null, first: null, last: null, issuesLinked: null, status: 'queued', error: null };
      writeJson(join(dir, slug, 'story.json'), story);
      const cj = readJson(join(dir, 'collection.json'));
      if (cj) { cj.order = [...(cj.order || []).filter((x) => x !== slug), slug]; writeJson(join(dir, 'collection.json'), cj); }
      return storySummary(c, slug);
    },
    /** Rename (folder follows the name) and/or move to another collection. Returns { c, s } of the new place. */
    relocateStory(c, s, { name, collection } = {}) {
      const dir = needStory(c, s);
      const j = readJson(join(dir, 'story.json'));
      if (!j) throw new LibraryError(409, 'This folder was added by hand and has no story.json; it can\'t be renamed or moved from here.');
      let toC = c, toS = s;
      if (collection != null && collection !== c) { needCollection(collection); toC = collection; }
      if (name != null) j.name = checkName(name, 'story');
      const want = slugify(j.name, 'story');
      if (toC !== c || want !== s) {
        toS = toC === c && want === s ? s : uniqueSlug(join(root, toC), want);
        renameSync(dir, join(root, toC, toS));
      }
      writeJson(join(root, toC, toS, 'story.json'), j);
      const fix = (col, fn) => { const p = join(root, col, 'collection.json'); const cj = readJson(p); if (cj) { cj.order = fn(cj.order || []); writeJson(p, cj); } };
      if (toC !== c) { fix(c, (o) => o.filter((x) => x !== s)); fix(toC, (o) => [...o, toS]); }
      else if (toS !== s) fix(c, (o) => o.map((x) => (x === s ? toS : x)));
      return { c: toC, s: toS };
    },
    deleteStory(c, s, { confirm } = {}) {
      const dir = needStory(c, s);
      if (confirm !== s) throw new LibraryError(409, `Confirm deleting "${s}": its clone and built episode are removed from disk.`);
      rmSync(dir, { recursive: true, force: true });
      const p = join(root, c, 'collection.json'); const cj = readJson(p);
      if (cj) { cj.order = (cj.order || []).filter((x) => x !== s); writeJson(p, cj); }
    },
    writeJsonFile(c, s, file, value) { writeJson(join(needStory(c, s), file), value); },
  };
  return lib;
}
