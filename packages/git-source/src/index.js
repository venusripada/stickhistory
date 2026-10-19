// @commit-wars/git-source (Node only)
// Clone, fetch and read a repository's history with the git command line.
// Clones are bare and blobless, so file contents are never downloaded: only
// commits, trees and tags, which is all a history needs.

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseGitLog, GIT_LOG_FORMAT } from '@commit-wars/story-engine';

export class GitSourceError extends Error {
  /** @param {'bad-url'|'not-found'|'auth'|'network'|'git'} code */
  constructor(code, message) { super(message); this.name = 'GitSourceError'; this.code = code; }
}

// Only these transports, never ext:: or fd::, and no prompts that would hang a server.
const GIT_ENV = {
  GIT_ALLOW_PROTOCOL: 'https:ssh:git:file',
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
};

/**
 * Check a repository link before git sees it.
 * @returns {{ url: string, kind: 'remote'|'local' }}  url is what to pass to git (file:// for local folders).
 */
export function checkGitUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new GitSourceError('bad-url', 'Paste a repository link, such as https://github.com/owner/repo, or a folder path on this machine.');
  if (s.startsWith('-')) throw new GitSourceError('bad-url', `"${s}" isn't a repository link.`);
  if (/^(https?|ssh|git):\/\//i.test(s)) {
    if (/^http:\/\//i.test(s) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(s)) throw new GitSourceError('bad-url', 'Use an https:// link; plain http is not allowed.');
    return { url: s.replace(/\/+$/, ''), kind: 'remote' };
  }
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(s)) return { url: s, kind: 'remote' };
  if (/^file:\/\//i.test(s)) { const p = fileURLToPath(s); if (!existsSync(p)) throw new GitSourceError('bad-url', `The folder ${p} doesn't exist on this machine.`); return { url: s, kind: 'local' }; }
  if (/^[a-z][a-z0-9+.-]*::?/i.test(s) && !/^[a-z]:[\\/]/i.test(s) && !/^[\w.-]+\.[a-z]{2,}\//i.test(s)) {
    throw new GitSourceError('bad-url', `Only https, ssh and git links or local folders can be added, not "${s.split(':')[0]}:".`);
  }
  if (/^[\w-]+(\.[\w-]+)+\/[\w.-]+\/[\w.-]+/.test(s)) return { url: 'https://' + s.replace(/\/+$/, ''), kind: 'remote' };
  const p = resolve(s);
  if (!existsSync(p) || !statSync(p).isDirectory()) throw new GitSourceError('bad-url', `The folder ${p} doesn't exist on this machine. Paste a repository link or an existing folder.`);
  return { url: pathToFileURL(p).href, kind: 'local' };
}

/**
 * The ssh form of an https repository link ("https://github.com/a/b" -> "git@github.com:a/b.git"),
 * so private repos can use this machine's ssh key. Null when it isn't a plain https link.
 */
export function sshAlternative(url) {
  const m = String(url).replace(/\/+$/, '').replace(/\.git$/i, '').match(/^https:\/\/([\w.-]+)\/([\w.-]+(?:\/[\w.-]+)+)$/i);
  return m ? `git@${m[1]}:${m[2]}.git` : null;
}

/** Owner, name and a web link for a repository URL (null where it can't tell). */
export function repoMeta(url) {
  const u = String(url).replace(/\.git$/, '').replace(/\/+$/, '');
  let m = u.match(/^https?:\/\/([^/]+)\/(.+)\/([^/]+)$/i) || u.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)\/([^/]+)$/i) || u.match(/^[\w.-]+@([\w.-]+):(.+)\/([^/]+)$/);
  if (m) return { owner: m[2], name: m[3], webUrl: `https://${m[1]}/${m[2]}/${m[3]}` };
  return { owner: null, name: basename(u.replace(/^file:\/\//, '')) || 'repo', webUrl: null };
}

function explain(stderr, url) {
  const t = String(stderr || '');
  const last = t.trim().split('\n').filter(Boolean).pop() || 'git stopped without saying why';
  if (/not found|does not exist|does not appear to be a git repository|No such file or directory/i.test(t)) return new GitSourceError('not-found', `git couldn't find a repository at ${url}. Check the link; for a private repo, make sure \`git clone\` works for it on this machine.`);
  if (/Authentication failed|could not read Username|Permission denied|terminal prompts disabled|Host key verification failed/i.test(t)) return new GitSourceError('auth', `git couldn't sign in to ${url}. Private repos use this machine's git credentials: set up an SSH key or credential helper so \`git clone\` works without a prompt, then try again.`);
  if (/Could not resolve host|Connection timed out|Connection refused|unable to access|Network is unreachable/i.test(t)) return new GitSourceError('network', `git couldn't reach ${url}. Check the network connection and the link, then try again.`);
  return new GitSourceError('git', `git couldn't finish: ${last.replace(/^fatal:\s*/, '')}`);
}

/**
 * Run git; resolves with stdout. onLine gets each stderr progress line.
 * @param {string[]} args
 * @param {{ cwd?: string, signal?: AbortSignal, onLine?: (line: string) => void, url?: string }} [o]
 */
function git(args, o = {}) {
  return new Promise((res, rej) => {
    const p = spawn('git', args, { cwd: o.cwd, env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'], signal: o.signal });
    const out = [], err = [];
    let partial = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => {
      err.push(d);
      if (!o.onLine) return;
      partial += d.toString();
      const parts = partial.split(/[\r\n]/); partial = parts.pop();
      for (const line of parts) if (line.trim()) o.onLine(line.trim());
    });
    p.on('error', (e) => rej(e.name === 'AbortError' ? e : new GitSourceError('git', `git couldn't start (${e.message}). Install git and make sure it is on the PATH.`)));
    p.on('close', (code) => {
      if (code === 0) res(Buffer.concat(out).toString('utf8'));
      else rej(explain(Buffer.concat(err).toString('utf8'), o.url || args[args.length - 2] || ''));
    });
  });
}

const progressOf = (line) => {
  const m = line.match(/^(?:remote:\s*)?([A-Za-z ]+):\s+(\d+)%/);
  return m ? { phase: m[1].trim(), percent: Number(m[2]), message: line } : { phase: null, percent: null, message: line };
};

/**
 * Bare, blobless clone of `url` (from checkGitUrl) into `dir`.
 * @param {{ signal?: AbortSignal, onProgress?: (p: { phase: string|null, percent: number|null, message: string }) => void }} [o]
 */
export async function cloneRepo(url, dir, o = {}) {
  await git(['clone', '--bare', '--filter=blob:none', '--progress', '--', url, dir], { signal: o.signal, url, onLine: (l) => o.onProgress && o.onProgress(progressOf(l)) });
  if (o.onProgress) o.onProgress({ phase: 'Cloned', percent: 100, message: 'Clone finished.' });
}

/** Bring a bare clone up to date: every branch and tag, deleted branches pruned. */
export async function fetchRepo(dir, o = {}) {
  await git(['-C', dir, 'fetch', '--prune', '--tags', '--progress', 'origin', '+refs/heads/*:refs/heads/*'], { signal: o.signal, onLine: (l) => o.onProgress && o.onProgress(progressOf(l)) });
}

/** Commit sha at the tip of `branch` (default: the clone's HEAD). */
export async function headOf(dir, branch) {
  return (await git(['-C', dir, 'rev-parse', '--verify', `${branch || 'HEAD'}^{commit}`])).trim();
}

/** The branch HEAD points at, e.g. "main". */
export async function defaultBranch(dir) {
  return (await git(['-C', dir, 'symbolic-ref', '--short', 'HEAD'])).trim();
}

/**
 * Read a clone's history into a History (see story-engine types.js).
 * @param {string} dir  A clone (bare or not).
 * @param {{ branch?: string|null, name?: string, owner?: string|null, url?: string|null, signal?: AbortSignal }} [o]
 */
export async function readHistory(dir, o = {}) {
  const branch = o.branch || await defaultBranch(dir).catch(() => null);
  const args = ['-C', dir, 'log', '--no-renames', '--name-only', '--date=short', `--format=${GIT_LOG_FORMAT}`];
  if (o.branch) args.push(o.branch, '--');
  const text = await git(args, { signal: o.signal });
  return parseGitLog(text, { owner: o.owner ?? null, repoName: o.name || basename(dir).replace(/\.git$/, ''), repoUrl: o.url ?? null, branch });
}
