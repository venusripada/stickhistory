// Runs one story-engine build on a worker thread, so the server keeps
// answering requests while a big collection (or a big repo) is built.
//
//   { kind: 'collection', name, parts: [{ path, name, url }], aliases, separate, out }
//   { kind: 'story', historyPath, aliases, titles, out }
//
// Reads the saved histories, builds and checks the episode, writes it to
// `out` (atomically) and answers with a short summary.

import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { buildEpisode, validateEpisode, combineHistories } from '@commit-wars/story-engine';

function run(task) {
  let episode;
  if (task.kind === 'collection') {
    const parts = task.parts.map((p) => ({ history: JSON.parse(readFileSync(p.path, 'utf8')), name: p.name, url: p.url }));
    episode = buildEpisode(combineHistories(parts, { name: task.name }), { identities: true, aliases: task.aliases || {}, separate: task.separate || [] });
  } else {
    const history = JSON.parse(readFileSync(task.historyPath, 'utf8'));
    episode = buildEpisode(history, { aliases: task.aliases || {}, titles: task.titles && task.titles.length ? task.titles : undefined });
  }
  const errs = validateEpisode(episode);
  if (errs.length) throw new Error(`The built episode is not playable: ${errs[0]}`);
  const tmp = `${task.out}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(episode, null, 2) + '\n');
  renameSync(tmp, task.out);
  return {
    commits: episode.summary.commits, issuesLinked: episode.summary.issuesLinked,
    start: episode.timeline.start, end: episode.timeline.end, people: episode.timeline.people.filter((p) => !p.bot).length,
  };
}

try { parentPort.postMessage({ ok: true, summary: run(workerData) }); }
catch (e) { parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e) }); }
