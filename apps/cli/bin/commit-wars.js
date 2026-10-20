#!/usr/bin/env node
// commit-wars: build an episode file from a GitHub repo or a local clone.
//
//   commit-wars github <url|owner/repo> [-o episode.json] [--token T] [--max-commits N] [--branch B]
//   commit-wars git [path] [-o episode.json] [--name owner/repo] [--url https://github.com/owner/repo]
//   commit-wars rebuild <history.json> [-o episode.json]
//
// Shared options: --aliases aliases.json  --history-out history.json  --chapters N  --titles "A,B,C"

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { buildEpisode, validateEpisode } from '@commit-wars/story-engine';
import { fetchHistory, parseRepoUrl } from '@commit-wars/github-fetcher';
import { readHistory } from '@commit-wars/git-source';

const HELP = `Commit Wars: turn a repository's history into a stick-figure fight.

Usage
  commit-wars github <url|owner/repo> [options]   Fetch from the GitHub API
  commit-wars git [path] [options]                Read a local clone (default: current folder)
  commit-wars rebuild <history.json> [options]    Rebuild from a saved history

Options
  -o, --out <file>        Where to write the episode (default: stdout)
  --token <token>         GitHub token (default: $GITHUB_TOKEN or $GH_TOKEN)
  --max-commits <n>       Newest N commits from GitHub (default 5000 with a token, 2000 without)
  --branch <name>         Branch to read (default: the repo's default branch)
  --since <date>          Only commits after this date (GitHub mode)
  --name <owner/repo>     Repository label in git mode (default: folder name)
  --url <url>             Repository URL in git mode, for links back to GitHub
  --aliases <file>        JSON map that merges author names: {"Ada": ["Ada L", "ada@x.com"]}
  --chapters <n>          Force the number of chapters (3-9 by default)
  --titles <a,b,c>        Override chapter titles in order
  --history-out <file>    Also save the raw history, to rebuild later without refetching
  -q, --quiet             No progress output
  -h, --help              Show this help

The episode opens in the web app with "Open episode file".`;

function parseArgs(argv) {
  const out = { _: [] };
  const flags = { o: 'out', q: 'quiet', h: 'help' };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (['quiet', 'help'].includes(k)) out[k] = true;
      else out[k] = v ?? argv[++i];
    } else if (a.startsWith('-') && a.length === 2) {
      const k = flags[a[1]];
      if (!k) throw new Error(`Unknown option ${a}`);
      if (k === 'quiet' || k === 'help') out[k] = true; else out[k] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : w.endsWith('o') ? 'es' : 's'}`;
const log = (args, msg) => { if (!args.quiet) process.stderr.write(msg + '\n'); };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, target] = args._;
  if (args.help || !cmd) { console.log(HELP); return; }
  const aliases = args.aliases ? JSON.parse(readFileSync(args.aliases, 'utf8')) : {};
  let history;

  if (cmd === 'github') {
    if (!target) throw new Error('Give a repository: commit-wars github owner/repo');
    const r = parseRepoUrl(target);
    const token = args.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
    log(args, `Fetching ${r.owner}/${r.repo} ${token ? 'with a token (full detail)' : 'without a token (basic detail, 60 requests an hour)'}…`);
    let lastLine = '';
    history = await fetchHistory({
      owner: r.owner, repo: r.repo, branch: args.branch || r.branch, token,
      maxCommits: args['max-commits'] ? Number(args['max-commits']) : undefined,
      since: args.since,
      onProgress: (p) => { if (!args.quiet && p.message !== lastLine) { lastLine = p.message; process.stderr.write(`\r\x1b[2K  ${p.message}`); } },
    });
    if (!args.quiet) process.stderr.write('\n');
  } else if (cmd === 'git') {
    const dir = resolve(target || '.');
    log(args, `Reading git history in ${dir}…`);
    let owner = null, name = basename(dir).replace(/\.git$/, ''), url = args.url || null;
    if (args.name) [owner, name] = args.name.includes('/') ? args.name.split('/') : [null, args.name];
    if (!url) {
      try {
        const remote = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const r = parseRepoUrl(remote);
        url = `https://github.com/${r.owner}/${r.repo}`;
        if (!args.name) { owner = r.owner; name = r.repo; }
      } catch { /* not a GitHub remote */ }
    }
    history = await readHistory(dir, { branch: args.branch || null, owner, name, url });
  } else if (cmd === 'rebuild') {
    if (!target) throw new Error('Give a history file: commit-wars rebuild history.json');
    history = JSON.parse(readFileSync(target, 'utf8'));
  } else {
    throw new Error(`Unknown command "${cmd}". Run commit-wars --help.`);
  }

  if (args['history-out']) { writeFileSync(args['history-out'], JSON.stringify(history)); log(args, `Saved history to ${args['history-out']}`); }
  const episode = buildEpisode(history, {
    aliases,
    chapters: args.chapters ? Number(args.chapters) : undefined,
    titles: args.titles ? String(args.titles).split(',').map((s) => s.trim()) : undefined,
  });
  const errs = validateEpisode(episode);
  if (errs.length) throw new Error('Built an invalid episode: ' + errs.join('; '));
  const json = JSON.stringify(episode);
  if (args.out) writeFileSync(args.out, json); else process.stdout.write(json + '\n');
  const duels = episode.chapters.reduce((n, c) => n + c.heroes.filter((h) => h.duel).length, 0);
  log(args, `${episode.summary.repo}: ${episode.summary.commits.toLocaleString('en-US')} commits → ${plural(episode.chapters.length, 'chapter')}, ${plural(duels, 'duel')}, ${plural(episode.roster.length, 'hero')}${episode.summary.issuesLinked ? `, ${plural(episode.summary.issuesLinked, 'linked issue')}` : ''}.${args.out ? ` Wrote ${args.out}.` : ''}`);
}

main().catch((e) => { process.stderr.write(`\ncommit-wars: ${e.message}\n`); process.exit(1); });
