// Lists a GitHub organization's (or user's) repositories with the GitHub CLI
// (`gh`), using whoever is signed in on this machine. Only names and metadata
// are read here; cloning still goes through git.

import { spawn } from 'node:child_process';

export class GitHubListError extends Error {
  constructor(status, message) { super(message); this.name = 'GitHubListError'; this.status = status; }
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const FIELDS = 'name,nameWithOwner,sshUrl,url,isArchived,isFork,isPrivate,pushedAt,diskUsage,description';

function runGh(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('gh', args, { env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else { const e = new Error(`gh exited with ${code}`); e.stderr = Buffer.concat(err).toString('utf8'); reject(e); }
    });
  });
}

/** @param {{ run?: (args: string[]) => Promise<string> }} [o]  `run` replaces the gh call (tests). */
export function createGitHub({ run = runGh } = {}) {
  return {
    /** Every repository of an organization or user, most recently pushed first. */
    async listRepos(owner) {
      if (!OWNER_RE.test(String(owner || ''))) throw new GitHubListError(400, `"${owner}" isn't a GitHub organization or user name.`);
      let text;
      try { text = await run(['repo', 'list', owner, '--limit', '1000', '--json', FIELDS]); }
      catch (e) {
        const msg = String(e.stderr || e.message || '');
        if (e.code === 'ENOENT') throw new GitHubListError(503, 'Listing an organization needs the GitHub CLI. Install it (https://cli.github.com) and sign in with `gh auth login`, then try again.');
        if (/Could not resolve to a Repository Owner|not found/i.test(msg)) throw new GitHubListError(404, `GitHub has no organization or user named "${owner}", or the account signed in to gh can't see it.`);
        if (/auth login|not logged|authentication|401|SAML|SSO/i.test(msg)) throw new GitHubListError(401, `gh isn't signed in with access to "${owner}". Run \`gh auth login\` (and authorize SSO for the organization if it uses it), then try again.`);
        throw new GitHubListError(502, `gh couldn't list "${owner}": ${msg.trim().split('\n').pop() || 'it stopped without saying why'}`);
      }
      let rows;
      try { rows = JSON.parse(text); } catch { throw new GitHubListError(502, 'gh answered with something that isn\'t a repository list.'); }
      return rows.map((r) => ({
        name: r.name, fullName: r.nameWithOwner, url: r.sshUrl, webUrl: r.url, archived: !!r.isArchived, fork: !!r.isFork,
        private: !!r.isPrivate, pushedAt: r.pushedAt || null, sizeKb: r.diskUsage ?? null, description: r.description || '',
      })).sort((a, b) => String(b.pushedAt).localeCompare(String(a.pushedAt)) || a.name.localeCompare(b.name));
    },
  };
}
