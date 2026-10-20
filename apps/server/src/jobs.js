// One job at a time, in order (periods have their own line, so a quarter
// doesn't wait behind clones or a big combine). A job works on a story found by its id, so
// renaming or moving the story while the job waits is fine.
//
//   build   clone if needed, read the history, build the episode
//   update  fetch; rebuild only if the branch head moved
//   reread  read the history again and rebuild (branch, aliases or titles changed)
//   collection  combine a collection's built stories into one movie (runs after its stories change)
//   period  a collection's movie and report for a quarter or any dates (from the saved histories)

import { existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { cloneRepo, fetchRepo, headOf, readHistory, repoMeta, sshAlternative } from '@commit-wars/git-source';
import { SMALL_RE } from './library.js';
import { Worker } from 'node:worker_threads';

/** Build on a worker thread (build-worker.js), so the server keeps answering meanwhile. */
function buildInWorker(task) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./build-worker.js', import.meta.url), { workerData: task, resourceLimits: { maxOldGenerationSizeMb: 4096 } });
    w.once('message', (m) => (m.ok ? resolve(m.summary) : reject(new Error(m.error))));
    w.once('error', (e) => reject(new Error(/heap|memory/i.test(e.message) ? 'This build ran out of memory. Split the collection, or build it on a machine with more memory.' : e.message)));
    w.once('exit', (code) => { if (code !== 0) reject(new Error(`The build stopped unexpectedly (code ${code}).`)); });
  });
}
import { ENGINE_VERSION, checkPeriod } from '@commit-wars/story-engine';

const now = () => new Date().toISOString();

/**
 * Which queued job runs next. Jobs run in order, except that a collection's
 * combined movie jumps ahead of story builds once 25 of its stories have
 * changed, or 3 minutes have passed with at least one change, since it was
 * last combined. Without that, a big import would leave it stale until the
 * very last clone finished.
 * @param {{ kind: string, collectionId?: string }[]} queue
 * @param {{ now: number, stale: Map<string, { changed: number, since: number }> }} o
 */
export function pickNext(queue, { now: t, stale }) {
  const i = queue.findIndex((j) => {
    if (j.kind !== 'collection') return false;
    const s = stale.get(j.collectionId);
    return !!s && s.changed > 0 && (s.changed >= 25 || t - s.since >= 3 * 60000);
  });
  return i >= 0 ? i : 0;
}

/**
 * @param {{ library: ReturnType<import('./library.js').createLibrary>, emit: (type: string, data: any) => void }} o
 */
export function createJobs({ library, emit }) {
  const queue = [];
  let running = null, seq = 0;
  const periodQueue = []; // periods only read saved histories: their own line, one at a time
  let periodRunning = null;
  const stale = new Map(); // collectionId -> { changed, since }: stories changed since its movie was last combined
  const noteChange = (collectionId) => {
    if (!collectionId) return;
    const s = stale.get(collectionId) || { changed: 0, since: Date.now() };
    s.changed++; stale.set(collectionId, s);
  };

  const view = (j) => ({ id: j.id, kind: j.kind, storyId: j.storyId, story: j.story, collectionId: j.collectionId || null, collection: j.collection || null, periodId: j.periodId || null, state: j.state, phase: j.phase, message: j.message, frac: j.frac, changed: j.changed ?? null });
  const publish = (j) => emit('job', view(j));

  function enqueue(kind, storyId) {
    const same = queue.find((j) => j.storyId === storyId);
    if (same) { if (kind === 'build' || (kind === 'reread' && same.kind === 'update')) same.kind = kind; return view(same); }
    const loc = library.findById(storyId);
    const job = { id: String(++seq), kind, storyId, story: loc ? { collection: loc.c, slug: loc.s, name: loc.story.name } : null, state: 'queued', phase: 'queued', message: running ? 'Waiting for the job ahead to finish.' : 'Starting…', frac: null };
    queue.push(job);
    publish(job);
    setImmediate(pump);
    return view(job);
  }

  function enqueueCollection(collectionId) {
    if (!collectionId) return null;
    const same = queue.find((j) => j.kind === 'collection' && j.collectionId === collectionId);
    if (same) return view(same);
    const loc = library.findCollectionById(collectionId);
    const job = { id: String(++seq), kind: 'collection', storyId: null, collectionId, collection: loc ? { slug: loc.c, name: loc.json.name } : null, story: null, state: 'queued', phase: 'queued', message: 'Waiting to combine the stories.', frac: null };
    queue.push(job);
    publish(job);
    setImmediate(pump);
    return view(job);
  }
  /** A period's movie and report; its period.json says it's waiting until the job runs. */
  function enqueuePeriod(collectionId, periodId) {
    const same = periodQueue.find((j) => j.collectionId === collectionId && j.periodId === periodId);
    if (same) return view(same);
    const loc = library.findCollectionById(collectionId);
    const job = { id: String(++seq), kind: 'period', storyId: null, collectionId, periodId, collection: loc ? { slug: loc.c, name: loc.json.name } : null, story: null, state: 'queued', phase: 'queued', message: periodRunning ? 'Waiting for the period ahead to finish.' : 'Starting…', frac: null };
    periodQueue.push(job);
    publish(job);
    setImmediate(pumpPeriods);
    return view(job);
  }
  /** After a story changes, its collection's movie is rebuilt. */
  function collectionOfStory(storyId) {
    const loc = storyId && library.findById(storyId);
    const cj = loc && library.readCollectionJson(loc.c);
    return cj && cj.id ? cj.id : null;
  }

  async function pump() {
    if (running || !queue.length) return;
    const job = running = queue.splice(pickNext(queue, { now: Date.now(), stale }), 1)[0];
    await runJob(job);
    running = null;
    setImmediate(pump);
  }
  async function pumpPeriods() {
    if (periodRunning || !periodQueue.length) return;
    const job = periodRunning = periodQueue.shift();
    await runJob(job);
    periodRunning = null;
    setImmediate(pumpPeriods);
  }

  async function runJob(job) {
    job.state = 'running'; publish(job);
    try {
      await (job.kind === 'collection' ? runCollection(job) : job.kind === 'period' ? runPeriod(job) : run(job));
      job.state = 'done'; job.frac = 1;
      if (job.storyId && job.changed) { const cid = collectionOfStory(job.storyId); noteChange(cid); enqueueCollection(cid); }
      if (job.kind === 'collection') stale.set(job.collectionId, { changed: 0, since: Date.now() });
    } catch (e) {
      job.state = 'error'; job.message = e && e.message ? e.message : 'The job stopped without saying why.';
      if (job.kind === 'period') {
        const loc = library.findCollectionById(job.collectionId);
        if (loc) { try { library.writePeriodJson(loc.c, job.periodId, { ...(library.readPeriodJson(loc.c, job.periodId) || {}), status: 'error', error: job.message }); } catch { /* deleted meanwhile */ } emit('library', {}); }
      } else if (job.kind === 'collection') {
        const loc = library.findCollectionById(job.collectionId);
        if (loc) { library.writeCollectionJson(loc.c, { ...loc.json, episode: { ...(loc.json.episode || {}), status: 'error', error: job.message } }); emit('library', {}); }
      } else {
        const loc = library.findById(job.storyId);
        // a repo with too few commits isn't broken: its history is saved and counts in the collection's movie
        const small = SMALL_RE.test(job.message);
        if (loc) { library.writeStoryJson(loc.c, loc.s, { ...loc.story, status: small ? 'small' : 'error', error: job.message }); emit('library', {}); }
        if (small) { job.state = 'done'; job.changed = true; const cid = collectionOfStory(job.storyId); noteChange(cid); enqueueCollection(cid); }
      }
    } finally {
      publish(job);
    }
  }

  async function run(job) {
    const where = () => { const loc = library.findById(job.storyId); if (!loc) throw new Error('This story was deleted before its job ran.'); job.story = { collection: loc.c, slug: loc.s, name: loc.story.name }; return loc; };
    const save = (fields) => { const loc = where(); library.writeStoryJson(loc.c, loc.s, { ...loc.story, ...fields }); emit('library', {}); return library.findById(job.storyId); };
    const step = (phase, message, frac = null) => { job.phase = phase; job.message = message; job.frac = frac; publish(job); };

    let loc = where();
    const repoDir = () => join(where().dir, 'repo.git');

    if (job.kind === 'build' || !existsSync(repoDir())) {
      if (!existsSync(repoDir())) {
        save({ status: 'cloning', error: null });
        step('cloning', `Cloning ${loc.story.webUrl || loc.story.url} (history only, no file contents)…`, 0);
        const partial = join(where().dir, 'repo.git.partial');
        if (existsSync(partial)) rmSync(partial, { recursive: true, force: true });
        let lastPublish = 0;
        const onProgress = (p) => {
          if (p.percent == null || Date.now() - lastPublish < 150) return;
          lastPublish = Date.now();
          step('cloning', `${p.phase}: ${p.percent}%`, p.percent / 100 * 0.8);
        };
        try {
          await cloneRepo(loc.story.url, partial, { onProgress });
        } catch (e) {
          // Private repos over https need a password git can't ask for here; this machine's ssh key may work instead.
          const ssh = sshAlternative(loc.story.url);
          if (!ssh || !['auth', 'not-found'].includes(e.code)) throw e;
          step('cloning', `https needs a sign-in for this repo; trying ssh (${ssh}) with this machine's key…`, 0);
          if (existsSync(partial)) rmSync(partial, { recursive: true, force: true });
          try { await cloneRepo(ssh, partial, { onProgress }); }
          catch (e2) { throw new Error(`${e.message} Trying ${ssh} with this machine's ssh key failed too: ${e2.message}`); }
          loc = save({ url: ssh });
        }
        renameSync(partial, join(where().dir, 'repo.git'));
        save({ fetchedAt: now() });
      }
      return rebuild(true);
    }
    if (job.kind === 'update') {
      step('fetching', 'Fetching new commits…', 0.1);
      await fetchRepo(repoDir());
      loc = save({ fetchedAt: now() });
      const head = await headOf(repoDir(), loc.story.branch || undefined);
      // no new commits and built by this version of the story engine: nothing to do
      if (head === loc.story.head && existsSync(join(loc.dir, 'episode.json')) && loc.story.status !== 'error' && loc.story.engine === ENGINE_VERSION) {
        job.changed = false;
        step('done', 'Already up to date.', 1);
        return;
      }
      // the engine changed but the commits didn't: rebuild from the saved history
      return rebuild(head !== loc.story.head);
    }
    return rebuild(false);

    async function rebuild(fromGit) {
      let st = save({ status: 'building', error: null }).story;
      if (fromGit || !existsSync(join(where().dir, 'history.json'))) {
        step('building', 'Reading the history…', 0.85);
        const meta = repoMeta(st.url);
        const history = await readHistory(repoDir(), { branch: st.branch || null, owner: meta.owner, name: meta.owner ? meta.name : st.name, url: st.webUrl });
        library.writeJsonFile(where().c, where().s, 'history.json', history);
      }
      step('building', 'Writing the story…', 0.92);
      const sum = await buildInWorker({ kind: 'story', historyPath: join(where().dir, 'history.json'), aliases: st.aliases || {}, titles: st.titles || [], out: join(where().dir, 'episode.json') });
      const head = await headOf(repoDir(), st.branch || undefined).catch(() => null);
      st = save({ status: 'ready', error: null, builtAt: now(), engine: ENGINE_VERSION, head, commits: sum.commits, first: sum.start, last: sum.end, issuesLinked: sum.issuesLinked }).story;
      job.changed = true;
      step('done', `Built from ${sum.commits.toLocaleString('en-US')} commits.`, 1);
    }
  }

  async function runCollection(job) {
    const where = () => { const loc = library.findCollectionById(job.collectionId); if (!loc) throw new Error('This collection was deleted before its movie was built.'); job.collection = { slug: loc.c, name: loc.json.name }; return loc; };
    const setEpisode = (fields) => { const loc = where(); const j = library.readCollectionJson(loc.c); library.writeCollectionJson(loc.c, { ...j, episode: { ...(j.episode || {}), ...fields } }); emit('library', {}); };
    const step = (phase, message, frac = null) => { job.phase = phase; job.message = message; job.frac = frac; publish(job); };
    const loc = where();
    setEpisode({ status: 'building', error: null });
    step('building', 'Combining the stories…', 0.3);
    const info = library.collection(loc.c);
    const parts = partsOf(loc.c, loc.dir);
    const file = join(loc.dir, 'collection-episode.json');
    if (!parts.length) {
      if (existsSync(file)) rmSync(file, { force: true });
      setEpisode({ status: 'empty', error: null, builtAt: now(), commits: 0, people: 0, repos: 0 });
      step('done', 'No built stories to combine yet.', 1);
      return;
    }
    const aliases = Object.fromEntries((info.people.merge || []).map((m) => [m.name, m.ids]));
    const sum = await buildInWorker({ kind: 'collection', name: info.name, parts, aliases, separate: info.people.separate || [], out: join(where().dir, 'collection-episode.json') });
    setEpisode({ status: 'ready', error: null, builtAt: now(), engine: ENGINE_VERSION, commits: sum.commits, people: sum.people, repos: parts.length, quarters: sum.quarters });
    job.changed = true;
    step('done', `Combined ${parts.length} ${parts.length === 1 ? 'story' : 'stories'}, ${sum.commits.toLocaleString('en-US')} commits.`, 1);
  }

  /** Built stories of a collection, as the worker reads them. */
  const partsOf = (c, dir) => library.collection(c).stories
    .filter((s) => s.setUp && existsSync(join(dir, s.slug, 'history.json')))
    .map((s) => ({ path: join(dir, s.slug, 'history.json'), name: s.name, url: s.webUrl }));

  async function runPeriod(job) {
    const where = () => { const loc = library.findCollectionById(job.collectionId); if (!loc) throw new Error('This collection was deleted before its period was built.'); job.collection = { slug: loc.c, name: loc.json.name }; return loc; };
    const save = (fields) => { const { c } = where(); library.writePeriodJson(c, job.periodId, { ...(library.readPeriodJson(c, job.periodId) || {}), ...fields }); emit('library', {}); };
    const step = (phase, message, frac = null) => { job.phase = phase; job.message = message; job.frac = frac; publish(job); };
    const loc = where();
    if (!library.readPeriodJson(loc.c, job.periodId)) throw new Error('This period was deleted before it was built.');
    const [from, to] = job.periodId.split('_');
    const p = checkPeriod(from, to);
    save({ status: 'building', error: null });
    const info = library.collection(loc.c);
    const parts = partsOf(loc.c, loc.dir);
    if (!parts.length) throw new Error('This collection has no built stories yet. Add a story and wait for it to build, then build the period again.');
    step('building', `Building ${p.label} from ${parts.length} ${parts.length === 1 ? 'story' : 'stories'}…`, 0.3);
    const dir = library.periodDir(loc.c, job.periodId);
    const aliases = Object.fromEntries((info.people.merge || []).map((m) => [m.name, m.ids]));
    const sum = await buildInWorker({ kind: 'period', name: info.name, parts, aliases, separate: info.people.separate || [], from, to, out: join(dir, 'episode.json'), reportOut: join(dir, 'report.json') });
    save({ status: sum.small ? 'small' : 'ready', error: null, builtAt: now(), engine: ENGINE_VERSION, commits: sum.commits, people: sum.people, repos: parts.length });
    job.changed = true;
    step('done', `${p.label}: ${sum.commits.toLocaleString('en-US')} commits by ${sum.people.toLocaleString('en-US')} developers${sum.small ? ' (too few for a movie; the report is ready)' : ''}.`, 1);
  }

  return {
    enqueue,
    enqueueCollection,
    enqueuePeriod,
    list: () => [running, ...queue, periodRunning, ...periodQueue].filter(Boolean).map(view),
    /** Stories left half-done by a stopped server get built again. */
    recover() {
      for (const col of library.list()) {
        for (const s of col.stories) if (s.setUp && ['queued', 'cloning', 'building'].includes(s.status)) enqueue('build', s.id);
        // collection movies that are missing, half-built or made by an older engine are combined again
        const ep = col.episode;
        const built = col.stories.filter((s) => s.hasEpisode).length;
        if (col.id && built && (!ep || ep.status === 'building' || (ep.status === 'ready' && ep.engine !== ENGINE_VERSION))) enqueueCollection(col.id);
        // a movie that covers fewer stories than are built is combined again before anything else
        else if (col.id && ep && ep.status === 'ready' && (ep.repos || 0) < built) { stale.set(col.id, { changed: built - (ep.repos || 0), since: 0 }); enqueueCollection(col.id); }
        // periods left half-built or made by an older engine are built again
        for (const p of col.periods || []) if (col.id && (['queued', 'building'].includes(p.status) || (['ready', 'small'].includes(p.status) && p.engine !== ENGINE_VERSION))) enqueuePeriod(col.id, p.id);
      }
    },
  };
}
