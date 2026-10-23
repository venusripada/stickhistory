// Runs one story-engine build on a worker thread, so the server keeps
// answering requests while a big collection (or a big repo) is built.
//
//   { kind: 'collection', name, parts: [{ path, name, url }], aliases, separate, out }
//   { kind: 'story', historyPath, aliases, titles, out }
//   { kind: 'period', name, parts, aliases, separate, from, to, out, reportOut }
//   { kind: 'feature', name, parts, aliases, separate, feature, out, reportOut }
//
// Reads the saved histories, builds and checks the episode, writes it to
// `out` (atomically) and answers with a short summary.

import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { buildEpisode, validateEpisode, combineHistories, cutHistory, cutFeature, featureReport, quartersOf, periodReport, periodLabel } from '@commit-wars/story-engine';

function write(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}
const check = (episode) => { const errs = validateEpisode(episode); if (errs.length) throw new Error(`The built episode is not playable: ${errs[0]}`); };
const combined = (task) => combineHistories(task.parts.map((p) => ({ history: JSON.parse(readFileSync(p.path, 'utf8')), name: p.name, url: p.url })), { name: task.name });
const peopleOf = (episode) => episode.timeline.people.filter((p) => !p.bot).length;

/** An episode for a report, or null with small = true when there are too few commits for a movie. */
function reportEpisode(cut, task) {
  const opts = { identities: true, aliases: task.aliases || {}, separate: task.separate || [] };
  try { const episode = buildEpisode(cut, opts); check(episode); return { episode, small: false }; }
  catch (e) { if (!/A replay needs at least/.test(e.message)) throw e; return { episode: buildEpisode(cut, { ...opts, minCommits: 1 }), small: true }; }
}

function run(task) {
  if (task.kind === 'feature') {
    const { history: cut, signals } = cutFeature(combined(task), task.feature);
    if (!cut.commits.length) throw new Error(`No commits in this collection mention "${task.feature}" in a message, branch, scope or file path. Check the spelling, or re-read the stories so commit bodies are searched too.`);
    const { episode, small } = reportEpisode(cut, task);
    if (small) rmSync(task.out, { force: true }); else write(task.out, episode);
    const report = featureReport(episode, { name: task.feature, collection: task.name, signals });
    write(task.reportOut, report);
    return { commits: episode.summary.commits, people: peopleOf(episode), small, from: report.from, to: report.to };
  }
  if (task.kind === 'period') {
    const cut = cutHistory(combined(task), { from: task.from, to: task.to });
    if (!cut.commits.length) throw new Error(`None of this collection's stories has commits from ${periodLabel(task.from, task.to)}. Pick another period.`);
    // too few commits for a movie still makes a report
    const { episode, small } = reportEpisode(cut, task);
    if (small) rmSync(task.out, { force: true }); else write(task.out, episode);
    write(task.reportOut, periodReport(episode, { from: task.from, to: task.to, collection: task.name }));
    return { commits: episode.summary.commits, people: peopleOf(episode), small };
  }
  let episode;
  if (task.kind === 'collection') episode = buildEpisode(combined(task), { identities: true, aliases: task.aliases || {}, separate: task.separate || [] });
  else {
    const history = JSON.parse(readFileSync(task.historyPath, 'utf8'));
    episode = buildEpisode(history, { aliases: task.aliases || {}, titles: task.titles && task.titles.length ? task.titles : undefined });
  }
  check(episode);
  write(task.out, episode);
  return {
    commits: episode.summary.commits, issuesLinked: episode.summary.issuesLinked,
    start: episode.timeline.start, end: episode.timeline.end, people: peopleOf(episode),
    ...(task.kind === 'collection' ? { quarters: quartersOf(episode.timeline) } : {}),
  };
}

try { parentPort.postMessage({ ok: true, summary: run(workerData) }); }
catch (e) { parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e) }); }
