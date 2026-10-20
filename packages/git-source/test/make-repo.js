// Builds throwaway git repositories for tests: made-up people, made-up
// messages, real commits. Nothing here reads a real repository.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const PEOPLE = [['Ada Test', 'ada@example.test'], ['Bob Test', 'bob@example.test'], ['Cy Test', 'cy@example.test']];
const SUBJECTS = ['feat: add widget', 'fix: widget crash on start', 'fix(ui): button overlaps the menu', 'refactor: split widget module', 'docs: explain widget', 'fix: memory leak in cache'];

export function tempDir(prefix = 'cw-test-') { return mkdtempSync(join(tmpdir(), prefix)); }
export function removeDir(dir) { rmSync(dir, { recursive: true, force: true }); }

const git = (dir, args, env = {}) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env } });

/**
 * Adds `n` commits to the repo in `dir` (created if needed), one per day from `start`.
 * Odd-numbered fixes close an issue in their body. Returns the new head sha.
 */
export function addCommits(dir, { n = 12, start = '2024-01-01', from = 0, tagAt = {} } = {}) {
  mkdirSync(dir, { recursive: true });
  try { git(dir, ['rev-parse', '--git-dir']); } catch { git(dir, ['init', '-q', '-b', 'main']); }
  const t0 = Date.parse(start + 'T12:00:00Z');
  for (let k = from; k < from + n; k++) {
    const [name, email] = PEOPLE[k % PEOPLE.length];
    const subject = SUBJECTS[k % SUBJECTS.length];
    const file = join(dir, `src/part${k % 5}.txt`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `change ${k}\n`);
    git(dir, ['add', '-A']);
    const body = subject.startsWith('fix') && k % 2 === 1 ? `\n\nFixes #${100 + k}` : '';
    const date = new Date(t0 + k * 86400000).toISOString();
    git(dir, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', subject + body],
      { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    if (tagAt[k]) git(dir, ['tag', tagAt[k]]);
  }
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

/** A fresh repo with `n` commits; returns its path. */
export function makeRepo(opts = {}) {
  const dir = tempDir('cw-repo-');
  addCommits(dir, opts);
  return dir;
}

/**
 * Adds a pull request merged with a merge commit: `n` feature commits by `author` on a
 * branch from the current head, then "Merge pull request #<pr> from <author>/<name>" with
 * `title` as its body. Dates continue from `day` (a YYYY-MM-DD).
 */
export function mergePullRequest(dir, { name = 'feature', n = 6, pr = 7, title = 'Add a feature', day = '2024-01-10', author = PEOPLE[0] } = {}) {
  const t0 = Date.parse(day + 'T12:00:00Z');
  const main = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  git(dir, ['checkout', '-q', '-b', name]);
  for (let k = 0; k < n; k++) {
    const file = join(dir, `src/${name}${k}.txt`);
    writeFileSync(file, `${name} ${k}\n`);
    git(dir, ['add', '-A']);
    const date = new Date(t0 + k * 3600000).toISOString();
    git(dir, ['-c', `user.name=${author[0]}`, '-c', `user.email=${author[1]}`, 'commit', '-q', '-m', `feat: ${name} part ${k}`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }
  git(dir, ['checkout', '-q', main]);
  const date = new Date(t0 + 86400000).toISOString();
  git(dir, ['-c', `user.name=${author[0]}`, '-c', `user.email=${author[1]}`, 'merge', '-q', '--no-ff', name, '-m', `Merge pull request #${pr} from ${author[0].split(' ')[0].toLowerCase()}/${name}`, '-m', title], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(dir, ['rev-parse', 'HEAD']).trim();
}
