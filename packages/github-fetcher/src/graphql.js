// Full-detail fetch through the GraphQL API (needs a token). One request per
// page of commits brings back each commit's author login, file count, the
// pull request it landed through, that PR's labels and the issues it closed.

import { ghFetch, GitHubError, abortError } from './http.js';

const META_Q = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){ nameWithOwner url isPrivate defaultBranchRef{ name } }
  rateLimit{ remaining resetAt }
}`;

const HISTORY_Q = `query($owner:String!,$name:String!,$ref:String!,$after:String,$first:Int!,$since:GitTimestamp){
  repository(owner:$owner,name:$name){
    ref(qualifiedName:$ref){
      target{ ... on Commit{
        history(first:$first, after:$after, since:$since){
          totalCount
          pageInfo{ hasNextPage endCursor }
          nodes{
            oid committedDate messageHeadline changedFilesIfAvailable
            parents{ totalCount }
            author{ name email user{ login avatarUrl } }
            associatedPullRequests(first:1){ nodes{
              number title merged
              labels(first:10){ nodes{ name } }
              closingIssuesReferences(first:5){ nodes{ number title labels(first:10){ nodes{ name } } } }
            } }
          }
        }
      } }
    }
  }
  rateLimit{ cost remaining resetAt }
}`;

const TAGS_Q = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    refs(refPrefix:"refs/tags/", first:100, after:$after, orderBy:{field:TAG_COMMIT_DATE, direction:DESC}){
      pageInfo{ hasNextPage endCursor }
      nodes{ name target{ __typename ... on Commit{ oid } ... on Tag{ target{ __typename ... on Commit{ oid } } } } }
    }
  }
}`;

async function gql(query, variables, ctx) {
  const res = await ghFetch(`${ctx.apiUrl}/graphql`, { token: ctx.token, method: 'POST', body: { query, variables }, signal: ctx.signal, fetchImpl: ctx.fetchImpl, onWait: ctx.onWait });
  const json = await res.json();
  if (json.errors && json.errors.length) {
    const e = json.errors[0];
    if (e.type === 'NOT_FOUND') throw new GitHubError('', { status: 404, code: 'not-found' });
    if (e.type === 'RATE_LIMITED') throw new GitHubError('GitHub\'s GraphQL rate limit for this token is used up. Try again later.', { code: 'rate-limit' });
    if (!json.data) throw new GitHubError(`GitHub couldn't answer the query: ${e.message}`, { code: 'graphql' });
  }
  return json.data;
}

/** @returns {Promise<import('@commit-wars/story-engine/src/types.js').History>} */
export async function fetchViaGraphQL({ owner, repo, branch, maxCommits, since, token, signal, onProgress, fetchImpl, apiUrl }) {
  const ctx = { token, signal, fetchImpl, apiUrl, onWait: (ms) => onProgress?.({ phase: 'waiting', message: `GitHub asked us to slow down. Waiting ${Math.ceil(ms / 1000)} seconds…` }) };
  onProgress?.({ phase: 'meta', message: `Looking up ${owner}/${repo}…` });
  const meta = await gql(META_Q, { owner, name: repo }, ctx);
  if (!meta.repository) throw new GitHubError('', { status: 404, code: 'not-found' });
  const defaultBranch = meta.repository.defaultBranchRef?.name || null;
  const useBranch = branch || defaultBranch;
  if (!useBranch) throw new GitHubError(`${owner}/${repo} has no commits yet.`, { code: 'empty' });

  const commits = [];
  let after = null, total = null, first = 100, hasNext = true;
  while (hasNext && commits.length < maxCommits) {
    if (signal?.aborted) throw abortError();
    let data;
    try {
      data = await gql(HISTORY_Q, { owner, name: repo, ref: `refs/heads/${useBranch}`, after, first: Math.min(first, maxCommits - commits.length), since: since || null }, ctx);
    } catch (e) {
      // Pages with many PR lookups can time out on GitHub's side; retry smaller.
      if (e instanceof GitHubError && (e.status === 502 || e.status === 504 || e.code === 'graphql') && first > 10) { first = Math.max(10, Math.floor(first / 2)); continue; }
      throw e;
    }
    const ref = data.repository?.ref;
    if (!ref) throw new GitHubError(`Branch "${useBranch}" wasn't found in ${owner}/${repo}.`, { code: 'no-branch' });
    const h = ref.target.history;
    total = h.totalCount;
    for (const n of h.nodes) commits.push(toCommit(n));
    hasNext = h.pageInfo.hasNextPage; after = h.pageInfo.endCursor;
    if (first < 100) first = Math.min(100, first + 10);
    onProgress?.({ phase: 'commits', fetched: commits.length, total: Math.min(total, maxCommits), message: `Fetched ${commits.length.toLocaleString('en-US')} of ${Math.min(total, maxCommits).toLocaleString('en-US')} commits`, rateRemaining: data.rateLimit?.remaining });
  }

  onProgress?.({ phase: 'tags', message: 'Reading release tags…' });
  const tags = [];
  let tAfter = null;
  for (let page = 0; page < 10; page++) {
    const d = await gql(TAGS_Q, { owner, name: repo, after: tAfter }, ctx);
    const r = d.repository.refs;
    for (const n of r.nodes) {
      const t = n.target;
      const sha = t.__typename === 'Commit' ? t.oid : t.target && t.target.__typename === 'Commit' ? t.target.oid : null;
      if (sha) tags.push({ name: n.name, sha });
    }
    if (!r.pageInfo.hasNextPage) break;
    tAfter = r.pageInfo.endCursor;
  }

  return {
    historyVersion: 1,
    repo: { owner, name: repo, url: meta.repository.url, defaultBranch: useBranch },
    source: 'github-graphql',
    truncated: total != null && commits.length < total,
    commitLimit: maxCommits,
    totalCommits: total,
    fetchedAt: new Date().toISOString(),
    commits,
    tags,
  };
}

function toCommit(n) {
  const prNode = n.associatedPullRequests?.nodes?.[0];
  const pr = prNode ? {
    number: prNode.number,
    title: prNode.title,
    labels: (prNode.labels?.nodes || []).map((l) => l.name),
    issues: (prNode.closingIssuesReferences?.nodes || []).map((i) => ({ number: i.number, title: i.title, labels: (i.labels?.nodes || []).map((l) => l.name) })),
  } : null;
  return {
    sha: n.oid,
    date: n.committedDate,
    message: n.messageHeadline,
    author: { name: n.author?.name || null, email: n.author?.email || null, login: n.author?.user?.login || null, avatarUrl: n.author?.user?.avatarUrl || null },
    files: typeof n.changedFilesIfAvailable === 'number' ? n.changedFilesIfAvailable : null,
    paths: null,
    pr,
    parents: n.parents?.totalCount ?? 1,
    tags: [],
  };
}
