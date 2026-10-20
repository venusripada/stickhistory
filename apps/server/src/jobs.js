// One job at a time, in order. A job works on a story found by its id, so
// renaming or moving the story while the job waits is fine.
//
//   build   clone if needed, read the history, build the episode
//   update  fetch; rebuild only if the branch head moved
//   reread  read the history again and rebuild (branch, aliases or titles changed)
//   collection  combine a collection's built stories into one movie (runs after its stories change)

import { existsSync, rmSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneRepo, fetchRepo, headOf, readHistory, repoMeta, sshAlternative } from '@commit-wars/git-source';
import { buildEpisode, validateEpisode, combineHistories, ENGINE_VERSION } from '@commit-wars/story-engine';

const now = () => new Date().toISOString();

/**
 * @param {{ library: ReturnType<import('./library.js').createLibrary>, emit: (type: string, data: any) => void }} o
 */
export function createJobs({ library, emit }) {
  const queue = [];
  let running = null, seq = 0;

  const view = (j) => ({ id: j.id, kind: j.kind, storyId: j.storyId, story: j.story, collectionId: j.collectionId || null, collection: j.collection || null, state: j.state, phase: j.phase, message: j.message, frac: j.frac, changed: j.changed ?? null });
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
  /** After a story changes, its collection's movie is rebuilt. */
  function collectionOfStory(storyId) {
    const loc = storyId && library.findById(storyId);
    const cj = loc && library.readCollectionJson(loc.c);
    return cj && cj.id ? cj.id : null;
  }

  async function pump() {
    if (running || !queue.length) return;
    const job = running = queue.shift();
    job.state = 'running'; publish(job);
    try {
      await (job.kind === 'collection' ? runCollection(job) : run(job));
      job.state = 'done'; job.frac = 1;
      if (job.kind !== 'collection' && job.changed) enqueueCollection(collectionOfStory(job.storyId));
    } catch (e) {
      job.state = 'error'; job.message = e && e.message ? e.message : 'The job stopped without saying why.';
      if (job.kind === 'collection') {
        const loc = library.findCollectionById(job.collectionId);
        if (loc) { library.writeCollectionJson(loc.c, { ...loc.json, episode: { ...(loc.json.episode || {}), status: 'error', error: job.message } }); emit('library', {}); }
      } else {
        const loc = library.findById(job.storyId);
        if (loc) { library.writeStoryJson(loc.c, loc.s, { ...loc.story, status: 'error', error: job.message }); emit('library', {}); }
      }
    } finally {
      publish(job);
      running = null;
      setImmediate(pump);
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
      let history;
      if (fromGit || !existsSync(join(where().dir, 'history.json'))) {
        step('building', 'Reading the history…', 0.85);
        const meta = repoMeta(st.url);
        history = await readHistory(repoDir(), { branch: st.branch || null, owner: meta.owner, name: meta.owner ? meta.name : st.name, url: st.webUrl });
        library.writeJsonFile(where().c, where().s, 'history.json', history);
      } else {
        history = JSON.parse(readFileSync(join(where().dir, 'history.json'), 'utf8'));
      }
      step('building', 'Writing the story…', 0.92);
      const episode = buildEpisode(history, { aliases: st.aliases || {}, titles: st.titles && st.titles.length ? st.titles : undefined });
      const errs = validateEpisode(episode);
      if (errs.length) throw new Error(`The built episode is not playable: ${errs[0]}`);
      library.writeJsonFile(where().c, where().s, 'episode.json', episode);
      const tl = episode.timeline;
      const head = await headOf(repoDir(), st.branch || undefined).catch(() => null);
      st = save({ status: 'ready', error: null, builtAt: now(), engine: ENGINE_VERSION, head, commits: episode.summary.commits, first: tl.start, last: tl.end, issuesLinked: episode.summary.issuesLinked }).story;
      job.changed = true;
      step('done', `Built from ${episode.summary.commits.toLocaleString('en-US')} commits.`, 1);
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
    const parts = info.stories
      .filter((s) => s.setUp && existsSync(join(loc.dir, s.slug, 'history.json')))
      .map((s) => ({ history: JSON.parse(readFileSync(join(loc.dir, s.slug, 'history.json'), 'utf8')), name: s.name, url: s.webUrl }));
    const file = join(loc.dir, 'collection-episode.json');
    if (!parts.length) {
      if (existsSync(file)) rmSync(file, { force: true });
      setEpisode({ status: 'empty', error: null, builtAt: now(), commits: 0, people: 0, repos: 0 });
      step('done', 'No built stories to combine yet.', 1);
      return;
    }
    const aliases = Object.fromEntries((info.people.merge || []).map((m) => [m.name, m.ids]));
    const episode = buildEpisode(combineHistories(parts, { name: info.name }), { identities: true, aliases, separate: info.people.separate || [] });
    const errs = validateEpisode(episode);
    if (errs.length) throw new Error(`The combined movie is not playable: ${errs[0]}`);
    library.writeCollectionFile(loc.c, 'collection-episode.json', episode);
    setEpisode({ status: 'ready', error: null, builtAt: now(), engine: ENGINE_VERSION, commits: episode.summary.commits, people: episode.timeline.people.filter((p) => !p.bot).length, repos: parts.length });
    job.changed = true;
    step('done', `Combined ${parts.length} ${parts.length === 1 ? 'story' : 'stories'}, ${episode.summary.commits.toLocaleString('en-US')} commits.`, 1);
  }

  return {
    enqueue,
    enqueueCollection,
    list: () => [running, ...queue].filter(Boolean).map(view),
    /** Stories left half-done by a stopped server get built again. */
    recover() {
      for (const col of library.list()) {
        for (const s of col.stories) if (s.setUp && ['queued', 'cloning', 'building'].includes(s.status)) enqueue('build', s.id);
        // collection movies that are missing, half-built or made by an older engine are combined again
        const ep = col.episode;
        if (col.id && col.stories.some((s) => s.hasEpisode) && (!ep || ep.status === 'building' || (ep.status === 'ready' && ep.engine !== ENGINE_VERSION))) enqueueCollection(col.id);
      }
    },
  };
}
